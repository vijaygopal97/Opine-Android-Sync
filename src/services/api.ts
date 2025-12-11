import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineStorage } from './offlineStorage';
// Note: offlineDataCache is imported dynamically in each method to avoid circular dependency

const API_BASE_URL = 'https://convo.convergentview.com';

class ApiService {
  private baseURL: string;
  private offlineDataCacheModule: any = null;

  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // Helper to safely get offline cache (lazy load with error handling)
  private async getOfflineCache() {
    if (this.offlineDataCacheModule) {
      return this.offlineDataCacheModule;
    }
    try {
      const module = await import('./offlineDataCache');
      this.offlineDataCacheModule = module.offlineDataCache;
      return this.offlineDataCacheModule;
    } catch (error) {
      console.log('⚠️ Offline cache not available:', error);
      return null;
    }
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('authToken');
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }

  private async getHeaders(): Promise<any> {
    const token = await this.getAuthToken();
    console.log('🔍 API Service - Auth token exists:', !!token);
    console.log('🔍 API Service - Token preview:', token ? token.substring(0, 20) + '...' : 'No token');
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  /**
   * Normalize AC name to match master data spelling
   * This handles common spelling mismatches between survey data and polling station master data
   */
  normalizeACName(acName: string): string {
    if (!acName || typeof acName !== 'string') return acName;
    
    // Common AC name mappings based on master data spelling (from polling_stations.json)
    // Master data uses: "COOCHBEHAR DAKSHIN" (all caps, no space in "COOCHBEHAR")
    const acNameMappings: Record<string, string> = {
      // Cooch Behar variations -> COOCHBEHAR (no space, all caps)
      'Cooch Behar Uttar': 'COOCHBEHAR UTTAR (SC)',
      'Cooch Behar Dakshin': 'COOCHBEHAR DAKSHIN',
      'Coochbehar Uttar': 'COOCHBEHAR UTTAR (SC)',
      'Coochbehar Dakshin': 'COOCHBEHAR DAKSHIN',
      'COOCH BEHAR UTTAR': 'COOCHBEHAR UTTAR (SC)',
      'COOCH BEHAR DAKSHIN': 'COOCHBEHAR DAKSHIN',
      'cooch behar uttar': 'COOCHBEHAR UTTAR (SC)',
      'cooch behar dakshin': 'COOCHBEHAR DAKSHIN',
      // Add more mappings as needed
    };
    
    // Check exact match first
    if (acNameMappings[acName]) {
      return acNameMappings[acName];
    }
    
    // Try case-insensitive match
    const normalized = acName.trim();
    for (const [key, value] of Object.entries(acNameMappings)) {
      if (key.toLowerCase() === normalized.toLowerCase()) {
        return value;
      }
    }
    
    // If no mapping found, return original
    return acName;
  }

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    try {
      // Use a shorter timeout for faster response
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if request should fail due to offline mode
   * Returns true if offline and operation requires internet
   */
  private async checkOfflineMode(requiresInternet: boolean = true): Promise<{ isOffline: boolean; error?: string }> {
    const isOnline = await this.isOnline();
    if (!isOnline && requiresInternet) {
      return {
        isOffline: true,
        error: 'No internet connection. Please connect to the internet and try again.',
      };
    }
    return { isOffline: false };
  }

  // Authentication
  async login(identifier: string, password: string) {
    try {
      console.log('🔐 Attempting login for:', identifier);
      const response = await axios.post(`${this.baseURL}/api/auth/login`, {
        email: identifier, // Backend expects 'email' but accepts email or memberId
        password,
      });

      console.log('Login response status:', response.status);
      console.log('Login response data:', response.data);

      if (response.data && response.data.success) {
        const { token, user } = response.data.data || {};
        
        // Validate token and user data before storing
        if (!token || !user) {
          console.error('❌ Invalid response: missing token or user data');
          return { success: false, message: 'Invalid response from server' };
        }
        
        console.log('✅ Login successful, storing credentials');
        // Store token and user data
        await AsyncStorage.setItem('authToken', token);
        await AsyncStorage.setItem('userData', JSON.stringify(user));
        
        return { success: true, token, user };
      } else {
        const errorMessage = response.data?.message || 'Login failed';
        console.error('❌ Login failed:', errorMessage);
        return { success: false, message: errorMessage };
      }
    } catch (error: any) {
      console.error('❌ Login error:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      console.error('❌ Error message:', error.message);
      
      const errorMessage = error.response?.data?.message || error.message || 'Login failed. Please try again.';
      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  async verifyToken() {
    try {
      const headers = await this.getHeaders();
      // Use the /api/auth/me endpoint which should exist
      const response = await axios.get(`${this.baseURL}/api/auth/me`, { 
        headers,
        timeout: 10000 // 10 second timeout
      });
      return { success: true, user: response.data.user };
    } catch (error: any) {
      console.error('Token verification error:', error);
      return { success: false, error: error.message };
    }
  }

  async logout() {
    try {
      const headers = await this.getHeaders();
      await axios.post(`${this.baseURL}/api/auth/logout`, {}, { headers });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Always clear local storage
      try {
        await AsyncStorage.multiRemove(['authToken', 'userData']);
      } catch (storageError) {
        console.error('Error clearing storage:', storageError);
      }
    }
  }

  // Surveys
  async getAvailableSurveys(filters?: { mode?: string; search?: string }) {
    try {
      const headers = await this.getHeaders();
      let url = `${this.baseURL}/api/surveys/available`;
      
      // Add query parameters if filters are provided
      if (filters) {
        const params = new URLSearchParams();
        if (filters.mode && filters.mode !== 'all') {
          params.append('mode', filters.mode);
        }
        if (filters.search) {
          params.append('search', filters.search);
        }
        if (params.toString()) {
          url += `?${params.toString()}`;
        }
      }
      
      const response = await axios.get(url, { headers });
      
      if (response.data.success) {
        return { 
          success: true, 
          surveys: response.data.data?.surveys || response.data.surveys || [] 
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Failed to fetch surveys',
        };
      }
    } catch (error: any) {
      console.error('Get available surveys error:', error);
      console.error('Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch surveys',
      };
    }
  }

  async getSurveyById(surveyId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/surveys/${surveyId}`, { headers });
      return { success: true, survey: response.data.survey };
    } catch (error: any) {
      console.error('Get survey error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to fetch survey',
      };
    }
  }

  // Survey Responses - Start interview session
  async startInterview(surveyId: string) {
    try {
      // Check if offline - for CAPI interviews, create local session
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline mode - creating local interview session');
        // Create a local session ID for offline interviews
        const localSessionId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Get survey from offline storage to check AC requirements
        const surveys = await offlineStorage.getSurveys();
        const survey = surveys.find((s: any) => s._id === surveyId || s.id === surveyId);
        
        // Determine if AC selection is required
        let requiresACSelection = false;
        let assignedACs: string[] = [];
        
        if (survey) {
          // Check for AC assignment in different assignment types
          if (survey.assignedInterviewers && survey.assignedInterviewers.length > 0) {
            const assignment = survey.assignedInterviewers.find((a: any) => a.status === 'assigned');
            if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
              requiresACSelection = survey.assignACs === true;
              assignedACs = assignment.assignedACs || [];
            }
          }
          
          // Check CAPI assignments
          if (survey.capiInterviewers && survey.capiInterviewers.length > 0) {
            const assignment = survey.capiInterviewers.find((a: any) => a.status === 'assigned');
            if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
              requiresACSelection = survey.assignACs === true;
              assignedACs = assignment.assignedACs || [];
            }
          }
        }
        
        // Create local session data
        const localSessionData = {
          sessionId: localSessionId,
          survey: surveyId,
          interviewMode: 'capi',
          startTime: new Date().toISOString(),
          requiresACSelection: requiresACSelection,
          assignedACs: assignedACs,
          acAssignmentState: survey?.acAssignmentState || 'West Bengal',
          status: 'active',
          isOffline: true, // Mark as offline session
        };
        
        return { 
          success: true, 
          response: localSessionData 
        };
      }
      
      // Online - use API
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/start/${surveyId}`,
        {},
        { headers }
      );
      return { success: true, response: response.data.data };
    } catch (error: any) {
      console.error('Start interview error:', error);
      console.error('🔍 Error response:', error.response?.data);
      console.error('🔍 Error status:', error.response?.status);
      
      // If network error and we're offline, create local session
      const isNetworkError = error.message?.includes('Network') || 
                            error.message?.includes('timeout') ||
                            error.code === 'NETWORK_ERROR' ||
                            !await this.isOnline();
      
      if (isNetworkError) {
        console.log('📴 Network error - creating local interview session');
        // Create a local session ID for offline interviews
        const localSessionId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Get survey from offline storage
        const surveys = await offlineStorage.getSurveys();
        const survey = surveys.find((s: any) => s._id === surveyId || s.id === surveyId);
        
        // Determine if AC selection is required
        let requiresACSelection = false;
        let assignedACs: string[] = [];
        
        if (survey) {
          if (survey.assignedInterviewers && survey.assignedInterviewers.length > 0) {
            const assignment = survey.assignedInterviewers.find((a: any) => a.status === 'assigned');
            if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
              requiresACSelection = survey.assignACs === true;
              assignedACs = assignment.assignedACs || [];
            }
          }
          
          if (survey.capiInterviewers && survey.capiInterviewers.length > 0) {
            const assignment = survey.capiInterviewers.find((a: any) => a.status === 'assigned');
            if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
              requiresACSelection = survey.assignACs === true;
              assignedACs = assignment.assignedACs || [];
            }
          }
        }
        
        // Create local session data
        const localSessionData = {
          sessionId: localSessionId,
          survey: surveyId,
          interviewMode: 'capi',
          startTime: new Date().toISOString(),
          requiresACSelection: requiresACSelection,
          assignedACs: assignedACs,
          acAssignmentState: survey?.acAssignmentState || 'West Bengal',
          status: 'active',
          isOffline: true, // Mark as offline session
        };
        
        return { 
          success: true, 
          response: localSessionData 
        };
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to start interview',
      };
    }
  }

  async saveResponse(responseId: string, data: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.put(
        `${this.baseURL}/api/survey-responses/${responseId}`,
        data,
        { headers }
      );
      return { success: true, response: response.data.response };
    } catch (error: any) {
      console.error('Save response error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to save response',
      };
    }
  }

  async saveInterviewProgress(responseId: string, responses: Record<string, any>) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.put(
        `${this.baseURL}/api/survey-responses/${responseId}/progress`,
        { responses },
        { headers }
      );
      return { success: true, response: response.data };
    } catch (error: any) {
      console.error('Save progress error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to save progress',
      };
    }
  }


  // Pause interview
  async pauseInterview(sessionId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/session/${sessionId}/pause`,
        {},
        { headers }
      );
      return { success: true, response: response.data };
    } catch (error: any) {
      console.error('Pause interview error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to pause interview',
      };
    }
  }

  // Resume interview
  async resumeInterview(sessionId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/session/${sessionId}/resume`,
        {},
        { headers }
      );
      return { success: true, response: response.data };
    } catch (error: any) {
      console.error('Resume interview error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to resume interview',
      };
    }
  }

  // Abandon interview - now accepts responses and metadata
  async abandonInterview(sessionId: string, responses?: any[], metadata?: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/session/${sessionId}/abandon`,
        {
          responses,
          metadata
        },
        { headers }
      );
      return { success: true, response: response.data };
    } catch (error: any) {
      console.error('Abandon interview error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to abandon interview',
      };
    }
  }

  // Upload audio file
  async uploadAudioFile(audioUri: string, sessionId: string, surveyId: string) {
    try {
      console.log('Uploading audio file:', { audioUri, sessionId, surveyId });
      
      // Check if this is a mock URI (for testing)
      // DO NOT allow mock URIs to be uploaded or saved to database
      if (audioUri.startsWith('mock://')) {
        console.error('❌ Mock audio URI detected - cannot upload mock files');
        return { 
          success: false, 
          message: 'Mock audio files cannot be uploaded. Please record a real audio file.'
        };
      }
      
      const formData = new FormData();
      
      // Create file object from URI - match web app format exactly
      // Determine file type based on URI extension
      const uriLower = audioUri.toLowerCase();
      let mimeType = 'audio/m4a'; // Default for React Native
      let extension = '.m4a';
      
      if (uriLower.includes('.wav')) {
        mimeType = 'audio/wav';
        extension = '.wav';
      } else if (uriLower.includes('.webm')) {
        mimeType = 'audio/webm';
        extension = '.webm';
      } else if (uriLower.includes('.m4a')) {
        mimeType = 'audio/m4a';
        extension = '.m4a';
      }
      
      const file = {
        uri: audioUri,
        type: mimeType,
        name: `interview_${sessionId}_${Date.now()}${extension}`,
      } as any;
      
      formData.append('audio', file);
      formData.append('sessionId', sessionId);
      formData.append('surveyId', surveyId);
      
      const headers = await this.getHeaders();
      // Remove Content-Type header to let FormData set it
      delete headers['Content-Type'];
      
      console.log('Uploading to:', `${this.baseURL}/api/survey-responses/upload-audio`);
      console.log('Headers:', headers);
      console.log('FormData file object:', file);
      
      // Use fetch with timeout and better error handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(`${this.baseURL}/api/survey-responses/upload-audio`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': headers.Authorization,
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload failed:', response.status, errorText);
        throw new Error(`Failed to upload audio: ${response.status} ${errorText}`);
      }
      
      const result = await response.json();
      console.log('Audio upload successful:', result);
      return { success: true, response: result.data };
    } catch (error: any) {
      console.error('Upload audio error:', error);
      
      // If it's a network error, return failure - DO NOT use mock URLs
      // The audio upload failed, so we should not save a mock URL to the database
      // The interview can still be completed without audio if needed
      if (error.message.includes('Network request failed') || error.name === 'AbortError') {
        console.error('❌ Network error during audio upload - upload failed');
        return {
          success: false,
          message: 'Network error - audio upload failed. Interview can be completed without audio.',
        };
      }
      
      return {
        success: false,
        message: error.message || 'Failed to upload audio',
      };
    }
  }

  // Complete interview
  async completeInterview(sessionId: string, interviewData: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/session/${sessionId}/complete`,
        interviewData,
        { headers }
      );
      return { success: true, response: response.data.data };
    } catch (error: any) {
      console.error('Complete interview error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to complete interview',
      };
    }
  }

  async getMyInterviews() {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/survey-responses/my-interviews`, { headers });
      
      if (response.data.success) {
        return { 
          success: true, 
          interviews: response.data.data?.interviews || response.data.interviews || [] 
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Failed to fetch interviews',
        };
      }
    } catch (error: any) {
      console.error('Get my interviews error:', error);
      console.error('Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to fetch interviews',
      };
    }
  }

  async getInterviewDetails(responseId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/survey-responses/${responseId}`, { headers });
      return { success: true, interview: response.data.interview };
    } catch (error: any) {
      console.error('Get interview details error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to fetch interview details',
      };
    }
  }

  // File upload
  async uploadAudio(audioUri: string, responseId: string) {
    try {
      const headers = await this.getHeaders();
      const formData = new FormData();
      
      formData.append('audio', {
        uri: audioUri,
        type: 'audio/m4a',
        name: 'interview_audio.m4a',
      } as any);
      
      formData.append('responseId', responseId);

      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/upload-audio`,
        formData,
        {
          headers: {
            ...headers,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      return { success: true, audioUrl: response.data.audioUrl };
    } catch (error: any) {
      console.error('Upload audio error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to upload audio',
      };
    }
  }

  // Get gender response counts for quota management
  async getGenderResponseCounts(surveyId: string) {
    try {
      // Check offline cache first (lazy import to avoid circular dependency)
      const cacheForRead = await this.getOfflineCache();
      if (cacheForRead) {
        try {
          const cachedData = await cacheForRead.getGenderQuotas(surveyId);
          if (cachedData) {
            console.log('📦 Using cached gender quotas for survey:', surveyId);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          // Cache read failed, continue without cache
        }
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached gender quotas for survey:', surveyId);
        return {
          success: false,
          message: 'No internet connection and no cached data available',
          error: 'OFFLINE_NO_CACHE'
        };
      }

      // Fetch from API
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/survey-responses/survey/${surveyId}/gender-counts`, { headers });
      
      // Cache the data
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.success && response.data.data) {
        try {
          await cacheForSave.saveGenderQuotas(surveyId, response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue without caching
        }
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Get gender response counts error:', error);
      console.error('🔍 Error response:', error.response?.data);
      console.error('🔍 Error status:', error.response?.status);
      
      // Try cache as fallback
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const cachedData = await cacheForFallback.getGenderQuotas(surveyId);
          if (cachedData) {
            console.log('📦 Using cached gender quotas as fallback for survey:', surveyId);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          // Cache not available, continue with error
        }
      }
      
      return {
        success: false,
        message: 'Failed to get gender response counts',
        error: error.message
      };
    }
  }

  // Get last CATI set number for a survey (to alternate sets)
  // CRITICAL: Always fetch from API to ensure proper set rotation - do NOT use cached data
  async getLastCatiSetNumber(surveyId: string, forceRefresh: boolean = true) {
    try {
      if (!surveyId) {
        return {
          success: false,
          message: 'Survey ID is required',
          error: 'Missing surveyId parameter'
        };
      }

      // Check if online - CATI requires internet connection
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - CATI set number requires internet connection');
        // Return error for offline - CATI interviews require internet
        return {
          success: false,
          message: 'Internet connection required for CATI set number',
          error: 'Offline mode'
        };
      }

      // CRITICAL: Always fetch from API to ensure proper set rotation
      // Do NOT use cached data for CATI set numbers as rotation depends on latest completed interviews
      console.log('🔄 Fetching latest CATI set number from API for survey:', surveyId);
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/survey-responses/survey/${surveyId}/last-cati-set`, { headers });
      
      // Update cache with latest data (for reference, but we won't use it for CATI)
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.success && response.data.data) {
        try {
          await cacheForSave.saveCatiSetNumber(surveyId, response.data.data);
          console.log('✅ Updated CATI set number cache:', response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue
          console.warn('⚠️ Failed to update CATI set number cache:', cacheError);
        }
      }
      
      return response.data;
    } catch (error: any) {
      console.error('❌ Error fetching CATI set number from API:', error);
      // For CATI, we should not use cached data as fallback - set rotation is critical
      // Only use cache if it's a network error and we have no other option
      if (error.response && error.response.status === 404) {
        // 404 means no previous CATI responses - this is expected for first interview
        console.log('ℹ️ No previous CATI responses found (404) - will default to Set 1');
        return {
          success: true,
          data: { nextSetNumber: null } // Frontend will default to Set 1
        };
      }
      
      // For other errors, try cache as last resort but log warning
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const cachedData = await cacheForFallback.getCatiSetNumber(surveyId);
          if (cachedData) {
            console.warn('⚠️ Using cached CATI set number as fallback (may be stale):', cachedData);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          // Cache not available
        }
      }
      
      // If we have an error response, return it
      if (error.response && error.response.data) {
        return error.response.data;
      }
      
      // Final fallback - return error
      return {
        success: false,
        message: 'Failed to get last CATI set number',
        error: error.message || 'Unknown error'
      };
    }
  }

  // Polling Station API methods
  async getGroupsByAC(state: string, acIdentifier: string) {
    try {
      // Normalize AC name to match master data spelling
      const normalizedAC = this.normalizeACName(acIdentifier);
      
      // Check offline cache first (lazy import) - try multiple variations
      const cacheForRead = await this.getOfflineCache();
      let cachedData = null;
      if (cacheForRead) {
        try {
          // Try normalized name first
          cachedData = await cacheForRead.getPollingGroups(state, normalizedAC);
          if (cachedData) {
            console.log('📦 Using cached polling groups for:', state, normalizedAC, '(normalized)');
          } else {
            // If not found, try original name
            cachedData = await cacheForRead.getPollingGroups(state, acIdentifier);
            if (cachedData) {
              console.log('📦 Using cached polling groups for:', state, acIdentifier, '(original)');
            } else {
              // Try case-insensitive search in all cached groups
              console.log('🔍 Cache miss for exact match, trying case-insensitive search...');
              const allGroups = await cacheForRead.getAllPollingGroups();
              const searchKey = `${state}::`;
              const lowerAC = acIdentifier.toLowerCase();
              const lowerNormalized = normalizedAC.toLowerCase();
              
              for (const [key, value] of Object.entries(allGroups)) {
                if (key.startsWith(searchKey)) {
                  const cachedAC = key.replace(searchKey, '');
                  const lowerCached = cachedAC.toLowerCase();
                  // Check if AC matches (case-insensitive)
                  if (lowerCached === lowerAC || lowerCached === lowerNormalized) {
                    console.log('📦 Found cached polling groups with case-insensitive match:', key);
                    cachedData = value as any;
                    break;
                  }
                }
              }
            }
          }
        } catch (cacheError) {
          console.error('❌ Cache read error:', cacheError);
          // Continue to try online fetch or return error
        }
      }
      
      if (cachedData) {
        return { success: true, data: cachedData };
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached polling groups found for:', state, acIdentifier, '(normalized:', normalizedAC, ')');
        // Try one more time with all cached groups to see what's available
        if (cacheForRead) {
          try {
            const allGroups = await cacheForRead.getAllPollingGroups();
            const availableACs = Object.keys(allGroups)
              .filter(key => key.startsWith(`${state}::`))
              .map(key => key.replace(`${state}::`, ''));
            if (availableACs.length > 0) {
              console.log('📋 Available cached ACs for', state, ':', availableACs.join(', '));
            }
          } catch (e) {
            // Ignore
          }
        }
        return {
          success: false,
          message: 'No internet connection and no cached data available',
        };
      }

      // Fetch from API using normalized AC name
      const headers = await this.getHeaders();
      let response;
      try {
        const url = `${this.baseURL}/api/polling-stations/groups/${encodeURIComponent(state)}/${encodeURIComponent(normalizedAC)}`;
        response = await axios.get(url, { headers });
      } catch (firstError: any) {
        // If normalized name fails, try original name as fallback
        if (normalizedAC !== acIdentifier && firstError.response?.status === 404) {
          console.log(`⚠️ Normalized AC "${normalizedAC}" not found, trying original "${acIdentifier}"`);
          const url = `${this.baseURL}/api/polling-stations/groups/${encodeURIComponent(state)}/${encodeURIComponent(acIdentifier)}`;
          response = await axios.get(url, { headers });
        } else {
          throw firstError;
        }
      }
      
      // Cache the data using normalized name
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.success && response.data.data) {
        try {
          await cacheForSave.savePollingGroups(state, normalizedAC, response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue
        }
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Get groups by AC error:', error);
      console.error('Error response:', error.response?.data);
      console.error('AC Identifier used:', acIdentifier);
      
      // Try cache as fallback - more aggressive search
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const normalizedAC = this.normalizeACName(acIdentifier);
          let cachedData = await cacheForFallback.getPollingGroups(state, normalizedAC);
          if (!cachedData) {
            cachedData = await cacheForFallback.getPollingGroups(state, acIdentifier);
          }
          if (!cachedData) {
            // Try case-insensitive search in all cached groups
            const allGroups = await cacheForFallback.getAllPollingGroups();
            const searchKey = `${state}::`;
            const lowerAC = acIdentifier.toLowerCase();
            const lowerNormalized = normalizedAC.toLowerCase();
            
            for (const [key, value] of Object.entries(allGroups)) {
              if (key.startsWith(searchKey)) {
                const cachedAC = key.replace(searchKey, '');
                const lowerCached = cachedAC.toLowerCase();
                // Check if AC matches (case-insensitive)
                if (lowerCached === lowerAC || lowerCached === lowerNormalized) {
                  console.log('📦 Found cached polling groups as fallback with case-insensitive match:', key);
                  cachedData = value as any;
                  break;
                }
              }
            }
          }
          if (cachedData) {
            console.log('📦 Using cached polling groups as fallback for:', state, normalizedAC);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          console.error('❌ Cache fallback error:', cacheError);
        }
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to fetch groups',
      };
    }
  }

  async getPollingStationsByGroup(state: string, acIdentifier: string, groupName: string) {
    try {
      // Normalize AC name to match master data spelling
      const normalizedAC = this.normalizeACName(acIdentifier);
      
      // Check offline cache first (lazy import) - try multiple variations
      const cacheForRead = await this.getOfflineCache();
      let cachedData = null;
      if (cacheForRead) {
        try {
          // Try normalized name first
          cachedData = await cacheForRead.getPollingStations(state, normalizedAC, groupName);
          if (cachedData) {
            console.log('📦 Using cached polling stations for:', state, normalizedAC, groupName, '(normalized)');
          } else {
            // If not found, try original name
            cachedData = await cacheForRead.getPollingStations(state, acIdentifier, groupName);
            if (cachedData) {
              console.log('📦 Using cached polling stations for:', state, acIdentifier, groupName, '(original)');
            } else {
              // Try case-insensitive search in all cached stations
              console.log('🔍 Cache miss for exact match, trying case-insensitive search...');
              const allStations = await cacheForRead.getAllPollingStations();
              const searchKey = `${state}::`;
              const lowerAC = acIdentifier.toLowerCase();
              const lowerNormalized = normalizedAC.toLowerCase();
              const lowerGroup = groupName.toLowerCase();
              
              for (const [key, value] of Object.entries(allStations)) {
                if (key.startsWith(searchKey)) {
                  const parts = key.replace(searchKey, '').split('::');
                  if (parts.length >= 2) {
                    const cachedAC = parts[0];
                    const cachedGroup = parts[1];
                    const lowerCachedAC = cachedAC.toLowerCase();
                    const lowerCachedGroup = cachedGroup.toLowerCase();
                    // Check if AC and group match (case-insensitive)
                    if ((lowerCachedAC === lowerAC || lowerCachedAC === lowerNormalized) && 
                        lowerCachedGroup === lowerGroup) {
                      console.log('📦 Found cached polling stations with case-insensitive match:', key);
                      cachedData = value as any;
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (cacheError) {
          console.error('❌ Cache read error:', cacheError);
          // Continue to try online fetch or return error
        }
      }
      
      if (cachedData) {
        return { success: true, data: cachedData };
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached polling stations found for:', state, acIdentifier, groupName, '(normalized:', normalizedAC, ')');
        return {
          success: false,
          message: 'No internet connection and no cached data available',
        };
      }

      // Fetch from API using normalized AC name
      const headers = await this.getHeaders();
      let response;
      try {
        const url = `${this.baseURL}/api/polling-stations/stations/${encodeURIComponent(state)}/${encodeURIComponent(normalizedAC)}/${encodeURIComponent(groupName)}`;
        response = await axios.get(url, { headers });
      } catch (firstError: any) {
        // If normalized name fails, try original name as fallback
        if (normalizedAC !== acIdentifier && firstError.response?.status === 404) {
          console.log(`⚠️ Normalized AC "${normalizedAC}" not found, trying original "${acIdentifier}"`);
          const url = `${this.baseURL}/api/polling-stations/stations/${encodeURIComponent(state)}/${encodeURIComponent(acIdentifier)}/${encodeURIComponent(groupName)}`;
          response = await axios.get(url, { headers });
        } else {
          throw firstError;
        }
      }
      
      // Cache the data using normalized name
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.success && response.data.data) {
        try {
          await cacheForSave.savePollingStations(state, normalizedAC, groupName, response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue
        }
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Get polling stations by group error:', error);
      console.error('Error response:', error.response?.data);
      console.error('AC Identifier used:', acIdentifier);
      
      // Try cache as fallback - more aggressive search
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const normalizedAC = this.normalizeACName(acIdentifier);
          let cachedData = await cacheForFallback.getPollingStations(state, normalizedAC, groupName);
          if (!cachedData) {
            cachedData = await cacheForFallback.getPollingStations(state, acIdentifier, groupName);
          }
          if (!cachedData) {
            // Try case-insensitive search in all cached stations
            const allStations = await cacheForFallback.getAllPollingStations();
            const searchKey = `${state}::`;
            const lowerAC = acIdentifier.toLowerCase();
            const lowerNormalized = normalizedAC.toLowerCase();
            const lowerGroup = groupName.toLowerCase();
            
            for (const [key, value] of Object.entries(allStations)) {
              if (key.startsWith(searchKey)) {
                const parts = key.replace(searchKey, '').split('::');
                if (parts.length >= 2) {
                  const cachedAC = parts[0];
                  const cachedGroup = parts[1];
                  const lowerCachedAC = cachedAC.toLowerCase();
                  const lowerCachedGroup = cachedGroup.toLowerCase();
                  // Check if AC and group match (case-insensitive)
                  if ((lowerCachedAC === lowerAC || lowerCachedAC === lowerNormalized) && 
                      lowerCachedGroup === lowerGroup) {
                    console.log('📦 Found cached polling stations as fallback with case-insensitive match:', key);
                    cachedData = value as any;
                    break;
                  }
                }
              }
            }
          }
          if (cachedData) {
            console.log('📦 Using cached polling stations as fallback for:', state, normalizedAC, groupName);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          console.error('❌ Cache fallback error:', cacheError);
        }
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to fetch polling stations',
      };
    }
  }

  // CATI Interview API methods
  async startCatiInterview(surveyId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/cati-interview/start/${surveyId}`,
        {},
        { headers }
      );
      
      // Check the backend's success field, not just HTTP status
      if (response.data.success === false) {
        return {
          success: false,
          message: response.data.message || 'Failed to start CATI interview',
          data: response.data.data || null
        };
      }
      
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('❌ Start CATI interview error:', error);
      console.error('❌ Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to start CATI interview',
        error: error.response?.data,
        data: error.response?.data?.data || null
      };
    }
  }

  async makeCallToRespondent(queueId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/cati-interview/make-call/${queueId}`,
        {},
        { headers }
      );
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Make call error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to make call',
        error: error.response?.data
      };
    }
  }

  async abandonCatiInterview(queueId: string, reason?: string, notes?: string, callLaterDate?: string, callStatus?: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/cati-interview/abandon/${queueId}`,
        {
          reason,
          notes,
          callLaterDate,
          callStatus // Pass call status for stats tracking
        },
        { headers }
      );
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Abandon CATI interview error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to abandon interview',
        error: error.response?.data
      };
    }
  }

  async completeCatiInterview(queueId: string, interviewData: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/cati-interview/complete/${queueId}`,
        interviewData,
        { headers }
      );
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('❌ Complete CATI interview error:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      console.error('❌ Error URL:', `${this.baseURL}/api/cati-interview/complete/${queueId}`);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to complete interview',
        error: error.response?.data
      };
    }
  }

  async getPollingStationGPS(state: string, acIdentifier: string, groupName: string, stationName: string) {
    try {
      // Normalize AC name to match master data spelling
      const normalizedAC = this.normalizeACName(acIdentifier);
      
      // Check offline cache first (lazy import) - try normalized name first
      const cacheForRead = await this.getOfflineCache();
      let cachedData = null;
      if (cacheForRead) {
        try {
          cachedData = await cacheForRead.getPollingGPS(state, normalizedAC, groupName, stationName);
          // If not found, try original name
          if (!cachedData) {
            cachedData = await cacheForRead.getPollingGPS(state, acIdentifier, groupName, stationName);
          }
        } catch (cacheError) {
          // Cache read failed, continue
        }
      }
      if (cachedData) {
        console.log('📦 Using cached GPS for:', state, normalizedAC, groupName, stationName);
        return { success: true, data: cachedData };
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached GPS for:', state, normalizedAC, groupName, stationName);
        return {
          success: false,
          message: 'No internet connection and no cached data available',
        };
      }

      // Fetch from API using normalized AC name
      const headers = await this.getHeaders();
      let response;
      try {
        response = await axios.get(
          `${this.baseURL}/api/polling-stations/gps/${encodeURIComponent(state)}/${encodeURIComponent(normalizedAC)}/${encodeURIComponent(groupName)}/${encodeURIComponent(stationName)}`,
          { headers }
        );
      } catch (firstError: any) {
        // If normalized name fails, try original name as fallback
        if (normalizedAC !== acIdentifier && firstError.response?.status === 404) {
          console.log(`⚠️ Normalized AC "${normalizedAC}" not found, trying original "${acIdentifier}"`);
          response = await axios.get(
            `${this.baseURL}/api/polling-stations/gps/${encodeURIComponent(state)}/${encodeURIComponent(acIdentifier)}/${encodeURIComponent(groupName)}/${encodeURIComponent(stationName)}`,
            { headers }
          );
        } else {
          throw firstError;
        }
      }
      
      // Cache the data using normalized name
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.success && response.data.data) {
        try {
          await cacheForSave.savePollingGPS(state, normalizedAC, groupName, stationName, response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue
        }
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Get polling station GPS error:', error);
      console.error('AC Identifier used:', acIdentifier);
      
      // Try cache as fallback
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const normalizedAC = this.normalizeACName(acIdentifier);
          let cachedData = await cacheForFallback.getPollingGPS(state, normalizedAC, groupName, stationName);
          if (!cachedData) {
            cachedData = await cacheForFallback.getPollingGPS(state, acIdentifier, groupName, stationName);
          }
          if (cachedData) {
            console.log('📦 Using cached GPS as fallback for:', state, normalizedAC, groupName, stationName);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          // Cache not available
        }
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to fetch polling station GPS',
      };
    }
  }

  // Get current user profile (to check locationControlBooster)
  async getCurrentUser() {
    try {
      // Check offline cache first (lazy import)
      const cacheForRead = await this.getOfflineCache();
      let cachedData = null;
      if (cacheForRead) {
        try {
          cachedData = await cacheForRead.getUserData();
        } catch (cacheError) {
          // Cache read failed, continue
        }
      }
      if (cachedData) {
        console.log('📦 Using cached user data');
        return { success: true, user: cachedData };
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached user data');
        return {
          success: false,
          message: 'No internet connection and no cached data available',
        };
      }

      // Fetch from API
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/auth/me`, { headers });
      
      // Cache the data
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && (response.data.data || response.data.user)) {
        try {
          await cacheForSave.saveUserData(response.data.data || response.data.user);
        } catch (cacheError) {
          // Cache save failed, continue
        }
      }
      
      return { success: true, user: response.data.data || response.data.user };
    } catch (error: any) {
      console.error('Get current user error:', error);
      
      // Try cache as fallback
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const cachedData = await cacheForFallback.getUserData();
          if (cachedData) {
            console.log('📦 Using cached user data as fallback');
            return { success: true, user: cachedData };
          }
        } catch (cacheError) {
          // Cache not available
        }
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get user profile',
      };
    }
  }

  // Quality Agent API methods
  async getNextReviewAssignment(params?: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/survey-responses/next-review`, {
        params,
        headers
      });
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Get next review assignment error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get next assignment',
        error: error.response?.data
      };
    }
  }

  async releaseReviewAssignment(responseId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/release-review/${responseId}`,
        {},
        { headers }
      );
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Release review assignment error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to release assignment',
        error: error.response?.data
      };
    }
  }

  async submitVerification(verificationData: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.post(
        `${this.baseURL}/api/survey-responses/verify`,
        verificationData,
        { headers }
      );
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Submit verification error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to submit verification',
        error: error.response?.data
      };
    }
  }

  async getQualityAgentAnalytics(params?: any) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/performance/quality-agent/analytics`, {
        params,
        headers
      });
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Get quality agent analytics error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get analytics',
        error: error.response?.data
      };
    }
  }

  // Get CATI call details
  async getCatiCallById(callId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(`${this.baseURL}/api/cati/calls/${callId}`, { headers });
      return {
        success: true,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('Get CATI call error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get call details',
        error: error.response?.data
      };
    }
  }

  // Get CATI call recording
  async getCatiRecording(callId: string) {
    try {
      const headers = await this.getHeaders();
      const response = await axios.get(
        `${this.baseURL}/api/cati/recording/${callId}`,
        {
          headers,
          responseType: 'blob'
        }
      );
      return {
        success: true,
        blob: response.data
      };
    } catch (error: any) {
      // Silently handle 404 errors (recording not available) - this is expected
      if (error.response?.status === 404 || error.status === 404) {
        return {
          success: false,
          message: 'Recording not available',
          error: null
        };
      }
      // Only log unexpected errors
      console.error('Get CATI recording error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get recording',
        error: error.response?.data
      };
    }
  }

  // Get MP and MLA names for an AC
  async getACData(acName: string) {
    try {
      // Normalize AC name to match master data spelling
      const normalizedAC = this.normalizeACName(acName);
      
      // Check offline cache first (lazy import) - try normalized name first
      const cacheForRead = await this.getOfflineCache();
      let cachedData = null;
      if (cacheForRead) {
        try {
          cachedData = await cacheForRead.getACData(normalizedAC);
          // If not found, try original name
          if (!cachedData) {
            cachedData = await cacheForRead.getACData(acName);
          }
        } catch (cacheError) {
          // Cache read failed, continue
        }
      }
      if (cachedData) {
        console.log('📦 Using cached AC data for:', normalizedAC);
        return { success: true, data: cachedData };
      }

      // Check if online
      const isOnline = await this.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - no cached AC data for:', normalizedAC);
        return {
          success: false,
          message: 'No internet connection and no cached data available',
          error: 'OFFLINE_NO_CACHE'
        };
      }

      // Fetch from API using normalized AC name
      const headers = await this.getHeaders();
      let response;
      try {
        response = await axios.get(
          `${this.baseURL}/api/master-data/ac/${encodeURIComponent(normalizedAC)}`,
          { headers }
        );
      } catch (firstError: any) {
        // If normalized name fails, try original name as fallback
        if (normalizedAC !== acName && firstError.response?.status === 404) {
          console.log(`⚠️ Normalized AC "${normalizedAC}" not found, trying original "${acName}"`);
          response = await axios.get(
            `${this.baseURL}/api/master-data/ac/${encodeURIComponent(acName)}`,
            { headers }
          );
        } else {
          throw firstError;
        }
      }
      
      // Cache the data using normalized name
      const cacheForSave = await this.getOfflineCache();
      if (cacheForSave && response.data.data) {
        try {
          await cacheForSave.saveACData(normalizedAC, response.data.data);
        } catch (cacheError) {
          // Cache save failed, continue
        }
      }
      
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Get AC data error:', error);
      console.error('AC Name used:', acName);
      
      // Try cache as fallback
      const cacheForFallback = await this.getOfflineCache();
      if (cacheForFallback) {
        try {
          const normalizedAC = this.normalizeACName(acName);
          let cachedData = await cacheForFallback.getACData(normalizedAC);
          if (!cachedData) {
            cachedData = await cacheForFallback.getACData(acName);
          }
          if (cachedData) {
            console.log('📦 Using cached AC data as fallback for:', normalizedAC);
            return { success: true, data: cachedData };
          }
        } catch (cacheError) {
          // Cache not available
        }
      }
      
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to get AC data',
        error: error.response?.data
      };
    }
  }
}

export const apiService = new ApiService();
