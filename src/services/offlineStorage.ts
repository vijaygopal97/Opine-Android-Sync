import AsyncStorage from '@react-native-async-storage/async-storage';

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
  audioUri?: string | null;
  metadata: {
    qualityMetrics?: any;
    callStatus?: string; // For CATI
    supervisorID?: string; // For CATI
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
            const { offlineDataCache } = await import('./offlineDataCache');
            // Always include GPS data for geofencing to work offline
            await offlineDataCache.downloadDependentDataForSurveys(surveys, true);
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
   */
  async getPendingInterviews(): Promise<OfflineInterview[]> {
    try {
      const interviews = await this.getOfflineInterviews();
      // Include interviews with status 'pending', 'failed', or no status (legacy)
      const pending = interviews.filter(i => {
        const status = i.status;
        return !status || status === 'pending' || status === 'failed';
      });
      console.log(`📊 getPendingInterviews: Found ${pending.length} pending interviews out of ${interviews.length} total`);
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
