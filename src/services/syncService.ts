import { apiService } from './api';
import { offlineStorage, OfflineInterview } from './offlineStorage';
import * as FileSystem from 'expo-file-system/legacy';

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: Array<{ interviewId: string; error: string }>;
}

class SyncService {
  private isSyncing = false;

  /**
   * Sync all pending offline interviews
   */
  async syncOfflineInterviews(): Promise<SyncResult> {
    if (this.isSyncing) {
      console.log('⚠️ Sync already in progress');
      return {
        success: false,
        syncedCount: 0,
        failedCount: 0,
        errors: [{ interviewId: 'system', error: 'Sync already in progress' }],
      };
    }

    this.isSyncing = true;
    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: [],
    };

    try {
      // Check if online
      const isOnline = await offlineStorage.isOnline();
      if (!isOnline) {
        console.log('⚠️ Device is offline, cannot sync');
        return {
          success: false,
          syncedCount: 0,
          failedCount: 0,
          errors: [{ interviewId: 'system', error: 'Device is offline' }],
        };
      }

      // Get all pending interviews
      const pendingInterviews = await offlineStorage.getPendingInterviews();
      console.log(`🔄 Starting sync for ${pendingInterviews.length} interviews`);

      if (pendingInterviews.length === 0) {
        console.log('✅ No pending interviews to sync');
        await offlineStorage.updateLastSyncTime();
        return result;
      }

      // Sync each interview one by one
      for (const interview of pendingInterviews) {
        try {
          console.log(`🔄 Syncing interview: ${interview.id}`);
          
          // Skip CATI interviews - they should not be in offline queue
          if (interview.isCatiMode) {
            console.log(`⚠️ Skipping CATI interview ${interview.id} - CATI interviews should not be saved offline`);
            await offlineStorage.updateInterviewStatus(interview.id, 'failed', 'CATI interviews require internet connection');
            result.failedCount++;
            result.errors.push({
              interviewId: interview.id,
              error: 'CATI interviews require internet connection and cannot be synced offline',
            });
            continue;
          }
          
          // Update status to syncing
          await offlineStorage.updateInterviewStatus(interview.id, 'syncing');

          // Sync CAPI interview only
          await this.syncCapiInterview(interview);

          // Mark as synced
          await offlineStorage.updateInterviewStatus(interview.id, 'synced');
          result.syncedCount++;
          console.log(`✅ Successfully synced interview: ${interview.id}`);

          // Delete from local storage after successful sync
          // Synced interviews don't need to be stored offline anymore
          await offlineStorage.deleteSyncedInterview(interview.id);
          console.log(`🗑️ Deleted synced interview from local storage: ${interview.id}`);
        } catch (error: any) {
          console.error(`❌ Error syncing interview ${interview.id}:`, error);
          const errorMessage = error.message || error.response?.data?.message || 'Unknown error';
          await offlineStorage.updateInterviewStatus(interview.id, 'failed', errorMessage);
          result.failedCount++;
          result.errors.push({
            interviewId: interview.id,
            error: errorMessage,
          });
          result.success = false;
        }
      }

      // Update last sync time
      await offlineStorage.updateLastSyncTime();

      console.log(`✅ Sync completed: ${result.syncedCount} synced, ${result.failedCount} failed`);
    } catch (error: any) {
      console.error('❌ Fatal error during sync:', error);
      result.success = false;
      result.errors.push({
        interviewId: 'system',
        error: error.message || 'Fatal sync error',
      });
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Sync a CAPI interview
   */
  private async syncCapiInterview(interview: OfflineInterview): Promise<void> {
    console.log(`📋 Syncing CAPI interview: ${interview.id}`);

    // Fetch survey from cache if not stored in interview (to reduce storage size)
    let survey = interview.survey;
    if (!survey && interview.surveyId) {
      console.log(`📦 Fetching survey ${interview.surveyId} from cache...`);
      const { offlineStorage } = await import('./offlineStorage');
      const surveys = await offlineStorage.getSurveys();
      survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
      if (!survey) {
        throw new Error(`Survey ${interview.surveyId} not found in cache`);
      }
      console.log(`✅ Found survey ${interview.surveyId} in cache`);
    }

    // Check if sessionId is an offline session ID (starts with "offline_")
    // Offline session IDs don't exist on the server, so we need to start a new session
    const isOfflineSessionId = interview.sessionId && interview.sessionId.startsWith('offline_');
    
    let sessionId: string | undefined = interview.sessionId;
    
    // If it's an offline session ID or no sessionId, start a new interview session
    if (isOfflineSessionId || !sessionId) {
      console.log(`⚠️ ${isOfflineSessionId ? 'Offline sessionId found' : 'No sessionId found'}, starting new interview session`);
      
      // Start interview
      const startResult = await apiService.startInterview(interview.surveyId);
      if (!startResult.success) {
        throw new Error(startResult.message || 'Failed to start interview');
      }

      sessionId = startResult.response.sessionId;
      if (!sessionId) {
        throw new Error('Failed to get sessionId from startInterview response');
      }
      console.log(`✅ Started new interview session: ${sessionId}`);
    }
    
    // At this point, sessionId is guaranteed to be defined
    if (!sessionId) {
      throw new Error('SessionId is required but not available');
    }

    // Build final responses array
    // Fetch survey if needed for buildFinalResponses
    if (!interview.survey && interview.surveyId) {
      const { offlineStorage } = await import('./offlineStorage');
      const surveys = await offlineStorage.getSurveys();
      interview.survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
      if (!interview.survey) {
        throw new Error(`Survey ${interview.surveyId} not found in cache`);
      }
    }
    
    const finalResponses = await this.buildFinalResponses(interview);

    // Calculate duration from startTime and endTime if available
    // CRITICAL: Prefer stored duration if it's valid, otherwise calculate from timestamps
    // The stored duration is more reliable as it was calculated at the time of saving
    let totalTimeSpent = interview.duration || 0;
    
    console.log('🔍 Duration calculation - interview.duration:', interview.duration);
    console.log('🔍 Duration calculation - interview.startTime:', interview.startTime);
    console.log('🔍 Duration calculation - interview.endTime:', interview.endTime);
    
    // First, check if stored duration is valid (greater than 0)
    if (totalTimeSpent > 0) {
      console.log('✅ Using stored duration:', totalTimeSpent, 'seconds');
    } else if (interview.startTime && interview.endTime) {
      // If stored duration is invalid, calculate from timestamps
      try {
        const start = new Date(interview.startTime);
        const end = new Date(interview.endTime);
        
        console.log('🔍 Parsed start time:', start.toISOString(), 'timestamp:', start.getTime());
        console.log('🔍 Parsed end time:', end.toISOString(), 'timestamp:', end.getTime());
        
        // Check if dates are valid
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          console.error('❌ Invalid date values - start:', interview.startTime, 'end:', interview.endTime);
          console.log('⚠️ Using stored duration as fallback:', interview.duration);
        } else {
          const timeDiff = end.getTime() - start.getTime();
          const calculatedDuration = Math.floor(timeDiff / 1000);
          
          console.log('🔍 Time difference (ms):', timeDiff);
          console.log('🔍 Calculated duration (seconds):', calculatedDuration);
          
          // Use calculated duration if it's valid and positive
          if (calculatedDuration > 0) {
            totalTimeSpent = calculatedDuration;
            console.log('✅ Calculated duration from timestamps:', totalTimeSpent, 'seconds');
          } else {
            console.warn('⚠️ Calculated duration is invalid (<= 0), using stored duration:', interview.duration);
            // If calculated is invalid but stored is also invalid, use a minimum of 1 second
            if (totalTimeSpent <= 0) {
              totalTimeSpent = 1;
              console.warn('⚠️ Both calculated and stored duration invalid, using minimum 1 second');
            }
          }
        }
      } catch (durationError) {
        console.error('❌ Error calculating duration:', durationError);
        console.log('⚠️ Using stored duration as fallback:', interview.duration);
        // If stored duration is also invalid, use minimum
        if (totalTimeSpent <= 0) {
          totalTimeSpent = 1;
          console.warn('⚠️ Using minimum 1 second as last resort');
        }
      }
    } else {
      console.warn('⚠️ No timestamps available, using stored duration:', interview.duration);
      // If stored duration is also invalid, use minimum
      if (totalTimeSpent <= 0) {
        totalTimeSpent = 1;
        console.warn('⚠️ No valid duration found, using minimum 1 second');
      }
    }
    
    console.log('📊 Final duration for sync:', totalTimeSpent, 'seconds (', Math.floor(totalTimeSpent / 60), 'minutes)');

    // Extract interviewer ID and supervisor ID from responses (for survey 68fd1915d41841da463f0d46)
    // Fetch survey if needed
    if (!interview.survey && interview.surveyId) {
      const { offlineStorage } = await import('./offlineStorage');
      const surveys = await offlineStorage.getSurveys();
      interview.survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
    }
    
    const isTargetSurvey = interview.survey && (interview.survey._id === '68fd1915d41841da463f0d46' || interview.survey.id === '68fd1915d41841da463f0d46');
    let oldInterviewerID: string | null = null;
    let supervisorID: string | null = null;
    if (isTargetSurvey) {
      const interviewerIdResponse = interview.responses['interviewer-id'];
      if (interviewerIdResponse !== null && interviewerIdResponse !== undefined && interviewerIdResponse !== '') {
        oldInterviewerID = String(interviewerIdResponse);
      }
      
      const supervisorIdResponse = interview.responses['supervisor-id'];
      if (supervisorIdResponse !== null && supervisorIdResponse !== undefined && supervisorIdResponse !== '') {
        supervisorID = String(supervisorIdResponse);
      }
    }

    // Check if consent is "No" - extract from responses
    const consentResponse = interview.responses['consent-form'];
    const isConsentNo = consentResponse === '2' || consentResponse === 2 || 
                       String(consentResponse).toLowerCase() === 'no' ||
                       String(consentResponse).toLowerCase().includes('disagree');

    // Prepare location data - ensure it includes all necessary fields
    // The backend will fetch Lok Sabha and District from GPS coordinates if not present
    let locationData = interview.locationData;
    if (locationData && locationData.latitude && locationData.longitude) {
      // Ensure location data has all fields
      locationData = {
        ...locationData,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        // Backend will populate Lok Sabha and District from coordinates
      };
    }
    
    // Prepare polling station data with all fields
    let pollingStationData = interview.selectedPollingStation;
    if (pollingStationData && pollingStationData.stationName) {
      pollingStationData = {
        state: pollingStationData.state || interview.survey?.acAssignmentState || 'West Bengal',
        acNo: pollingStationData.acNo,
        acName: pollingStationData.acName,
        pcNo: pollingStationData.pcNo,
        pcName: pollingStationData.pcName,
        district: pollingStationData.district,
        groupName: pollingStationData.groupName,
        stationName: pollingStationData.stationName,
        gpsLocation: pollingStationData.gpsLocation,
        latitude: pollingStationData.latitude,
        longitude: pollingStationData.longitude
      };
    }
    
    // Check geofencing - if locationControlBooster is enabled, geofencing is enforced
    const locationControlBooster = interview.metadata?.locationControlBooster || false;
    const geofencingError = interview.metadata?.geofencingError || null;
    
    // Upload audio FIRST (before completeInterview) - CRITICAL for offline sync
    // This matches the online mode flow where audio is uploaded before completeInterview
    let audioUrl: string | null = null;
    let audioFileSize: number = 0;
    
    if (interview.audioUri) {
      try {
        // Check if file exists before uploading
        // FileSystem is imported at the top of the file (same pattern as InterviewInterface.tsx)
        console.log('🔍 Checking audio file at path:', interview.audioUri);
        console.log('🔍 FileSystem type:', typeof FileSystem);
        console.log('🔍 FileSystem.getInfoAsync type:', typeof FileSystem?.getInfoAsync);
        
        // Verify getInfoAsync exists
        if (!FileSystem || typeof FileSystem.getInfoAsync !== 'function') {
          console.error('❌ FileSystem.getInfoAsync is not a function');
          console.error('❌ FileSystem object:', FileSystem);
          console.error('❌ FileSystem keys:', Object.keys(FileSystem || {}));
          throw new Error('FileSystem.getInfoAsync is not available');
        }
        
        const fileInfo = await FileSystem.getInfoAsync(interview.audioUri);
        
        // CRITICAL: Audio file MUST exist for CAPI interviews
        if (!fileInfo.exists) {
          throw new Error(`Audio file does NOT exist at path: ${interview.audioUri}. CAPI interviews require audio. Cannot sync without audio file.`);
        }
        
        console.log('✅ Audio file exists at path:', interview.audioUri);
        console.log('📊 Audio file size:', fileInfo.size, 'bytes');
        
        // CRITICAL: Audio file MUST not be empty
        if (fileInfo.size === 0) {
          throw new Error('Audio file exists but is empty (0 bytes). CAPI interviews require valid audio. Cannot sync with empty audio file.');
        }
        
        console.log('📤 Uploading audio file BEFORE completeInterview...');
        // TypeScript: Ensure all required values are strings
        if (!interview.audioUri || !interview.surveyId || !sessionId) {
          throw new Error('Missing required values for audio upload (audioUri, surveyId, or sessionId)');
        }
        
        const uploadResult = await apiService.uploadAudioFile(
          interview.audioUri,
          sessionId,
          interview.surveyId
        );
        
        if (uploadResult.success && uploadResult.response?.audioUrl) {
          // Only use the audioUrl if it's NOT a mock URL
          const uploadedAudioUrl = uploadResult.response.audioUrl;
          if (uploadedAudioUrl && !uploadedAudioUrl.startsWith('mock://')) {
            audioUrl = uploadedAudioUrl;
            audioFileSize = uploadResult.response?.size || fileInfo.size;
            console.log('✅ Audio uploaded successfully BEFORE completeInterview');
            console.log('✅ Audio URL:', audioUrl);
            console.log('✅ Audio file size:', audioFileSize, 'bytes');
          } else {
            // Mock URL means upload failed - throw error to prevent sync
            throw new Error('Audio upload returned invalid mock URL. Upload failed. CAPI interviews require audio. Will retry on next sync.');
          }
        } else {
          // Upload failed - throw error to prevent sync without audio
          throw new Error(`Audio upload failed: ${uploadResult.message || 'Unknown error'}. CAPI interviews require audio. Will retry on next sync.`);
        }
      } catch (audioError: any) {
        console.error('❌ Audio upload error:', audioError);
        console.error('❌ Error details:', audioError.message || audioError);
        console.error('❌ CAPI interview requires audio - sync will FAIL and retry later');
        // DO NOT continue - throw error to prevent sync without audio
        throw new Error(`Audio upload failed: ${audioError.message || audioError}. CAPI interviews require audio. Will retry on next sync.`);
      }
    } else {
      // CAPI interviews REQUIRE audio - do not allow sync without audio
      throw new Error('CAPI interview requires audio recording. Audio file is missing. Cannot sync interview without audio.');
    }
    
    // CRITICAL: For CAPI interviews, audio MUST be uploaded successfully
    // Do not proceed with interview completion if audio upload failed
    if (interview.audioUri && !audioUrl) {
      throw new Error('Audio upload failed. Cannot complete CAPI interview without audio. Will retry on next sync.');
    }
    
    // Complete the interview with the (new) sessionId and audioUrl (MUST be present for CAPI)
    // TypeScript: Ensure sessionId is defined
    if (!sessionId) {
      throw new Error('SessionId is required to complete interview');
    }
    
    // Ensure audioUrl is present for CAPI interviews
    // Fetch survey if needed
    if (!interview.survey && interview.surveyId) {
      const { offlineStorage } = await import('./offlineStorage');
      const surveys = await offlineStorage.getSurveys();
      interview.survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
    }
    
        if (!audioUrl && interview.survey?.mode === 'capi') {
      throw new Error('Audio URL is required for CAPI interviews. Audio upload must succeed before completing interview.');
    }
    
    const result = await apiService.completeInterview(sessionId, {
      responses: finalResponses,
      qualityMetrics: interview.metadata.qualityMetrics || {
        averageResponseTime: 0,
        backNavigationCount: 0,
        dataQualityScore: 100,
        totalPauseTime: 0,
        totalPauses: 0,
      },
      metadata: {
        survey: interview.surveyId,
        interviewer: 'current-user',
        status: 'Pending_Approval',
        sessionId: sessionId,
        startTime: interview.startTime ? new Date(interview.startTime) : new Date(),
        endTime: interview.endTime ? new Date(interview.endTime) : new Date(),
        totalTimeSpent: totalTimeSpent, // Include duration
        interviewMode: interview.survey?.mode === 'multi_mode' ? (interview.survey?.assignedMode || 'capi') : (interview.survey?.mode || 'capi'),
        selectedAC: interview.selectedAC || null,
        selectedPollingStation: pollingStationData, // Include complete polling station data
        location: locationData, // Include complete location data (backend will fetch Lok Sabha/District)
        setNumber: interview.selectedSetNumber || null,
        OldinterviewerID: oldInterviewerID, // Include interviewer ID for target survey
        supervisorID: supervisorID, // Include supervisor ID for target survey
        consentResponse: isConsentNo ? 'no' : null, // Set consentResponse if consent is "No"
        locationControlBooster: locationControlBooster, // Include booster status for geofencing enforcement
        geofencingError: locationControlBooster ? geofencingError : null, // Include error if booster enabled (enforce geofencing)
        // Include audio recording info - audioUrl MUST be present for CAPI interviews
        // At this point, audioUrl is guaranteed to be non-null because we throw errors if upload fails
        audioRecording: {
          hasAudio: true,
          audioUrl: audioUrl!, // Non-null assertion - we've validated this above
          recordingDuration: totalTimeSpent, // Use actual calculated duration
          format: 'm4a',
          codec: 'aac',
          bitrate: 128000,
          fileSize: audioFileSize, // Include file size from upload
          uploadedAt: new Date().toISOString() // Set upload time (always successful at this point)
        }
      },
    });

    if (!result.success) {
      const errorMsg = result.message || 'Failed to complete interview';
      console.error(`❌ Interview completion failed: ${errorMsg}`);
      console.error(`❌ Response data:`, result);
      throw new Error(errorMsg);
    }

    // CRITICAL: Verify that the interview was actually created on the server
    // Only consider sync successful if we have confirmation (response ID)
    // The API returns responseId (UUID) or mongoId (MongoDB ObjectId), check for both
    const responseId = result.response?._id || 
                       result.response?.id || 
                       result.response?.mongoId || 
                       result.response?.responseId;
    
    if (!result.response || !responseId) {
      const errorMsg = 'Interview completion returned success but no response ID - sync may have failed';
      console.error(`❌ ${errorMsg}`);
      console.error(`❌ Response data:`, JSON.stringify(result, null, 2));
      throw new Error(errorMsg);
    }

    console.log(`✅ Interview completed successfully with sessionId: ${sessionId}`);
    console.log(`✅ Interview response ID: ${responseId}`);
    
    // Log audio status - audioUrl is guaranteed to be present at this point
    console.log('✅ Interview synced WITH audio:', audioUrl);

    // Update interview with the real sessionId for future reference
    if (isOfflineSessionId || !interview.sessionId) {
      interview.sessionId = sessionId;
      await offlineStorage.saveOfflineInterview(interview);
    }
  }

  // CATI interviews are removed from offline sync - they require internet connection

  /**
   * Build final responses array from interview responses
   */
  private async buildFinalResponses(interview: OfflineInterview): Promise<any[]> {
    const finalResponses: any[] = [];
    
    // Fetch survey from cache if not stored in interview
    let survey = interview.survey;
    if (!survey && interview.surveyId) {
      const { offlineStorage } = await import('./offlineStorage');
      const surveys = await offlineStorage.getSurveys();
      survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
      if (!survey) {
        throw new Error(`Survey ${interview.surveyId} not found in cache for buildFinalResponses`);
      }
    }
    
    if (!survey) {
      throw new Error('Survey is required to build final responses');
    }

    // Get all questions from survey
    const allQuestions: any[] = [];
    if (survey.sections) {
      survey.sections.forEach((section: any, sectionIndex: number) => {
        if (section.questions) {
          section.questions.forEach((question: any, questionIndex: number) => {
            allQuestions.push({
              ...question,
              sectionIndex,
              questionIndex,
            });
          });
        }
      });
    }

    // Build responses array
    allQuestions.forEach((question: any) => {
      const responseValue = interview.responses[question.id];

      // Skip if no response and question is not required
      if (responseValue === undefined || responseValue === null || responseValue === '') {
        if (question.isRequired) {
          // Include required questions even if empty (will be marked as skipped)
          finalResponses.push({
            sectionIndex: question.sectionIndex,
            questionIndex: question.questionIndex,
            questionId: question.id,
            questionType: question.type,
            questionText: question.text,
            questionDescription: question.description,
            questionOptions: question.options
              ? question.options.map((opt: any) => (typeof opt === 'object' ? opt.text : opt))
              : [],
            response: null,
            responseTime: 0,
            isRequired: question.isRequired,
            isSkipped: true,
          });
        }
        return;
      }

      // Build response object
      const responseObj: any = {
        sectionIndex: question.sectionIndex,
        questionIndex: question.questionIndex,
        questionId: question.id,
        questionType: question.type,
        questionText: question.text,
        questionDescription: question.description,
        questionOptions: question.options
          ? question.options.map((opt: any) => (typeof opt === 'object' ? opt.text : opt))
          : [],
        response: responseValue,
        responseTime: 0, // Could be calculated if stored
        isRequired: question.isRequired || false,
        isSkipped: false,
      };

      finalResponses.push(responseObj);
    });

    return finalResponses;
  }

  /**
   * Check if sync is in progress
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}

export const syncService = new SyncService();










