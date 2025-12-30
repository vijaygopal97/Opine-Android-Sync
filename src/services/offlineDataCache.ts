import AsyncStorage from '@react-native-async-storage/async-storage';
// Note: apiService is imported dynamically to avoid circular dependency

// Storage keys
const STORAGE_KEYS = {
  AC_DATA: 'offline_ac_data',
  ALL_ACS_FOR_STATE: 'offline_all_acs_for_state', // Cache for all ACs by state
  POLLING_GROUPS: 'offline_polling_groups',
  POLLING_STATIONS: 'offline_polling_stations',
  POLLING_GPS: 'offline_polling_gps',
  GENDER_QUOTAS: 'offline_gender_quotas',
  CATI_SET_NUMBERS: 'offline_cati_set_numbers',
  USER_DATA: 'offline_user_data',
};

interface ACData {
  acName: string;
  mpName?: string;
  mlaName?: string;
  hasByeElection?: boolean;
  [key: string]: any;
}

interface PollingGroup {
  state: string;
  acIdentifier: string;
  groups: string[];
  ac_name?: string;
  [key: string]: any;
}

interface PollingStation {
  state: string;
  acIdentifier: string;
  groupName: string;
  stations: any[];
  [key: string]: any;
}

interface PollingGPS {
  state: string;
  acIdentifier: string;
  groupName: string;
  stationName: string;
  gps_location?: string;
  latitude?: number;
  longitude?: number;
  [key: string]: any;
}

class OfflineDataCacheService {
  private isDownloading = false;
  
  // ========== AC Name Normalization ==========
  
  /**
   * Normalize AC name to match master data spelling
   * This handles common spelling mismatches between survey data and polling station master data
   */
  private normalizeACName(acName: string): string {
    if (!acName || typeof acName !== 'string') return acName;
    
    // Common AC name mappings based on master data spelling
    const acNameMappings: Record<string, string> = {
      // Cooch Behar variations
      'Cooch Behar Uttar': 'COOCHBEHAR UTTAR (SC)',
      'Cooch Behar Dakshin': 'COOCHBEHAR DAKSHIN',
      'Coochbehar Uttar': 'COOCHBEHAR UTTAR (SC)',
      'Coochbehar Dakshin': 'COOCHBEHAR DAKSHIN',
      'COOCH BEHAR UTTAR': 'COOCHBEHAR UTTAR (SC)',
      'COOCH BEHAR DAKSHIN': 'COOCHBEHAR DAKSHIN',
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
    
    // If no mapping found, return original (will be handled by API normalization)
    return acName;
  }
  
  // ========== AC Data Management ==========
  
  async saveACData(acName: string, data: ACData): Promise<void> {
    try {
      const allACData = await this.getAllACData();
      allACData[acName] = {
        ...data,
        acName,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.AC_DATA, JSON.stringify(allACData));
    } catch (error) {
      console.error('Error saving AC data:', error);
      throw error;
    }
  }

  async getACData(acName: string): Promise<ACData | null> {
    try {
      const allACData = await this.getAllACData();
      return allACData[acName] || null;
    } catch (error) {
      console.error('Error getting AC data:', error);
      return null;
    }
  }

  async getAllACData(): Promise<Record<string, ACData>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.AC_DATA);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all AC data:', error);
      return {};
    }
  }

  // ========== Polling Groups Management ==========
  
  async savePollingGroups(state: string, acIdentifier: string, data: PollingGroup): Promise<void> {
    try {
      const allGroups = await this.getAllPollingGroups();
      const key = `${state}::${acIdentifier}`;
      allGroups[key] = {
        ...data,
        state,
        acIdentifier,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_GROUPS, JSON.stringify(allGroups));
    } catch (error) {
      console.error('Error saving polling groups:', error);
      throw error;
    }
  }

  async getPollingGroups(state: string, acIdentifier: string): Promise<PollingGroup | null> {
    try {
      const allGroups = await this.getAllPollingGroups();
      
      // Try exact match first
      let key = `${state}::${acIdentifier}`;
      let result = allGroups[key];
      if (result) {
        return result;
      }
      
      // If not found, try to find by AC code if acIdentifier is an AC name
      // The cache might be stored with AC code as key, but we're searching by name
      // Check if any cached entry has matching ac_name
      const normalizedSearchName = acIdentifier.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ');
      
      for (const [cachedKey, cachedData] of Object.entries(allGroups)) {
        if (cachedKey.startsWith(`${state}::`)) {
          const cachedACIdentifier = cachedKey.replace(`${state}::`, '');
          const cachedACName = (cachedData as any).ac_name;
          
          // Normalize cached AC name for comparison
          const normalizedCachedName = cachedACName 
            ? cachedACName.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ')
            : '';
          
          // CRITICAL FIX: Prioritize exact matches to prevent substring conflicts (e.g., "Kashipur" vs "Kashipur-Belgachhia")
          // Check exact match first
          if (cachedACName && normalizedCachedName === normalizedSearchName) {
            console.log(`📦 Found cached groups by exact AC name match: "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
            return cachedData as PollingGroup;
          }
          
          // Try exact match after removing parentheses
          const cachedWithoutParens = normalizedCachedName.replace(/\s*\([^)]*\)\s*/g, '').trim();
          const searchWithoutParens = normalizedSearchName.replace(/\s*\([^)]*\)\s*/g, '').trim();
          if (cachedACName && cachedWithoutParens === searchWithoutParens && cachedWithoutParens !== '') {
            console.log(`📦 Found cached groups by exact AC name match (no parens): "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
            return cachedData as PollingGroup;
          }
          
          // Partial match - ONLY if search term is longer or similar length (prevents conflicts)
          // This prevents "Kashipur" from matching "Kashipur-Belgachhia"
          if (cachedACName) {
            const lengthDiff = Math.abs(cachedWithoutParens.length - searchWithoutParens.length);
            if (searchWithoutParens.length >= cachedWithoutParens.length && 
                cachedWithoutParens.includes(searchWithoutParens) && 
                lengthDiff <= 3) {
              console.log(`📦 Found cached groups by partial AC name match: "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
              return cachedData as PollingGroup;
            }
          }
          
          // Also check if cached key is AC code and we can match by name (exact match only)
          if (/^\d+$/.test(cachedACIdentifier) && cachedACName) {
            if (normalizedCachedName === normalizedSearchName || cachedWithoutParens === searchWithoutParens) {
              console.log(`📦 Found cached groups by AC code match: "${acIdentifier}" -> code "${cachedACIdentifier}" (name: "${cachedACName}")`);
              return cachedData as PollingGroup;
            }
          }
          
          // Also try matching the cache key itself (exact match only)
          const normalizedCachedKey = cachedACIdentifier.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ');
          if (normalizedCachedKey === normalizedSearchName || normalizedCachedKey === searchWithoutParens) {
            console.log(`📦 Found cached groups by cache key match: "${acIdentifier}" -> "${cachedACIdentifier}" (key: ${cachedKey})`);
            return cachedData as PollingGroup;
          }
        }
      }
      
      // Log what we searched for and what's available for debugging
      console.log(`🔍 Cache search failed for "${acIdentifier}" in state "${state}"`);
      const availableKeys = Object.keys(allGroups)
        .filter(key => key.startsWith(`${state}::`))
        .map(key => {
          const acId = key.replace(`${state}::`, '');
          const data = allGroups[key] as any;
          return `${acId} (ac_name: ${data?.ac_name || 'N/A'})`;
        });
      if (availableKeys.length > 0) {
        console.log(`📋 Available cached ACs: ${availableKeys.slice(0, 10).join(', ')}${availableKeys.length > 10 ? '...' : ''}`);
      } else {
        console.log(`📋 No cached ACs found for state "${state}"`);
      }
      
      return null;
    } catch (error) {
      console.error('Error getting polling groups:', error);
      return null;
    }
  }

  async getAllPollingGroups(): Promise<Record<string, PollingGroup>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.POLLING_GROUPS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all polling groups:', error);
      return {};
    }
  }

  /**
   * Get all polling groups for a state (for debugging and fallback searches)
   */
  async getAllPollingGroupsForState(state: string): Promise<PollingGroup[]> {
    try {
      const allGroups = await this.getAllPollingGroups();
      const stateKey = `${state}::`;
      return Object.entries(allGroups)
        .filter(([key]) => key.startsWith(stateKey))
        .map(([_, value]) => value);
    } catch (error) {
      console.error('Error getting polling groups for state:', error);
      return [];
    }
  }

  // ========== Polling Stations Management ==========
  
  async savePollingStations(
    state: string,
    acIdentifier: string,
    groupName: string,
    data: PollingStation
  ): Promise<void> {
    try {
      const allStations = await this.getAllPollingStations();
      const key = `${state}::${acIdentifier}::${groupName}`;
      allStations[key] = {
        ...data,
        state,
        acIdentifier,
        groupName,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_STATIONS, JSON.stringify(allStations));
    } catch (error) {
      console.error('Error saving polling stations:', error);
      throw error;
    }
  }

  async getPollingStations(
    state: string,
    acIdentifier: string,
    groupName: string
  ): Promise<PollingStation | null> {
    try {
      const allStations = await this.getAllPollingStations();
      
      // Try exact match first
      let key = `${state}::${acIdentifier}::${groupName}`;
      let result = allStations[key];
      if (result) {
        return result;
      }
      
      // If not found, try to find by AC code if acIdentifier is an AC name
      // Check if any cached entry has matching ac_name
      const normalizedSearchName = acIdentifier.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ');
      
      for (const [cachedKey, cachedData] of Object.entries(allStations)) {
        if (cachedKey.startsWith(`${state}::`) && cachedKey.endsWith(`::${groupName}`)) {
          const parts = cachedKey.replace(`${state}::`, '').replace(`::${groupName}`, '');
          const cachedACIdentifier = parts;
          const cachedACName = (cachedData as any).ac_name;
          
          // Normalize cached AC name for comparison
          const normalizedCachedName = cachedACName 
            ? cachedACName.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ')
            : '';
          
          // CRITICAL FIX: Prioritize exact matches to prevent substring conflicts (e.g., "Kashipur" vs "Kashipur-Belgachhia")
          // Check exact match first
          if (cachedACName && normalizedCachedName === normalizedSearchName) {
            console.log(`📦 Found cached stations by exact AC name match: "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
            return cachedData as PollingStation;
          }
          
          // Try exact match after removing parentheses
          const cachedWithoutParens = normalizedCachedName.replace(/\s*\([^)]*\)\s*/g, '').trim();
          const searchWithoutParens = normalizedSearchName.replace(/\s*\([^)]*\)\s*/g, '').trim();
          if (cachedACName && cachedWithoutParens === searchWithoutParens && cachedWithoutParens !== '') {
            console.log(`📦 Found cached stations by exact AC name match (no parens): "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
            return cachedData as PollingStation;
          }
          
          // Partial match - ONLY if search term is longer or similar length (prevents conflicts)
          // This prevents "Kashipur" from matching "Kashipur-Belgachhia"
          if (cachedACName) {
            const lengthDiff = Math.abs(cachedWithoutParens.length - searchWithoutParens.length);
            if (searchWithoutParens.length >= cachedWithoutParens.length && 
                cachedWithoutParens.includes(searchWithoutParens) && 
                lengthDiff <= 3) {
              console.log(`📦 Found cached stations by partial AC name match: "${acIdentifier}" -> "${cachedACName}" (key: ${cachedKey})`);
              return cachedData as PollingStation;
            }
          }
          
          // Also check if cached key is AC code and we can match by name (exact match only)
          if (/^\d+$/.test(cachedACIdentifier) && cachedACName) {
            if (normalizedCachedName === normalizedSearchName || cachedWithoutParens === searchWithoutParens) {
              console.log(`📦 Found cached stations by AC code match: "${acIdentifier}" -> code "${cachedACIdentifier}" (name: "${cachedACName}")`);
              return cachedData as PollingStation;
            }
          }
          
          // Also try matching the cache key itself (exact match only)
          const normalizedCachedKey = cachedACIdentifier.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim().replace(/\s+/g, ' ');
          if (normalizedCachedKey === normalizedSearchName || normalizedCachedKey === searchWithoutParens) {
            console.log(`📦 Found cached stations by cache key match: "${acIdentifier}" -> "${cachedACIdentifier}" (key: ${cachedKey})`);
            return cachedData as PollingStation;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting polling stations:', error);
      return null;
    }
  }

  async getAllPollingStations(): Promise<Record<string, PollingStation>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.POLLING_STATIONS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all polling stations:', error);
      return {};
    }
  }

  /**
   * Get all polling stations for a state and AC (for debugging and fallback searches)
   */
  async getAllPollingStationsForAC(state: string, acIdentifier: string): Promise<PollingStation[]> {
    try {
      const allStations = await this.getAllPollingStations();
      const searchKey = `${state}::${acIdentifier}::`;
      return Object.entries(allStations)
        .filter(([key]) => key.startsWith(searchKey))
        .map(([_, value]) => value);
    } catch (error) {
      console.error('Error getting polling stations for AC:', error);
      return [];
    }
  }

  // ========== All ACs for State Management ==========
  
  /**
   * Save all ACs for a state
   */
  async saveAllACsForState(state: string, acs: any[]): Promise<void> {
    try {
      console.log(`💾 Saving ${acs.length} ACs for state: ${state}`);
      console.log(`💾 Sample ACs being saved:`, acs.slice(0, 5).map((ac: any) => ac.acName || ac));
      
      const allACsData = await this.getAllACsForAllStates();
      allACsData[state] = {
        acs: acs,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.ALL_ACS_FOR_STATE, JSON.stringify(allACsData));
      
      // Verify it was saved correctly
      const verifyData = await this.getAllACsForAllStates();
      const verifyStateData = verifyData[state];
      if (verifyStateData && verifyStateData.acs) {
        console.log(`✅ Verified saved ${verifyStateData.acs.length} ACs for state: ${state}`);
        if (verifyStateData.acs.length !== acs.length) {
          console.error(`❌ AC count mismatch: saved ${acs.length}, but read back ${verifyStateData.acs.length}`);
        }
      } else {
        console.error(`❌ Failed to verify saved ACs for state: ${state}`);
      }
    } catch (error) {
      console.error('Error saving all ACs for state:', error);
      throw error;
    }
  }

  /**
   * Get all ACs for a state
   * Validates cache completeness before returning
   */
  async getAllACsForState(state: string): Promise<any[]> {
    try {
      const allACsData = await this.getAllACsForAllStates();
      const stateData = allACsData[state];
      if (stateData && stateData.acs) {
        const cachedACs = stateData.acs;
        const acCount = cachedACs.length;
        
        // CRITICAL: Validate cache completeness
        // West Bengal should have ~294 ACs, reject if suspiciously few
        const minExpectedACs = state === 'West Bengal' ? 200 : 50;
        
        if (acCount >= minExpectedACs) {
          console.log('📦 Found cached ACs for state:', state, acCount, 'ACs (validated complete)');
          return cachedACs;
        } else {
          // Cache is incomplete/contaminated - clear it
          console.warn(`⚠️ Cached ACs for state ${state} has only ${acCount} ACs (expected at least ${minExpectedACs})`);
          console.warn('⚠️ This cache appears incomplete/contaminated - clearing it');
          await this.clearACsForState(state);
          return [];
        }
      }
      return [];
    } catch (error) {
      console.error('Error getting all ACs for state:', error);
      return [];
    }
  }

  /**
   * Get all ACs data for all states
   * Made public so InterviewInterface can access it directly for fallback
   */
  async getAllACsForAllStates(): Promise<Record<string, { acs: any[], cachedAt: string }>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.ALL_ACS_FOR_STATE);
      const parsed = data ? JSON.parse(data) : {};
      console.log('📦 getAllACsForAllStates - states in cache:', Object.keys(parsed));
      return parsed;
    } catch (error) {
      console.error('Error getting all ACs for all states:', error);
      return {};
    }
  }

  /**
   * Clear all ACs cache for a specific state
   * This ensures old/contaminated cache doesn't interfere with new data
   */
  async clearACsForState(state: string): Promise<void> {
    try {
      console.log(`🧹 Clearing AC cache for state: ${state}`);
      const allACsData = await this.getAllACsForAllStates();
      const beforeCount = allACsData[state]?.acs?.length || 0;
      console.log(`🧹 Before clear: ${beforeCount} ACs for state: ${state}`);
      
      delete allACsData[state];
      await AsyncStorage.setItem(STORAGE_KEYS.ALL_ACS_FOR_STATE, JSON.stringify(allACsData));
      
      // Verify it was cleared
      const verifyData = await this.getAllACsForAllStates();
      const afterCount = verifyData[state]?.acs?.length || 0;
      if (afterCount === 0) {
        console.log(`✅ Verified cleared AC cache for state: ${state} (was ${beforeCount} ACs)`);
      } else {
        console.error(`❌ Failed to clear AC cache: still has ${afterCount} ACs after clear`);
      }
    } catch (error) {
      console.error('Error clearing AC cache for state:', error);
      throw error;
    }
  }

  // ========== Polling GPS Management ==========
  
  async savePollingGPS(
    state: string,
    acIdentifier: string,
    groupName: string,
    stationName: string,
    data: PollingGPS
  ): Promise<void> {
    try {
      const allGPS = await this.getAllPollingGPS();
      const key = `${state}::${acIdentifier}::${groupName}::${stationName}`;
      allGPS[key] = {
        ...data,
        state,
        acIdentifier,
        groupName,
        stationName,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_GPS, JSON.stringify(allGPS));
    } catch (error) {
      console.error('Error saving polling GPS:', error);
      throw error;
    }
  }

  async getPollingGPS(
    state: string,
    acIdentifier: string,
    groupName: string,
    stationName: string
  ): Promise<PollingGPS | null> {
    try {
      const allGPS = await this.getAllPollingGPS();
      const key = `${state}::${acIdentifier}::${groupName}::${stationName}`;
      return allGPS[key] || null;
    } catch (error) {
      console.error('Error getting polling GPS:', error);
      return null;
    }
  }

  async getAllPollingGPS(): Promise<Record<string, PollingGPS>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.POLLING_GPS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all polling GPS:', error);
      return {};
    }
  }

  // ========== Gender Quotas Management ==========
  
  async saveGenderQuotas(surveyId: string, data: any): Promise<void> {
    try {
      const allQuotas = await this.getAllGenderQuotas();
      allQuotas[surveyId] = {
        ...data,
        surveyId,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.GENDER_QUOTAS, JSON.stringify(allQuotas));
    } catch (error) {
      console.error('Error saving gender quotas:', error);
      throw error;
    }
  }

  async getGenderQuotas(surveyId: string): Promise<any | null> {
    try {
      const allQuotas = await this.getAllGenderQuotas();
      return allQuotas[surveyId] || null;
    } catch (error) {
      console.error('Error getting gender quotas:', error);
      return null;
    }
  }

  async getAllGenderQuotas(): Promise<Record<string, any>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.GENDER_QUOTAS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all gender quotas:', error);
      return {};
    }
  }

  // ========== CATI Set Numbers Management ==========
  
  async saveCatiSetNumber(surveyId: string, data: any): Promise<void> {
    try {
      const allSetNumbers = await this.getAllCatiSetNumbers();
      allSetNumbers[surveyId] = {
        ...data,
        surveyId,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.CATI_SET_NUMBERS, JSON.stringify(allSetNumbers));
    } catch (error) {
      console.error('Error saving CATI set number:', error);
      throw error;
    }
  }

  async getCatiSetNumber(surveyId: string): Promise<any | null> {
    try {
      const allSetNumbers = await this.getAllCatiSetNumbers();
      return allSetNumbers[surveyId] || null;
    } catch (error) {
      console.error('Error getting CATI set number:', error);
      return null;
    }
  }

  async getAllCatiSetNumbers(): Promise<Record<string, any>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CATI_SET_NUMBERS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all CATI set numbers:', error);
      return {};
    }
  }

  // ========== User Data Management ==========
  
  async saveUserData(data: any): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify({
        ...data,
        cachedAt: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Error saving user data:', error);
      throw error;
    }
  }

  async getUserData(): Promise<any | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.USER_DATA);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }

  // ========== Bulk Download Functions ==========
  
  /**
   * Download all dependent data for assigned ACs in surveys
   * @param includeGPS - If true, also download GPS data (default: false, as it's slow and can be fetched on-demand)
   */
  async downloadDependentDataForSurveys(surveys: any[], includeGPS: boolean = false): Promise<void> {
    // Prevent multiple simultaneous downloads
    if (this.isDownloading) {
      console.log('⚠️ Download already in progress, skipping...');
      return;
    }
    
    this.isDownloading = true;
    console.log('📥 Starting download of dependent data for surveys...');
    console.log(`📥 Processing ${surveys.length} survey(s)...`);
    if (!includeGPS) {
      console.log('⏭️ GPS downloads skipped (will fetch on-demand during interview)');
    }
    
    try {
      // Dynamic import to avoid circular dependency
      const { apiService } = await import('./api');
    
    const assignedACs = new Set<string>();
    const states = new Set<string>();
    const surveyIds = new Set<string>();

    // Collect all assigned ACs and states from surveys
    surveys.forEach((survey) => {
      surveyIds.add(survey._id || survey.id);
      
      // Get assigned ACs from different assignment types
      const acs: string[] = [];
      
      // Single mode assignments
      if (survey.assignedInterviewers) {
        survey.assignedInterviewers.forEach((assignment: any) => {
          if (assignment.assignedACs && Array.isArray(assignment.assignedACs)) {
            acs.push(...assignment.assignedACs);
          }
        });
      }
      
      // CAPI assignments
      if (survey.capiInterviewers) {
        survey.capiInterviewers.forEach((assignment: any) => {
          if (assignment.assignedACs && Array.isArray(assignment.assignedACs)) {
            acs.push(...assignment.assignedACs);
          }
        });
      }
      
      // CATI assignments
      if (survey.catiInterviewers) {
        survey.catiInterviewers.forEach((assignment: any) => {
          if (assignment.assignedACs && Array.isArray(assignment.assignedACs)) {
            acs.push(...assignment.assignedACs);
          }
        });
      }
      
      // Also check assignedACs directly on survey
      if (survey.assignedACs && Array.isArray(survey.assignedACs)) {
        acs.push(...survey.assignedACs);
      }

      acs.forEach((ac) => {
        if (ac && typeof ac === 'string') {
          assignedACs.add(ac);
        }
      });

      // Get state
      if (survey.acAssignmentState) {
        states.add(survey.acAssignmentState);
      }
    });

    const state = states.size > 0 ? Array.from(states)[0] : 'West Bengal';
    const acsArray = Array.from(assignedACs);
    
    // SKIP: AC and polling station data is now bundled in the app
    // No need to download from server - it's always available from bundled JSON files
    console.log('📦 AC and polling station data is bundled in app - skipping server download');
    console.log('📦 Using bundled data from polling_stations.json and assemblyConstituencies.json');
    
    // Optionally cache ACs from bundled data for faster lookups (but not required)
    try {
      const { bundledDataService } = await import('./bundledDataService');
      const bundledACsResult = await bundledDataService.getAllACsForState(state);
      if (bundledACsResult.success && bundledACsResult.data) {
        // Cache bundled ACs for faster future lookups (optional optimization)
        await this.saveAllACsForState(state, bundledACsResult.data);
        console.log(`✅ Cached ${bundledACsResult.data.length} ACs from bundled data for state: ${state}`);
      }
    } catch (bundledError) {
      console.warn('⚠️ Could not cache bundled ACs (non-critical):', bundledError);
      // Continue - bundled data is still available even if cache fails
    }
    
    // SKIP: Polling groups and stations are now bundled in the app
    // No need to download from server - bundled data is always available
    console.log('📦 Polling groups and stations are bundled in app - skipping server download');
    console.log('📦 All ACs, groups, and polling stations available from bundled polling_stations.json');
    console.log('✅ Survey sync complete: Using bundled AC and polling station data (no server download needed)');
    
    // Download gender quotas for all surveys (still needed from server)
    for (const surveyId of surveyIds) {
      try {
        const result = await apiService.getGenderResponseCounts(surveyId);
        if (result.success && result.data) {
          await this.saveGenderQuotas(surveyId, result.data);
          console.log(`✅ Cached gender quotas for survey: ${surveyId}`);
        }
      } catch (error) {
        console.error(`❌ Error downloading gender quotas for ${surveyId}:`, error);
      }
    }

    // Download CATI set numbers for CATI surveys (still needed from server)
    for (const survey of surveys) {
      if (survey.mode === 'cati' || survey.assignedMode === 'cati') {
        try {
          const result = await apiService.getLastCatiSetNumber(survey._id || survey.id);
          if (result && result.success && result.data) {
            await this.saveCatiSetNumber(survey._id || survey.id, result.data);
            console.log(`✅ Cached CATI set number for survey: ${survey._id || survey.id}`);
          }
        } catch (error) {
          console.error(`❌ Error downloading CATI set number for ${survey._id}:`, error);
        }
      }
    }

    // Download user data - ALWAYS force refresh from server to get latest locationControlBooster
    try {
      const userResult = await apiService.getCurrentUser(true); // forceRefresh = true to get latest booster status
      if (userResult.success && userResult.user) {
        await this.saveUserData(userResult.user);
        console.log('✅ Cached fresh user data (locationControlBooster refreshed)');
      }
    } catch (error) {
      console.error('❌ Error downloading user data:', error);
    }

    console.log('✅ Finished downloading dependent data (AC and polling data skipped - using bundled files)');
    } catch (error) {
      console.error('❌ Error in downloadDependentDataForSurveys:', error);
      throw error;
    } finally {
      this.isDownloading = false;
    }
  }

  // ========== Clear Cache ==========
  
  async clearAllCache(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.AC_DATA,
        STORAGE_KEYS.ALL_ACS_FOR_STATE,
        STORAGE_KEYS.POLLING_GROUPS,
        STORAGE_KEYS.POLLING_STATIONS,
        STORAGE_KEYS.POLLING_GPS,
        STORAGE_KEYS.GENDER_QUOTAS,
        STORAGE_KEYS.CATI_SET_NUMBERS,
        STORAGE_KEYS.USER_DATA,
      ]);
      console.log('✅ Cleared all offline data cache');
    } catch (error) {
      console.error('❌ Error clearing cache:', error);
      throw error;
    }
  }
}

export const offlineDataCache = new OfflineDataCacheService();










