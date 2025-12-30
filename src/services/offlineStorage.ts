import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { offlineDataCache } from './offlineDataCache';

// Storage keys
const STORAGE_KEYS = {
  SURVEYS: 'offline_surveys',
  OFFLINE_INTERVIEWS: 'offline_interviews',
  SYNC_QUEUE: 'sync_queue',
  LAST_SYNC: 'last_sync',
  SURVEY_DOWNLOAD_TIME: 'survey_download_time',
};

export interface OfflineInterview {
  id: string; // Local ID
  surveyId: string;
  survey: any; // Full survey object
  surveyName?: string; // Store survey name separately for display (lightweight)
  sessionId?: string; // Server session ID if available
  catiQueueId?: string; // For CATI interviews
  callId?: string; // For CATI interviews
  isCatiMode: boolean;
  responses: Record<string, any>;
  locationData: any;
  selectedAC?: string | null;
  selectedPollingStation?: any;
  selectedSetNumber?: number | null;
  startTime: string;
  endTime?: string;
  duration: number;
  audioUri?: string | null; // Original URI (for reference)
  audioOfflinePath?: string | null; // Copied file path (safe storage)
  audioUploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  audioUploadError?: string | null;
  metadata: {
    qualityMetrics?: any;
    callStatus?: string; // For CATI
    supervisorID?: string; // For CATI
    audioUrl?: string; // Server audio URL after upload
    [key: string]: any;
  };
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  syncAttempts: number;
  lastSyncAttempt?: string;
  error?: string;
}

export interface SyncQueueItem {
  interviewId: string;
  type: 'complete' | 'abandon';
  data: any;
  timestamp: string;
  attempts: number;
}

class OfflineStorageService {
  private isDownloadingDependentData = false;
  
  // ========== Survey Management ==========
  
  /**
   * Save surveys to local storage
   * @param surveys - Array of surveys to save
   * @param downloadDependentData - If true, also download all dependent data (groups, polling stations, etc.)
   */
  async saveSurveys(surveys: any[], downloadDependentData: boolean = false): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SURVEYS, JSON.stringify(surveys));
      await AsyncStorage.setItem(STORAGE_KEYS.SURVEY_DOWNLOAD_TIME, new Date().toISOString());
      console.log('✅ Saved', surveys.length, 'surveys to local storage');
      
      // If requested, download all dependent data immediately
      if (downloadDependentData && surveys.length > 0) {
        // Prevent multiple simultaneous downloads
        if (this.isDownloadingDependentData) {
          console.log('⚠️ Dependent data download already in progress, skipping...');
        } else {
          try {
            this.isDownloadingDependentData = true;
            console.log('📥 Downloading all dependent data for surveys...');
            // GPS data is fetched on-demand during interviews, no need to download upfront
            await offlineDataCache.downloadDependentDataForSurveys(surveys, false);
            console.log('✅ All dependent data downloaded and cached');
          } catch (dependentDataError) {
            console.error('❌ Error downloading dependent data:', dependentDataError);
            // Don't throw - survey save succeeded, dependent data is optional
          } finally {
            this.isDownloadingDependentData = false;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error saving surveys:', error);
      throw error;
    }
  }

  /**
   * Get surveys from local storage
   */
  async getSurveys(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SURVEYS);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error getting surveys:', error);
      return [];
    }
  }

  /**
   * Get a specific survey by ID
   */
  async getSurveyById(surveyId: string): Promise<any | null> {
    try {
      const surveys = await this.getSurveys();
      return surveys.find(s => s._id === surveyId) || null;
    } catch (error) {
      console.error('❌ Error getting survey by ID:', error);
      return null;
    }
  }

  /**
   * Check if surveys are downloaded
   */
  async hasSurveys(): Promise<boolean> {
    try {
      const surveys = await this.getSurveys();
      return surveys.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get last survey download time
   */
  async getLastDownloadTime(): Promise<Date | null> {
    try {
      const timeStr = await AsyncStorage.getItem(STORAGE_KEYS.SURVEY_DOWNLOAD_TIME);
      return timeStr ? new Date(timeStr) : null;
    } catch (error) {
      return null;
    }
  }

  // ========== Interview Management ==========

  /**
   * Save an offline interview
   */
  async saveOfflineInterview(interview: OfflineInterview): Promise<void> {
    try {
      // Remove full survey object to reduce storage size (will be fetched from cache during sync)
      // But keep surveyName for display purposes
      const interviewToSave = {
        ...interview,
        survey: null, // Don't store full survey - fetch from cache during sync using surveyId
        // Keep surveyName if it exists (for display)
        surveyName: interview.surveyName || interview.survey?.surveyName || undefined,
      };
      
      const interviews = await this.getOfflineInterviews();
      const existingIndex = interviews.findIndex(i => i.id === interview.id);
      
      if (existingIndex >= 0) {
        console.log(`🔄 Updating existing offline interview: ${interview.id} (old status: ${interviews[existingIndex].status}, new status: ${interview.status})`);
        // Remove survey from existing interview too
        interviews[existingIndex] = {
          ...interviewToSave,
          survey: null,
        };
      } else {
        console.log(`➕ Adding new offline interview: ${interview.id} (status: ${interview.status || 'pending'})`);
        // Ensure status is set to 'pending' if not provided
        if (!interviewToSave.status) {
          interviewToSave.status = 'pending';
        }
        interviews.push(interviewToSave);
      }
      
      // Check size before saving
      const dataString = JSON.stringify(interviews);
      const sizeInMB = dataString.length / (1024 * 1024);
      console.log(`📊 Offline interviews data size: ${sizeInMB.toFixed(2)} MB (${interviews.length} interviews)`);
      
      if (dataString.length > 2000000) { // ~2MB warning
        console.warn(`⚠️ Offline interviews data is large: ${sizeInMB.toFixed(2)} MB - consider syncing soon`);
      }
      
      await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_INTERVIEWS, JSON.stringify(interviews));
      console.log('✅ Saved offline interview:', interview.id, `(Total in storage: ${interviews.length}, Status: ${interview.status})`);
    } catch (error: any) {
      console.error('❌ Error saving offline interview:', error);
      
      // If it's a "Row too big" error, try to save without survey
      if (error.message && error.message.includes('Row too big')) {
        console.error('❌ Row too big error - interview data is too large');
        console.error('❌ This interview cannot be saved. Please sync existing interviews first or reduce interview data size.');
        throw new Error('Interview data too large to save. Please sync existing interviews first.');
      }
      
      throw error;
    }
  }

  /**
   * Get all offline interviews
   * Handles AsyncStorage "Row too big" errors gracefully
   */
  async getOfflineInterviews(): Promise<OfflineInterview[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_INTERVIEWS);
      if (!data) {
        console.log('📦 No offline interviews found in AsyncStorage');
        return [];
      }
      
      // Check if data is too large (AsyncStorage has ~6MB limit per key)
      // If data is very large, try to parse and filter out corrupted entries
      if (data.length > 5000000) { // ~5MB threshold
        console.warn('⚠️ Offline interviews data is very large:', data.length, 'bytes');
        console.warn('⚠️ Attempting to parse and filter...');
      }
      
      const interviews = JSON.parse(data);
      console.log(`📦 Retrieved ${interviews.length} offline interviews from AsyncStorage`);
      
      // Validate and filter out corrupted interviews
      const validInterviews = interviews.filter((interview: any) => {
        if (!interview || typeof interview !== 'object') {
          console.warn('⚠️ Found invalid interview entry (not an object)');
          return false;
        }
        if (!interview.id) {
          console.warn('⚠️ Found interview without ID');
          return false;
        }
        // Check if interview data is suspiciously large (might be corrupted)
        const interviewSize = JSON.stringify(interview).length;
        if (interviewSize > 2000000) { // ~2MB per interview is suspicious
          console.warn(`⚠️ Interview ${interview.id} is suspiciously large: ${interviewSize} bytes - marking as corrupted`);
          return false;
        }
        return true;
      });
      
      if (validInterviews.length < interviews.length) {
        const removedCount = interviews.length - validInterviews.length;
        console.warn(`⚠️ Removed ${removedCount} corrupted/invalid interview(s)`);
        // Save cleaned data back
        try {
          await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_INTERVIEWS, JSON.stringify(validInterviews));
          console.log('✅ Cleaned and saved valid interviews');
        } catch (saveError) {
          console.error('❌ Error saving cleaned interviews:', saveError);
        }
      }
      
      return validInterviews;
    } catch (error: any) {
      console.error('❌ Error getting offline interviews:', error);
      
      // Handle "Row too big" error specifically
      if (error.message && error.message.includes('Row too big')) {
        console.error('❌ AsyncStorage row too big - attempting to clear corrupted data...');
        try {
          // Try to get the data in chunks or clear it
          await AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_INTERVIEWS);
          console.log('✅ Cleared corrupted offline interviews data');
          return [];
        } catch (clearError) {
          console.error('❌ Error clearing corrupted data:', clearError);
        }
      }
      
      return [];
    }
  }

  /**
   * Get pending interviews (not synced)
   * FIX: Now includes stuck 'syncing' interviews that are older than 5 minutes
   */
  async getPendingInterviews(): Promise<OfflineInterview[]> {
    try {
      const interviews = await this.getOfflineInterviews();
      const now = new Date();
      const STUCK_SYNCING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      
      // Process interviews: reset stuck 'syncing' interviews
      let hasStuckInterviews = false;
      const processedInterviews = interviews.map(i => {
        // If interview is stuck in 'syncing' status for more than 5 minutes, reset it to 'failed'
        if (i.status === 'syncing' && i.lastSyncAttempt) {
          const lastAttempt = new Date(i.lastSyncAttempt);
          const timeSinceAttempt = now.getTime() - lastAttempt.getTime();
          
          if (timeSinceAttempt > STUCK_SYNCING_THRESHOLD_MS) {
            console.log(`⚠️ Interview ${i.id} is stuck in 'syncing' status for ${Math.round(timeSinceAttempt / 1000 / 60)} minutes - resetting to 'failed'`);
            hasStuckInterviews = true;
            return {
              ...i,
              status: 'failed' as const,
              error: i.error || 'Reset from stuck syncing status',
              lastSyncAttempt: new Date().toISOString()
            };
          }
        }
        return i;
      });
      
      // Save updated interviews if any were reset
      if (hasStuckInterviews) {
        try {
          await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_INTERVIEWS, JSON.stringify(processedInterviews));
          console.log('✅ Reset stuck syncing interviews and saved updated status');
        } catch (saveError) {
          console.error('❌ Error saving reset interviews:', saveError);
        }
      }
      
      // Include interviews with status 'pending', 'failed', 'syncing' (recent), or no status (legacy)
      const pending = processedInterviews.filter(i => {
        const status = i.status;
        
        // Always include pending and failed
        if (!status || status === 'pending' || status === 'failed') {
          return true;
        }
        
        // Include 'syncing' if it's recent (not stuck)
        if (status === 'syncing') {
          if (i.lastSyncAttempt) {
            const lastAttempt = new Date(i.lastSyncAttempt);
            const timeSinceAttempt = now.getTime() - lastAttempt.getTime();
            // Include if syncing started less than 5 minutes ago
            return timeSinceAttempt <= STUCK_SYNCING_THRESHOLD_MS;
          }
          // If no lastSyncAttempt, include it (will be processed)
          return true;
        }
        
        return false;
      });
      
      console.log(`📊 getPendingInterviews: Found ${pending.length} pending interviews out of ${interviews.length} total`);
      if (hasStuckInterviews) {
        console.log(`⚠️ Reset ${processedInterviews.filter((i, idx) => interviews[idx].status === 'syncing' && i.status === 'failed').length} stuck 'syncing' interviews to 'failed'`);
      }
      return pending;
    } catch (error) {
      console.error('❌ Error getting pending interviews:', error);
      return [];
    }
  }

  /**
   * Get an offline interview by ID
   */
  async getOfflineInterviewById(interviewId: string): Promise<OfflineInterview | null> {
    try {
      const interviews = await this.getOfflineInterviews();
      return interviews.find(i => i.id === interviewId) || null;
    } catch (error) {
      console.error('❌ Error getting offline interview by ID:', error);
      return null;
    }
  }

  /**
   * Update interview status
   */
  async updateInterviewStatus(interviewId: string, status: OfflineInterview['status'], error?: string): Promise<void> {
    try {
      const interviews = await this.getOfflineInterviews();
      const interview = interviews.find(i => i.id === interviewId);
      if (interview) {
        interview.status = status;
        interview.lastSyncAttempt = new Date().toISOString();
        if (error) {
          interview.error = error;
          interview.syncAttempts = (interview.syncAttempts || 0) + 1;
        }
        await this.saveOfflineInterview(interview);
      }
    } catch (error) {
      console.error('❌ Error updating interview status:', error);
      throw error;
    }
  }

  /**
   * Fix 3: Atomic metadata and status update
   * Updates both metadata and status in a single atomic operation
   */
  async updateInterviewMetadataAndStatus(
    interviewId: string, 
    metadataUpdates: Partial<OfflineInterview['metadata']>, 
    status: OfflineInterview['status'],
    error?: string
  ): Promise<void> {
    try {
      const interviews = await this.getOfflineInterviews();
      const interview = interviews.find(i => i.id === interviewId);
      if (interview) {
        // Update metadata and status atomically (in one object update)
        interview.metadata = {
          ...interview.metadata,
          ...metadataUpdates,
        };
        interview.status = status;
        interview.lastSyncAttempt = new Date().toISOString();
        if (error) {
          interview.error = error;
          interview.syncAttempts = (interview.syncAttempts || 0) + 1;
        }
        // Save entire object atomically - this ensures metadata and status are updated together
        await this.saveOfflineInterview(interview);
        console.log(`✅ Atomically updated interview ${interviewId} metadata and status to ${status}`);
      } else {
        console.warn(`⚠️ Interview ${interviewId} not found for atomic update`);
      }
    } catch (error) {
      console.error('❌ Error atomically updating interview metadata and status:', error);
      throw error;
    }
  }

  /**
   * Manually change interview status (for fixing stuck interviews)
   */
  async changeInterviewStatus(interviewId: string, newStatus: OfflineInterview['status'], error?: string): Promise<void> {
    try {
      const interviews = await this.getOfflineInterviews();
      const interview = interviews.find(i => i.id === interviewId);
      if (!interview) {
        throw new Error(`Interview ${interviewId} not found`);
      }
      
      console.log(`📝 Manually changing interview ${interviewId} status from ${interview.status} to ${newStatus}`);
      
      interview.status = newStatus;
      interview.lastSyncAttempt = new Date().toISOString();
      if (error !== undefined) {
        interview.error = error || undefined;
      }
      // Reset sync attempts if changing to pending
      if (newStatus === 'pending') {
        interview.syncAttempts = 0;
      }
      
      await this.saveOfflineInterview(interview);
      console.log(`✅ Interview ${interviewId} status changed to ${newStatus}`);
    } catch (error) {
      console.error('❌ Error changing interview status:', error);
      throw error;
    }
  }

  /**
   * Export interview data and audio for manual sharing
   * Returns interview data as JSON string and audio file path (if exists)
   */
  async exportInterviewForSharing(interviewId: string): Promise<{
    interviewData: string;
    audioPath?: string;
    audioExists: boolean;
  }> {
    try {
      const interview = await this.getOfflineInterviewById(interviewId);
      if (!interview) {
        throw new Error(`Interview ${interviewId} not found`);
      }

      console.log('📋 Exporting interview:', {
        interviewId,
        startTime: interview.startTime,
        endTime: interview.endTime,
        duration: interview.duration,
        audioOfflinePath: interview.audioOfflinePath || 'NOT SET',
        audioUri: interview.audioUri || 'NOT SET'
      });

      // Check if audio file exists BEFORE preparing export data
      // CRITICAL: Verify the audio file actually belongs to this interview by checking filename
      let audioPath: string | undefined;
      let audioExists = false;
      let audioFileSize: number = 0;

      if (interview.audioOfflinePath) {
        try {
          // Verify audio file path contains the interview ID (CRITICAL SAFETY CHECK)
          const audioFilename = interview.audioOfflinePath.split('/').pop() || '';
          const expectedPrefix = `audio_${interviewId}`;
          
          console.log('🔍 Verifying audio file match:', {
            audioFilename,
            expectedPrefix,
            interviewId,
            matches: audioFilename.startsWith(expectedPrefix)
          });
          
          if (!audioFilename.startsWith(expectedPrefix)) {
            console.error(`❌ AUDIO MISMATCH DETECTED!`);
            console.error(`❌ Interview ID: ${interviewId}`);
            console.error(`❌ Expected filename prefix: ${expectedPrefix}`);
            console.error(`❌ Actual audio filename: ${audioFilename}`);
            console.error(`❌ Audio path in interview: ${interview.audioOfflinePath}`);
            console.error(`❌ This audio file does NOT belong to this interview - SKIPPING for safety`);
            
            // Check if there's a matching audio file in the directory
            try {
              const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
              const offlineAudioDir = `${baseDir}offline_audio/`;
              const dirInfo = await FileSystem.getInfoAsync(offlineAudioDir);
              
              if (dirInfo.exists && dirInfo.isDirectory) {
                // Try to find the correct audio file
                const correctFilename = `${expectedPrefix}_*.m4a`;
                console.log(`🔍 Looking for correct audio file matching: ${correctFilename}`);
                // Note: FileSystem doesn't have list directory, so we can't easily search
                // But we can try to construct the most likely filename based on interview start time
                const interviewStartTime = interview.startTime ? new Date(interview.startTime).getTime() : null;
                if (interviewStartTime) {
                  // The filename format is: audio_{interviewId}_{timestamp}.m4a
                  // The timestamp is when the file was copied, which should be close to startTime
                  // Let's try a few timestamps around the start time
                  for (let offset = -60000; offset <= 60000; offset += 10000) { // ±60 seconds in 10s increments
                    const testTimestamp = interviewStartTime + offset;
                    const testFilename = `${expectedPrefix}_${testTimestamp}.m4a`;
                    const testPath = `${offlineAudioDir}${testFilename}`;
                    try {
                      const testInfo = await FileSystem.getInfoAsync(testPath);
                      if (testInfo.exists) {
                        console.log(`✅ Found matching audio file: ${testFilename}`);
                        audioPath = testPath;
                        audioExists = true;
                        audioFileSize = testInfo.size || 0;
                        console.log('✅ Using corrected audio file path:', audioPath);
                        break;
                      }
                    } catch (e) {
                      // Continue searching
                    }
                  }
                }
              }
              
              if (!audioExists) {
                console.warn('⚠️ Could not find matching audio file - skipping audio export for safety');
              }
            } catch (searchError) {
              console.error('Error searching for correct audio file:', searchError);
            }
          } else {
            // Filename matches - verify file exists
            const audioInfo = await FileSystem.getInfoAsync(interview.audioOfflinePath);
            if (audioInfo.exists) {
              audioPath = interview.audioOfflinePath;
              audioExists = true;
              audioFileSize = audioInfo.size || 0;
              console.log('✅ Audio file verified and found for export:', audioPath, 'Size:', audioFileSize, 'bytes');
              console.log('✅ Audio filename matches interview ID:', audioFilename);
            } else {
              console.warn('⚠️ Audio file path exists in interview but file not found:', interview.audioOfflinePath);
            }
          }
        } catch (audioError) {
          console.error('⚠️ Error verifying/checking audio file:', audioError);
          console.warn('⚠️ Skipping audio export due to verification error');
        }
      } else if (interview.audioUri) {
        // Fallback to original audioUri if audioOfflinePath is not set
        // Note: audioUri might not contain interview ID, so we'll use it but log a warning
        try {
          const audioInfo = await FileSystem.getInfoAsync(interview.audioUri);
          if (audioInfo.exists) {
            const audioFilename = interview.audioUri.split('/').pop() || '';
            console.warn('⚠️ Using original audioUri (not offline copy) - cannot verify interview ID match:', audioFilename);
            audioPath = interview.audioUri;
            audioExists = true;
            audioFileSize = audioInfo.size || 0;
            console.log('✅ Audio file found (using audioUri) for export:', audioPath, 'Size:', audioFileSize, 'bytes');
          }
        } catch (audioError) {
          console.warn('⚠️ Could not check original audio file:', audioError);
        }
      } else {
        console.log('ℹ️ No audio file path stored for this interview (audioOfflinePath and audioUri both null)');
      }

      // Prepare export data (include all interview information + audio info)
      const exportData = {
        interviewId: interview.id,
        sessionId: interview.sessionId,
        surveyId: interview.surveyId,
        surveyName: interview.surveyName,
        isCatiMode: interview.isCatiMode,
        responses: interview.responses,
        locationData: interview.locationData,
        selectedAC: interview.selectedAC,
        selectedPollingStation: interview.selectedPollingStation,
        selectedSetNumber: interview.selectedSetNumber,
        startTime: interview.startTime,
        endTime: interview.endTime,
        duration: interview.duration,
        metadata: interview.metadata,
        status: interview.status,
        syncAttempts: interview.syncAttempts,
        lastSyncAttempt: interview.lastSyncAttempt,
        error: interview.error,
        // Include audio information in export
        audioInfo: {
          hasAudio: audioExists,
          audioPath: audioPath || null,
          audioFileSize: audioFileSize,
          audioOfflinePath: interview.audioOfflinePath || null,
          audioUri: interview.audioUri || null,
          note: audioExists 
            ? `Audio file is stored at: ${audioPath}. Use the audio path to access the audio file from the device.`
            : 'Audio file not found. It may have been deleted or was not recorded.'
        },
        exportedAt: new Date().toISOString(),
        appVersion: '12'
      };

      const interviewDataJson = JSON.stringify(exportData, null, 2);

      return {
        interviewData: interviewDataJson,
        audioPath,
        audioExists
      };
    } catch (error) {
      console.error('❌ Error exporting interview:', error);
      throw error;
    }
  }

  /**
   * Delete a synced interview
   */
  async deleteSyncedInterview(interviewId: string): Promise<void> {
    try {
      const interviews = await this.getOfflineInterviews();
      const filtered = interviews.filter(i => i.id !== interviewId);
      await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_INTERVIEWS, JSON.stringify(filtered));
      console.log('✅ Deleted synced interview:', interviewId);
    } catch (error) {
      console.error('❌ Error deleting synced interview:', error);
      throw error;
    }
  }

  /**
   * Generate a unique local interview ID
   */
  generateInterviewId(): string {
    return `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Copy audio file to permanent offline storage location
   * This ensures audio files are not deleted by OS cleanup
   */
  async copyAudioFileToOfflineStorage(audioUri: string, interviewId: string): Promise<string> {
    try {
      // Check if FileSystem is available
      if (!FileSystem) {
        throw new Error('FileSystem is not available. Make sure expo-file-system is properly installed.');
      }
      
      // Check if documentDirectory is available (it should always be available in Expo)
      if (!FileSystem.documentDirectory) {
        // Try to use cacheDirectory as fallback (though documentDirectory should always exist)
        console.warn('⚠️ FileSystem.documentDirectory is not available, checking cacheDirectory...');
        if (!FileSystem.cacheDirectory) {
          throw new Error('Neither FileSystem.documentDirectory nor FileSystem.cacheDirectory is available.');
        }
        console.warn('⚠️ Using cacheDirectory as fallback for audio storage');
      }
      
      // Use documentDirectory if available, otherwise fallback to cacheDirectory
      const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!baseDir) {
        throw new Error('No valid directory available for audio storage');
      }
      
      // Create offline audio directory if it doesn't exist
      const offlineAudioDir = `${baseDir}offline_audio/`;
      const dirInfo = await FileSystem.getInfoAsync(offlineAudioDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(offlineAudioDir, { intermediates: true });
        console.log('✅ Created offline audio directory:', offlineAudioDir);
      }
      
      // Check if source file exists
      const sourceInfo = await FileSystem.getInfoAsync(audioUri);
      if (!sourceInfo.exists) {
        throw new Error(`Source audio file does not exist: ${audioUri}`);
      }
      
      // Generate unique filename
      const extension = audioUri.split('.').pop() || 'm4a';
      const filename = `audio_${interviewId}_${Date.now()}.${extension}`;
      const destPath = `${offlineAudioDir}${filename}`;
      
      // Copy file to offline storage
      await FileSystem.copyAsync({
        from: audioUri,
        to: destPath,
      });
      
      // Verify copy was successful
      const destInfo = await FileSystem.getInfoAsync(destPath);
      if (!destInfo.exists) {
        throw new Error('Audio file copy failed - destination file does not exist');
      }
      
      console.log('✅ Audio file copied to offline storage:', destPath);
      console.log('📊 Audio file size:', destInfo.size, 'bytes');
      return destPath;
    } catch (error: any) {
      console.error('❌ Error copying audio file:', error);
      console.error('❌ FileSystem object:', FileSystem ? 'exists' : 'undefined');
      console.error('❌ FileSystem.documentDirectory:', FileSystem?.documentDirectory || 'undefined');
      console.error('❌ FileSystem.cacheDirectory:', FileSystem?.cacheDirectory || 'undefined');
      throw new Error(`Failed to copy audio file to offline storage: ${error.message}`);
    }
  }

  /**
   * Delete audio file from offline storage
   */
  async deleteAudioFileFromOfflineStorage(audioOfflinePath: string): Promise<void> {
    try {
      // Check if FileSystem is available
      if (!FileSystem) {
        console.warn('⚠️ FileSystem is not available, cannot delete audio file');
        return;
      }
      
      // Check if file exists before attempting to delete
      const fileInfo = await FileSystem.getInfoAsync(audioOfflinePath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(audioOfflinePath, { idempotent: true });
        console.log('✅ Deleted audio file from offline storage:', audioOfflinePath);
      } else {
        console.log('ℹ️ Audio file does not exist, skipping deletion:', audioOfflinePath);
      }
    } catch (error: any) {
      console.error('❌ Error deleting audio file:', error);
      // Don't throw - cleanup is not critical, but log for debugging
      console.error('❌ FileSystem object:', FileSystem ? 'exists' : 'undefined');
      if (FileSystem) {
        console.error('❌ FileSystem.documentDirectory:', FileSystem.documentDirectory || 'undefined');
        console.error('❌ FileSystem.cacheDirectory:', FileSystem.cacheDirectory || 'undefined');
      }
    }
  }

  // ========== Sync Queue Management ==========

  /**
   * Add item to sync queue
   */
  async addToSyncQueue(item: SyncQueueItem): Promise<void> {
    try {
      const queue = await this.getSyncQueue();
      queue.push(item);
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
      console.log('✅ Added to sync queue:', item.interviewId);
    } catch (error) {
      console.error('❌ Error adding to sync queue:', error);
      throw error;
    }
  }

  /**
   * Get sync queue
   */
  async getSyncQueue(): Promise<SyncQueueItem[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error getting sync queue:', error);
      return [];
    }
  }

  /**
   * Remove item from sync queue
   */
  async removeFromSyncQueue(interviewId: string): Promise<void> {
    try {
      const queue = await this.getSyncQueue();
      const filtered = queue.filter(item => item.interviewId !== interviewId);
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(filtered));
    } catch (error) {
      console.error('❌ Error removing from sync queue:', error);
      throw error;
    }
  }

  /**
   * Clear sync queue
   */
  async clearSyncQueue(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_QUEUE);
    } catch (error) {
      console.error('❌ Error clearing sync queue:', error);
    }
  }

  // ========== Utility Methods ==========

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    try {
      // Simple check - try to fetch a small resource
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors',
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    surveysCount: number;
    offlineInterviewsCount: number;
    pendingInterviewsCount: number;
    syncQueueCount: number;
    lastSyncTime: Date | null;
  }> {
    try {
      const surveys = await this.getSurveys();
      const interviews = await this.getOfflineInterviews();
      const pending = await this.getPendingInterviews();
      const queue = await this.getSyncQueue();
      const lastSyncStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
      
      return {
        surveysCount: surveys.length,
        offlineInterviewsCount: interviews.length,
        pendingInterviewsCount: pending.length,
        syncQueueCount: queue.length,
        lastSyncTime: lastSyncStr ? new Date(lastSyncStr) : null,
      };
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return {
        surveysCount: 0,
        offlineInterviewsCount: 0,
        pendingInterviewsCount: 0,
        syncQueueCount: 0,
        lastSyncTime: null,
      };
    }
  }

  /**
   * Clear all offline data (use with caution)
   */
  async clearAllOfflineData(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.SURVEYS,
        STORAGE_KEYS.OFFLINE_INTERVIEWS,
        STORAGE_KEYS.SYNC_QUEUE,
        STORAGE_KEYS.LAST_SYNC,
        STORAGE_KEYS.SURVEY_DOWNLOAD_TIME,
      ]);
      console.log('✅ Cleared all offline data');
    } catch (error) {
      console.error('❌ Error clearing offline data:', error);
      throw error;
    }
  }

  /**
   * Update last sync time
   */
  async updateLastSyncTime(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    } catch (error) {
      console.error('❌ Error updating last sync time:', error);
    }
  }
}

export const offlineStorage = new OfflineStorageService();
