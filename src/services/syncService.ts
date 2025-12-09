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
    const finalResponses = this.buildFinalResponses(interview);

    // Calculate duration from startTime and endTime if available
    // Prefer calculated duration over stored duration for accuracy
    let totalTimeSpent = interview.duration || 0;
    if (interview.startTime && interview.endTime) {
      try {
        const start = new Date(interview.startTime);
        const end = new Date(interview.endTime);
        const calculatedDuration = Math.floor((end.getTime() - start.getTime()) / 1000);
        // Use calculated duration if it's valid and positive
        if (calculatedDuration > 0) {
          totalTimeSpent = calculatedDuration;
          console.log('✅ Calculated duration from timestamps:', totalTimeSpent, 'seconds');
        } else {
          console.log('⚠️ Calculated duration is invalid, using stored duration:', interview.duration);
        }
      } catch (durationError) {
        console.error('Error calculating duration:', durationError);
        console.log('Using stored duration as fallback:', interview.duration);
      }
    } else {
      console.log('⚠️ No timestamps available, using stored duration:', interview.duration);
    }
    
    console.log('📊 Syncing interview with duration:', totalTimeSpent, 'seconds');

    // Extract interviewer ID and supervisor ID from responses (for survey 68fd1915d41841da463f0d46)
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
    
    // Check geofencing - if locationControlBooster is enabled, bypass geofencing
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
        
        if (!fileInfo.exists) {
          console.error('❌ Audio file does NOT exist at path:', interview.audioUri);
          console.error('❌ Interview will be synced without audio');
        } else {
          console.log('✅ Audio file exists at path:', interview.audioUri);
          console.log('📊 Audio file size:', fileInfo.size, 'bytes');
          
          if (fileInfo.size === 0) {
            console.warn('⚠️ Audio file exists but is empty (0 bytes)');
          } else {
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
            
            if (uploadResult.success) {
              // Backend returns: { success: true, data: { audioUrl, size, ... } }
              audioUrl = uploadResult.response?.audioUrl || null;
              audioFileSize = uploadResult.response?.size || fileInfo.size;
              console.log('✅ Audio uploaded successfully BEFORE completeInterview');
              console.log('✅ Audio URL:', audioUrl);
              console.log('✅ Audio file size:', audioFileSize, 'bytes');
              console.log('✅ Full upload response:', JSON.stringify(uploadResult.response));
            } else {
              console.error('❌ Audio upload failed:', uploadResult.message);
              console.error('❌ Interview will be synced without audio');
            }
          }
        }
      } catch (audioError: any) {
        console.error('❌ Audio upload error:', audioError);
        console.error('❌ Error details:', audioError.message || audioError);
        console.error('❌ Interview will be synced without audio');
        // Continue with sync even if audio upload fails
      }
    } else {
      console.warn('⚠️ No audio URI in interview data - interview will be synced without audio');
      console.warn('⚠️ Interview ID:', interview.id);
    }
    
    // Complete the interview with the (new) sessionId and audioUrl (if uploaded)
    // TypeScript: Ensure sessionId is defined
    if (!sessionId) {
      throw new Error('SessionId is required to complete interview');
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
        locationControlBooster: locationControlBooster, // Include booster status for geofencing bypass
        geofencingError: locationControlBooster ? null : geofencingError, // Clear error if booster enabled
        // Include audio recording info - audioUrl is already uploaded and available
        audioRecording: interview.audioUri ? {
          hasAudio: true,
          audioUrl: audioUrl, // Use the uploaded audio URL (null if upload failed)
          recordingDuration: totalTimeSpent, // Use actual calculated duration
          format: 'm4a',
          codec: 'aac',
          bitrate: 128000,
          fileSize: audioFileSize, // Include file size from upload
          uploadedAt: audioUrl ? new Date().toISOString() : null // Set upload time if successful
        } : {
          hasAudio: false,
          audioUrl: null,
          recordingDuration: totalTimeSpent, // Include duration even if no audio
          format: null,
          codec: null,
          bitrate: null,
          uploadedAt: null
        }
      },
    });

    if (!result.success) {
      throw new Error(result.message || 'Failed to complete interview');
    }

    console.log(`✅ Interview completed successfully with sessionId: ${sessionId}`);
    
    // Log audio status
    if (audioUrl) {
      console.log('✅ Interview synced WITH audio:', audioUrl);
    } else if (interview.audioUri) {
      console.warn('⚠️ Interview synced WITHOUT audio (upload failed or file missing)');
    } else {
      console.log('ℹ️ Interview synced without audio (no audio recorded)');
    }

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
  private buildFinalResponses(interview: OfflineInterview): any[] {
    const finalResponses: any[] = [];
    const survey = interview.survey;

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
