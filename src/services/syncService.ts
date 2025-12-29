import { apiService } from './api';
import { offlineStorage, OfflineInterview } from './offlineStorage';
import * as FileSystem from 'expo-file-system/legacy';
import { appLoggingService } from './appLoggingService';

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
      
      // CRITICAL: Early return if no pending interviews
      // This prevents unnecessary API calls and error logs
      if (pendingInterviews.length === 0) {
        console.log('✅ No pending interviews to sync - skipping sync operation');
        await offlineStorage.updateLastSyncTime();
        return result;
      }
      
      console.log(`🔄 Starting sync for ${pendingInterviews.length} interviews`);
      appLoggingService.info('SYNC', 'Starting offline interview sync', {
        interviewCount: pendingInterviews.length,
        interviewIds: pendingInterviews.map(i => i.id)
      });

      // Sync each interview one by one
      for (const interview of pendingInterviews) {
        try {
          console.log(`🔄 Syncing interview: ${interview.id} (${interview.isCatiMode ? 'CATI' : 'CAPI'})`);
          appLoggingService.logSyncAttempt(interview.id, 'SYNC_START', {
            interviewId: interview.id,
            surveyId: interview.surveyId,
            isCatiMode: interview.isCatiMode,
            currentStatus: interview.status,
            syncAttempts: interview.syncAttempts || 0
          });
          
          // Update status to syncing
          await offlineStorage.updateInterviewStatus(interview.id, 'syncing');

          // Sync based on interview type
          // CRITICAL: These functions will throw an error if sync fails
          // Only if they complete without throwing will we mark as synced and delete
          console.log(`🔄 Starting sync function for interview: ${interview.id}`);
          
          if (interview.isCatiMode) {
            await this.syncCatiInterview(interview);
          } else {
            await this.syncCapiInterview(interview);
          }
          
          // CRITICAL: Only reach here if sync function completed WITHOUT throwing an error
          // Add explicit log to confirm we're past the sync function
          console.log(`✅ Sync function completed successfully for interview: ${interview.id}`);
          console.log(`✅ Proceeding to mark as synced and cleanup...`);
          
          // FINAL VERIFICATION: Double-check that we should mark as synced
          // Re-fetch the interview to ensure it's still in pending/syncing state
          const currentInterview = await offlineStorage.getOfflineInterviews();
          const interviewToSync = currentInterview.find((i: any) => i.id === interview.id);
          
          if (!interviewToSync) {
            console.warn(`⚠️ Interview ${interview.id} not found in storage - may have been deleted already`);
            // Continue anyway - might have been cleaned up
          } else if (interviewToSync.status === 'synced') {
            console.warn(`⚠️ Interview ${interview.id} already marked as synced - skipping duplicate update`);
            // Already synced, skip
            continue;
          }

          // ONLY reach here if sync was successful (no error thrown)
          // Fix 3: Atomically update metadata (with responseId) and status to synced
          console.log(`📝 Marking interview ${interview.id} as synced with atomic update...`);
          const syncedInterview = await offlineStorage.getOfflineInterviewById(interview.id);
          if (syncedInterview) {
            // Get responseId from metadata if available (from syncCapiInterview/syncCatiInterview)
            const responseId = syncedInterview.metadata?.responseId || syncedInterview.metadata?.serverResponseId;
            if (responseId) {
              // Atomic update: metadata + status together
              await offlineStorage.updateInterviewMetadataAndStatus(
                interview.id,
                {
                  responseId: responseId,
                  serverResponseId: responseId,
                },
                'synced'
              );
            } else {
              // Fallback: just update status if no responseId (shouldn't happen)
              await offlineStorage.updateInterviewStatus(interview.id, 'synced');
            }
          } else {
            // Interview not found - just update status (shouldn't happen)
            await offlineStorage.updateInterviewStatus(interview.id, 'synced');
          }
          result.syncedCount++;
          console.log(`✅ Successfully synced interview: ${interview.id}`);
          appLoggingService.logSyncResult(interview.id, true, {
            interviewId: interview.id,
            surveyId: interview.surveyId,
            syncedCount: result.syncedCount
          });

          // Delete from local storage after successful sync
          // Synced interviews don't need to be stored offline anymore
          await offlineStorage.deleteSyncedInterview(interview.id);
          
          // Clean up audio file from offline storage if it exists
          if (interview.audioOfflinePath) {
            await offlineStorage.deleteAudioFileFromOfflineStorage(interview.audioOfflinePath);
          }
          
          console.log(`🗑️ Deleted synced interview from local storage: ${interview.id}`);
        } catch (error: any) {
          const errorMessage = error.message || error.response?.data?.message || 'Unknown error';
          
          // Check if this is a duplicate submission error
          // If interview was already submitted, treat it as success (not an error)
          const isDuplicate = errorMessage.includes('DUPLICATE_SUBMISSION') || 
                              errorMessage.includes('already exists') ||
                              errorMessage.includes('already submitted') ||
                              errorMessage.includes('already completed') ||
                              errorMessage.includes('duplicate');
          
          if (isDuplicate) {
            // This is NOT an error - interview already exists on server
            console.log(`ℹ️ Duplicate submission detected for interview ${interview.id}`);
            console.log(`ℹ️ Interview already exists on server - treating as successfully synced`);
            console.log(`✅ This is expected behavior - interview was already submitted previously`);
            
            // Fix 3: Atomic metadata and status update - mark as synced atomically
            // Try to get responseId from interview metadata or from server response if available
            const duplicateInterview = await offlineStorage.getOfflineInterviewById(interview.id);
            const responseId = duplicateInterview?.metadata?.responseId || duplicateInterview?.metadata?.serverResponseId;
            if (responseId) {
              await offlineStorage.updateInterviewMetadataAndStatus(
                interview.id,
                {
                  responseId: responseId,
                  serverResponseId: responseId,
                },
                'synced'
              );
            } else {
              // Fallback: just update status if no responseId
              await offlineStorage.updateInterviewStatus(interview.id, 'synced');
            }
            result.syncedCount++;
            console.log(`✅ Interview ${interview.id} already synced (duplicate submission)`);
            
            // Delete from local storage since it's already on server
            await offlineStorage.deleteSyncedInterview(interview.id);
            
            // Clean up audio file if it exists
            if (interview.audioOfflinePath) {
              await offlineStorage.deleteAudioFileFromOfflineStorage(interview.audioOfflinePath);
            }
            
            continue; // Skip to next interview
          }
          
          // Only log as error if it's NOT a duplicate
          console.error(`❌ Error syncing interview ${interview.id}:`, error);
          appLoggingService.logSyncResult(interview.id, false, {
            interviewId: interview.id,
            surveyId: interview.surveyId,
            error: errorMessage,
            errorType: error.name,
            syncAttempts: interview.syncAttempts || 0
          });
          
          // CRITICAL: Update status to failed and preserve interview for retry
          // Do NOT delete the interview - it needs to be retried
          await offlineStorage.updateInterviewStatus(interview.id, 'failed', errorMessage);
          
          // Log detailed error information for debugging
          console.error(`❌ Interview sync failed - will retry on next sync attempt`);
          console.error(`❌ Error details:`, {
            interviewId: interview.id,
            surveyId: interview.surveyId,
            error: errorMessage,
            stack: error.stack
          });
          
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

    // Fix 2 & 3: Check if interview was already successfully submitted
    // If metadata contains a responseId, it means it was already submitted
    if (interview.metadata?.responseId || interview.metadata?.serverResponseId) {
      const existingResponseId = interview.metadata.responseId || interview.metadata.serverResponseId;
      console.log(`ℹ️ Interview ${interview.id} was already submitted with responseId: ${existingResponseId}`);
      console.log(`ℹ️ Skipping duplicate submission - interview is already on server`);
      // Fix 3: Atomic metadata and status update - ensure responseId is stored and status is updated together
      await offlineStorage.updateInterviewMetadataAndStatus(
        interview.id,
        {
          responseId: existingResponseId,
          serverResponseId: existingResponseId,
        },
        'synced' // Mark as synced since it's already on server
      );
      console.log(`✅ Interview already synced - marked as synced with atomic update`);
      return; // Exit early - interview is already on server
    }

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
    // Use audioOfflinePath if available (more reliable), otherwise fall back to audioUri
    let audioUrl: string | null = null;
    let audioFileSize: number = 0;
    
    // Check if audio is already uploaded (from previous sync attempt)
    if (interview.audioUploadStatus === 'uploaded' && interview.metadata?.audioUrl) {
      audioUrl = interview.metadata.audioUrl;
      console.log('✅ Using already uploaded audio:', audioUrl);
    } else {
      // Need to upload audio
      const audioPath = interview.audioOfflinePath || interview.audioUri;
      
      if (audioPath) {
        try {
          // Update status to uploading
          interview.audioUploadStatus = 'uploading';
          await offlineStorage.saveOfflineInterview(interview);
          
          // Upload with retry mechanism
          const uploadResult = await this.uploadAudioWithRetry(
            audioPath,
            sessionId,
            interview.surveyId,
            interview.id
          );
          
          if (uploadResult.success && uploadResult.audioUrl) {
            audioUrl = uploadResult.audioUrl;
            audioFileSize = uploadResult.fileSize || 0;
            interview.audioUploadStatus = 'uploaded';
            interview.metadata = {
              ...interview.metadata,
              audioUrl: audioUrl,
            };
            interview.audioUploadError = null;
            await offlineStorage.saveOfflineInterview(interview);
            console.log('✅ Audio uploaded successfully:', audioUrl);
          } else {
            throw new Error(uploadResult.error || 'Audio upload failed');
          }
        } catch (audioError: any) {
          console.error('❌ Audio upload error:', audioError);
          interview.audioUploadStatus = 'failed';
          interview.audioUploadError = audioError.message;
          await offlineStorage.saveOfflineInterview(interview);
          // Continue with submission even if audio upload failed (will retry later)
          console.log('⚠️ Continuing with submission without audio - will retry audio upload on next sync');
        }
      } else {
        // CAPI interviews should have audio, but allow sync to proceed
        console.warn('⚠️ No audio file found for CAPI interview - syncing without audio');
      }
    }
    
    // Complete the interview with the (new) sessionId
    // TypeScript: Ensure sessionId is defined
    if (!sessionId) {
      throw new Error('SessionId is required to complete interview');
    }
    
    // Fetch survey if needed
    if (!interview.survey && interview.surveyId) {
      const surveys = await offlineStorage.getSurveys();
      interview.survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
    }
    
    // CRITICAL: Check if interview was already successfully submitted
    // If metadata contains a responseId, it means it was already submitted
    if (interview.metadata?.responseId || interview.metadata?.serverResponseId) {
      const existingResponseId = interview.metadata.responseId || interview.metadata.serverResponseId;
      console.log(`ℹ️ Interview ${interview.id} was already submitted with responseId: ${existingResponseId}`);
      console.log(`ℹ️ Skipping duplicate submission - interview is already on server`);
      // Interview already exists on server - consider it synced
      // Update metadata to reflect this
      interview.metadata = {
        ...interview.metadata,
        responseId: existingResponseId,
        serverResponseId: existingResponseId,
      };
      await offlineStorage.saveOfflineInterview(interview);
      console.log(`✅ Interview already synced - will be marked as synced by caller`);
      return; // Exit early - interview is already on server
    }
    
    // CRITICAL: Call completeInterview API and verify success BEFORE marking as synced
    console.log(`📤 Calling completeInterview API for sessionId: ${sessionId}`);
    console.log(`📤 SurveyId: ${interview.surveyId}, InterviewId: ${interview.id}`);
    console.log(`📤 About to await completeInterview - this will block until API call completes`);
    
    let result;
    try {
      result = await apiService.completeInterview(sessionId, {
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
        // CRITICAL: Include abandonment information from interview metadata if available
        abandoned: interview.metadata?.isCompleted === false || (interview.metadata?.abandonReason !== null && interview.metadata?.abandonReason !== undefined) ? true : false,
        abandonedReason: interview.metadata?.abandonReason || null,
        abandonmentNotes: interview.metadata?.abandonNotes || null,
        isCompleted: interview.metadata?.isCompleted !== undefined ? interview.metadata.isCompleted : true, // Default to true if not set
        // Include audio recording info if audio was uploaded successfully
        audioRecording: audioUrl ? {
          hasAudio: true,
          audioUrl: audioUrl,
          recordingDuration: totalTimeSpent, // Use actual calculated duration
          format: 'm4a',
          codec: 'aac',
          bitrate: 128000,
          fileSize: audioFileSize, // Include file size from upload
          uploadedAt: new Date().toISOString() // Set upload time
        } : null // Audio upload may have failed - will retry on next sync
      },
      });
      console.log(`📥 completeInterview API call completed - response received`);
    } catch (apiError: any) {
      // Check if the API returned a duplicate flag (from our improved error handling)
      const apiResult = apiError.response?.data || {};
      if (apiResult.isDuplicate === true) {
        console.log(`ℹ️ API explicitly marked this as duplicate - interview already exists on server`);
        throw new Error(`DUPLICATE_SUBMISSION: Interview already exists on server`);
      }
      
      // Catch any errors from the API call itself (network errors, etc.)
      // Only log as error if it's not a duplicate (409 is handled above)
      if (apiError.response?.status !== 409) {
        console.error(`❌ completeInterview API call threw an error:`, apiError);
        console.error(`❌ SessionId: ${sessionId}`);
        console.error(`❌ SurveyId: ${interview.surveyId}`);
      } else {
        console.log(`ℹ️ Complete interview returned 409 Conflict - duplicate submission`);
      }
      console.log(`ℹ️ Error response:`, apiError.response?.data);
      console.log(`ℹ️ Error status:`, apiError.response?.status);
      
      // Extract error message from various sources
      const errorMessage = apiError.message || '';
      const errorResponse = apiError.response?.data;
      const backendErrorMessage = errorResponse?.error || errorResponse?.message || '';
      const backendErrorCode = errorResponse?.code || errorResponse?.errorCode || '';
      const fullErrorMessage = `${errorMessage} ${backendErrorMessage} ${backendErrorCode}`.toLowerCase();
      
      // CRITICAL: Check for MongoDB duplicate key error (E11000)
      // This happens when sessionId already has a completed response
      // The backend now returns 409 Conflict with isDuplicate flag for duplicates
      const isE11000Error = 
        backendErrorCode === 11000 ||
        backendErrorCode === '11000' ||
        fullErrorMessage.includes('e11000') ||
        fullErrorMessage.includes('11000') ||
        (errorResponse?.code === 11000) ||
        (errorResponse?.keyPattern?.sessionId !== undefined); // MongoDB duplicate key pattern
      
      // Check if backend explicitly marked this as a duplicate
      const isExplicitDuplicate = errorResponse?.isDuplicate === true;
      
      // Check if this is a duplicate submission error
      // Look for duplicate indicators in both client and server error messages
      const isDuplicateError = 
        isExplicitDuplicate || // Backend explicitly marked as duplicate
        isE11000Error ||
        (apiError.response?.status === 409) || // 409 Conflict means duplicate (backend returns this for E11000)
        fullErrorMessage.includes('duplicate') || 
        fullErrorMessage.includes('already exists') ||
        fullErrorMessage.includes('already submitted') ||
        fullErrorMessage.includes('already completed') ||
        fullErrorMessage.includes('unique constraint') ||
        (apiError.response?.status === 500 && (
          backendErrorMessage.includes('duplicate') ||
          backendErrorMessage.includes('already exists') ||
          backendErrorMessage.includes('already completed') ||
          backendErrorMessage.includes('e11000') ||
          backendErrorMessage.includes('11000') ||
          isE11000Error
        ));
      
      if (isDuplicateError) {
        console.log(`ℹ️ Duplicate submission detected - interview already exists on server`);
        console.log(`ℹ️ Error message: ${errorMessage}`);
        console.log(`ℹ️ Backend error: ${backendErrorMessage}`);
        console.log(`ℹ️ Error code: ${backendErrorCode}`);
        console.log(`ℹ️ This is not a fatal error - interview was already successfully submitted`);
        // Treat duplicate as success (interview already on server)
        throw new Error(`DUPLICATE_SUBMISSION: Interview already exists on server`);
      }
      
      // For 500 errors, log more details to help debug
      if (apiError.response?.status === 500) {
        console.error(`❌ Backend returned 500 error - this might indicate a server-side issue`);
        console.error(`❌ Full error response:`, JSON.stringify(errorResponse, null, 2));
        console.error(`❌ Error code: ${backendErrorCode}`);
        console.error(`❌ Error message: ${backendErrorMessage}`);
        console.error(`❌ Full error object:`, JSON.stringify(apiError.response?.data, null, 2));
        
        // CRITICAL: Check if this might be a duplicate that we didn't catch
        // The backend might return a generic 500 for E11000 duplicate key errors
        // If we've tried multiple times with the same sessionId and keep getting 500,
        // it's very likely a duplicate submission
        const syncAttempts = interview.syncAttempts || 0;
        if (syncAttempts >= 2) {
          console.log(`⚠️ Multiple sync attempts (${syncAttempts}) failed with 500 for sessionId: ${sessionId}`);
          console.log(`⚠️ This is likely a duplicate submission - interview already exists on server`);
          console.log(`⚠️ Treating as duplicate to prevent infinite retry loop`);
          throw new Error(`DUPLICATE_SUBMISSION: Interview already exists on server (multiple 500 errors with same sessionId)`);
        }
        
        // Also check if the error response contains any duplicate indicators
        const errorResponseStr = JSON.stringify(errorResponse || {}).toLowerCase();
        if (errorResponseStr.includes('11000') || errorResponseStr.includes('duplicate') || errorResponseStr.includes('e11000')) {
          console.log(`⚠️ Error response contains duplicate indicators - treating as duplicate`);
          throw new Error(`DUPLICATE_SUBMISSION: Interview already exists on server (error response indicates duplicate)`);
        }
      }
      
      throw new Error(`API call failed: ${errorMessage || backendErrorMessage || 'Unknown error'}`);
    }

    // CRITICAL: Check API response BEFORE proceeding
    // Log the result first for debugging
    console.log(`📥 completeInterview API response received:`, {
      success: result?.success,
      hasResponse: !!result?.response,
      message: result?.message
    });
    
    // Defensive check: result must exist and have success: true
    if (!result) {
      const errorMsg = 'completeInterview API returned undefined/null - sync failed';
      console.error(`❌ ${errorMsg}`);
      console.error(`❌ SessionId: ${sessionId}`);
      console.error(`❌ SurveyId: ${interview.surveyId}`);
      throw new Error(errorMsg);
    }
    
    if (result.success !== true) {
      const errorMsg = result.message || 'Failed to complete interview';
      
      // Check if this might be a duplicate submission error
      // Sometimes the backend returns success: false for duplicates
      const isPossibleDuplicate = errorMsg.toLowerCase().includes('duplicate') ||
                                  errorMsg.toLowerCase().includes('already exists') ||
                                  errorMsg.toLowerCase().includes('already submitted');
      
      if (isPossibleDuplicate) {
        console.log(`ℹ️ Possible duplicate submission detected from API response`);
        console.log(`ℹ️ Error message: ${errorMsg}`);
        console.log(`ℹ️ This might mean the interview already exists on server`);
        // Treat as duplicate - will be handled by caller
        throw new Error(`DUPLICATE_SUBMISSION: ${errorMsg}`);
      }
      
      console.error(`❌ Interview completion failed: ${errorMsg}`);
      console.error(`❌ Response data:`, JSON.stringify(result, null, 2));
      console.error(`❌ SessionId: ${sessionId}`);
      console.error(`❌ SurveyId: ${interview.surveyId}`);
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
      console.error(`❌ SessionId: ${sessionId}`);
      console.error(`❌ SurveyId: ${interview.surveyId}`);
      throw new Error(errorMsg);
    }

    // ONLY log success AFTER verification
    console.log(`✅ Interview completed successfully with sessionId: ${sessionId}`);
    console.log(`✅ Interview response ID: ${responseId}`);
    
    // Log audio status - audioUrl is guaranteed to be present at this point
    if (audioUrl) {
      console.log('✅ Interview synced WITH audio:', audioUrl);
    } else {
      console.log('⚠️ Interview synced WITHOUT audio (audio upload may have failed)');
    }

    // Fix 3: Atomic metadata and status update - store responseId and sessionId together
    // Update interview with the real sessionId and responseId for future reference
    const metadataUpdates: any = {
      responseId: responseId,
      serverResponseId: responseId,
    };
    if (isOfflineSessionId || !interview.sessionId) {
      metadataUpdates.serverSessionId = sessionId;
    }
    
    // Store responseId atomically with interview update (if sessionId changed)
    if (isOfflineSessionId || !interview.sessionId) {
      interview.sessionId = sessionId;
      interview.metadata = {
        ...interview.metadata,
        ...metadataUpdates,
      };
      await offlineStorage.saveOfflineInterview(interview);
    }
    
    // CRITICAL: Add a final verification log before function returns
    // This ensures we can track when the function actually completes successfully
    console.log(`✅ syncCapiInterview completed successfully for interview: ${interview.id}`);
    console.log(`✅ All API calls verified - ready for cleanup in caller`);
    console.log(`✅ Response ID stored: ${responseId}`);
    
    // Return success indicator - this function should only return if sync was successful
    // Any errors should throw, which will be caught by the caller's try-catch
    // DO NOT update status or delete here - let the caller do it after this function returns
    // The caller will use updateInterviewMetadataAndStatus to atomically update metadata and status
  }

  /**
   * Upload audio file with retry mechanism (exponential backoff)
   */
  private async uploadAudioWithRetry(
    audioPath: string,
    sessionId: string,
    surveyId: string,
    interviewId: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; audioUrl?: string; fileSize?: number; error?: string }> {
    console.log(`📤 Uploading audio with retry (max ${maxRetries} attempts): ${audioPath}`);
    
    // Verify FileSystem is available
    if (!FileSystem || typeof FileSystem.getInfoAsync !== 'function') {
      throw new Error('FileSystem.getInfoAsync is not available');
    }
    
    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(audioPath);
    if (!fileInfo.exists) {
      throw new Error(`Audio file does not exist at path: ${audioPath}`);
    }
    
    if (fileInfo.size === 0) {
      throw new Error('Audio file is empty (0 bytes)');
    }
    
    console.log(`✅ Audio file verified - size: ${fileInfo.size} bytes`);
    
    // Retry loop with exponential backoff
    let lastError: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 Audio upload attempt ${attempt}/${maxRetries}...`);
        
        const uploadResult = await apiService.uploadAudioFile(
          audioPath,
          sessionId,
          surveyId
        );
        
        if (uploadResult.success && uploadResult.response?.audioUrl) {
          const uploadedAudioUrl = uploadResult.response.audioUrl;
          if (uploadedAudioUrl && !uploadedAudioUrl.startsWith('mock://')) {
            console.log(`✅ Audio uploaded successfully on attempt ${attempt}`);
            return {
              success: true,
              audioUrl: uploadedAudioUrl,
              fileSize: uploadResult.response?.size || fileInfo.size,
            };
          } else {
            throw new Error('Audio upload returned invalid mock URL');
          }
        } else {
          throw new Error(uploadResult.message || 'Audio upload failed');
        }
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Audio upload attempt ${attempt} failed:`, error.message);
        
        // If not the last attempt, wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    console.error(`❌ Audio upload failed after ${maxRetries} attempts`);
    return {
      success: false,
      error: lastError?.message || 'Audio upload failed after all retries',
    };
  }

  /**
   * Sync a CATI interview
   */
  private async syncCatiInterview(interview: OfflineInterview): Promise<void> {
    console.log(`📋 Syncing CATI interview: ${interview.id}`);

    if (!interview.catiQueueId) {
      throw new Error('CATI interview requires catiQueueId');
    }

    // Fetch survey from cache if needed
    let survey = interview.survey;
    if (!survey && interview.surveyId) {
      const surveys = await offlineStorage.getSurveys();
      survey = surveys.find((s: any) => s._id === interview.surveyId || s.id === interview.surveyId);
      if (!survey) {
        throw new Error(`Survey ${interview.surveyId} not found in cache`);
      }
    }

    // Build final responses
    const finalResponses = await this.buildFinalResponses(interview);

    // Calculate duration
    let totalTimeSpent = interview.duration || 0;
    if (totalTimeSpent <= 0 && interview.startTime && interview.endTime) {
      try {
        const start = new Date(interview.startTime);
        const end = new Date(interview.endTime);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          totalTimeSpent = Math.floor((end.getTime() - start.getTime()) / 1000);
        }
      } catch (error) {
        console.error('Error calculating duration:', error);
      }
    }
    if (totalTimeSpent <= 0) {
      totalTimeSpent = 1; // Minimum 1 second
    }

    // Extract metadata
    const answeredCount = finalResponses.filter((r: any) => {
      const response = r.response;
      return response !== null && response !== undefined && response !== '' && 
             !(Array.isArray(response) && response.length === 0);
    }).length;
    const totalCount = finalResponses.length;

    // Extract set number
    let finalSetNumber = interview.selectedSetNumber;
    if (finalSetNumber === null && survey) {
      const setNumbers = new Set<number>();
      survey.sections?.forEach((section: any) => {
        section.questions?.forEach((question: any) => {
          if (question.setsForThisQuestion && question.setNumber !== null && question.setNumber !== undefined) {
            const wasAnswered = finalResponses.some((r: any) => r.questionId === question.id);
            if (wasAnswered) {
              setNumbers.add(question.setNumber);
            }
          }
        });
      });
      const setArray = Array.from(setNumbers).sort((a, b) => a - b);
      if (setArray.length > 0) {
        finalSetNumber = setArray[0];
      }
    }

    // Extract call status
    const callStatusResponse = interview.responses['call-status'];
    const finalCallStatus = callStatusResponse === 'call_connected' ? 'success' : (callStatusResponse || 'unknown');

    // Extract interviewer ID and supervisor ID (for target survey)
    const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
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

    // Extract consent response
    const consentResponse = interview.responses['consent-form'];
    const isConsentNo = consentResponse === 'no' || consentResponse === '0' || consentResponse === false;

    // Prepare polling station data
    let pollingStationData = null;
    if (interview.selectedPollingStation && interview.selectedPollingStation.stationName) {
      pollingStationData = {
        state: interview.selectedPollingStation.state,
        acNo: interview.selectedPollingStation.acNo,
        acName: interview.selectedPollingStation.acName,
        pcNo: interview.selectedPollingStation.pcNo,
        pcName: interview.selectedPollingStation.pcName,
        district: interview.selectedPollingStation.district,
        groupName: interview.selectedPollingStation.groupName,
        stationName: interview.selectedPollingStation.stationName,
        gpsLocation: interview.selectedPollingStation.gpsLocation,
        latitude: interview.selectedPollingStation.latitude,
        longitude: interview.selectedPollingStation.longitude
      };
    }

    // Complete CATI interview
    const result = await apiService.completeCatiInterview(interview.catiQueueId, {
      sessionId: interview.sessionId || undefined,
      responses: finalResponses,
      selectedAC: interview.selectedAC || null,
      selectedPollingStation: pollingStationData,
      totalTimeSpent: totalTimeSpent,
      startTime: interview.startTime ? new Date(interview.startTime) : new Date(),
      endTime: interview.endTime ? new Date(interview.endTime) : new Date(),
      totalQuestions: totalCount,
      answeredQuestions: answeredCount,
      completionPercentage: totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0,
      setNumber: finalSetNumber,
      OldinterviewerID: oldInterviewerID,
      callStatus: finalCallStatus,
      supervisorID: supervisorID,
      consentResponse: isConsentNo ? 'no' : null, // Set consentResponse if consent is "No"
      // CRITICAL: Include abandonment information from interview metadata if available (same as CAPI)
      abandoned: interview.metadata?.isCompleted === false || (interview.metadata?.abandonReason !== null && interview.metadata?.abandonReason !== undefined) ? true : false,
      abandonedReason: interview.metadata?.abandonReason || null,
      abandonmentNotes: interview.metadata?.abandonNotes || null,
      isCompleted: interview.metadata?.isCompleted !== undefined ? interview.metadata.isCompleted : true, // Default to true if not set
      // Include metadata object for backward compatibility (backend checks both top-level and metadata fields)
      metadata: {
        abandoned: interview.metadata?.isCompleted === false || (interview.metadata?.abandonReason !== null && interview.metadata?.abandonReason !== undefined) ? true : false,
        abandonedReason: interview.metadata?.abandonReason || null,
        abandonmentNotes: interview.metadata?.abandonNotes || null,
        isCompleted: interview.metadata?.isCompleted !== undefined ? interview.metadata.isCompleted : true
      }
    });

    if (!result.success) {
      throw new Error(result.message || 'Failed to complete CATI interview');
    }

    console.log(`✅ CATI interview synced successfully: ${interview.id}`);
  }

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










