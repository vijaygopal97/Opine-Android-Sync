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
      const key = `${state}::${acIdentifier}`;
      return allGroups[key] || null;
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
      const key = `${state}::${acIdentifier}::${groupName}`;
      return allStations[key] || null;
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
      const allACsData = await this.getAllACsForAllStates();
      allACsData[state] = {
        acs: acs,
        cachedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.ALL_ACS_FOR_STATE, JSON.stringify(allACsData));
      console.log('✅ Cached', acs.length, 'ACs for state:', state);
    } catch (error) {
      console.error('Error saving all ACs for state:', error);
      throw error;
    }
  }

  /**
   * Get all ACs for a state
   */
  async getAllACsForState(state: string): Promise<any[]> {
    try {
      const allACsData = await this.getAllACsForAllStates();
      const stateData = allACsData[state];
      if (stateData && stateData.acs) {
        console.log('📦 Found cached ACs for state:', state, stateData.acs.length, 'ACs');
        return stateData.acs;
      }
      return [];
    } catch (error) {
      console.error('Error getting all ACs for state:', error);
      return [];
    }
  }

  /**
   * Get all ACs data for all states
   */
  private async getAllACsForAllStates(): Promise<Record<string, { acs: any[], cachedAt: string }>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.ALL_ACS_FOR_STATE);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting all ACs for all states:', error);
      return {};
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
    
    if (acsArray.length === 0) {
      console.log('⚠️ No assigned ACs found in surveys. Skipping dependent data download.');
      return;
    }
    
    console.log(`📥 Downloading data for ${acsArray.length} AC(s) in state: ${state}`);
    console.log(`📥 ACs: ${acsArray.join(', ')}`);

    // First, download AC data for all assigned ACs to get correct AC names
    // This helps normalize AC names to match master data spelling
    // The AC data API returns the correct AC name as used in polling station data
    const acNameMap = new Map<string, string>(); // Maps original AC name to normalized AC name
    console.log('📥 Downloading AC data to normalize AC names...');
    for (const ac of acsArray) {
      try {
        // Try to get AC data - this will return the correct spelling from master data
        // First normalize the AC name using our mapping
        let normalizedACName = this.normalizeACName(ac);
        
        try {
          const result = await apiService.getACData(normalizedACName);
          if (result.success && result.data) {
            // The AC data response contains the correct AC name as stored in master data
            // Use acName from response, or try ac_name, or fallback to normalized name
            const responseACName = result.data.acName || result.data.ac_name || result.data.name || normalizedACName;
            
            // Use the response AC name if different from our normalized name
            if (responseACName !== normalizedACName) {
              normalizedACName = responseACName;
            }
            
            // Save using the normalized name (master data spelling)
            await this.saveACData(normalizedACName, result.data);
            
            if (normalizedACName !== ac) {
              console.log(`✅ Cached AC data: "${ac}" -> "${normalizedACName}" (normalized)`);
            } else {
              console.log(`✅ Cached AC data for: ${ac}`);
            }
          } else {
            // If AC data fetch fails with normalized name, try original name
            if (normalizedACName !== ac) {
              console.log(`⚠️ Normalized name "${normalizedACName}" failed, trying original "${ac}"`);
              const fallbackResult = await apiService.getACData(ac);
              if (fallbackResult.success && fallbackResult.data) {
                normalizedACName = fallbackResult.data.acName || fallbackResult.data.ac_name || fallbackResult.data.name || ac;
                await this.saveACData(normalizedACName, fallbackResult.data);
                console.log(`✅ Cached AC data using original name: "${ac}" -> "${normalizedACName}"`);
              } else {
                console.warn(`⚠️ Could not fetch AC data for "${ac}", using normalized: "${normalizedACName}"`);
              }
            } else {
              console.warn(`⚠️ Could not fetch AC data for "${ac}", using normalized: "${normalizedACName}"`);
            }
          }
        } catch (error) {
          // If AC data fetch fails, use normalized name
          console.warn(`⚠️ Error fetching AC data for "${ac}", using normalized: "${normalizedACName}"`);
        }
        
        acNameMap.set(ac, normalizedACName);
      } catch (error) {
        // If AC data fetch fails, use original name
        acNameMap.set(ac, ac);
        console.error(`❌ Error downloading AC data for "${ac}":`, error);
      }
    }

    // Download polling groups for all assigned ACs using normalized names
    console.log('📥 Downloading polling groups and stations...');
    const normalizedACs = Array.from(acNameMap.values());
    for (let i = 0; i < normalizedACs.length; i++) {
      const normalizedAC = normalizedACs[i];
      const originalAC = Array.from(acNameMap.entries()).find(([_, name]) => name === normalizedAC)?.[0] || normalizedAC;
      try {
        console.log(`📥 [${i + 1}/${normalizedACs.length}] Downloading groups for AC: ${normalizedAC} (original: ${originalAC})`);
        const result = await apiService.getGroupsByAC(state, normalizedAC);
        if (result.success && result.data) {
          // Save using normalized AC name
          await this.savePollingGroups(state, normalizedAC, result.data);
          console.log(`✅ Cached polling groups for: ${normalizedAC}`);
          
          // Also download polling stations for each group
          const groups = result.data.groups || [];
          console.log(`📥 Found ${groups.length} group(s) for ${normalizedAC}, downloading stations...`);
          
          // Debug: Log first group structure to understand format
          if (groups.length > 0) {
            console.log(`🔍 Sample group structure:`, typeof groups[0] === 'object' ? JSON.stringify(groups[0]).substring(0, 200) : groups[0]);
          }
          
          for (let j = 0; j < groups.length; j++) {
            // Handle both string and object formats
            const groupItem = groups[j];
            let groupName: string | null = null;
            
            if (typeof groupItem === 'string') {
              groupName = groupItem.trim();
            } else if (groupItem && typeof groupItem === 'object') {
              // Try different possible property names
              groupName = (groupItem.name || groupItem.groupName || groupItem.group || groupItem.value || '').toString().trim();
              // If still empty, try to stringify and extract
              if (!groupName) {
                try {
                  const stringified = JSON.stringify(groupItem);
                  console.warn(`⚠️ Group item is an object without name property: ${stringified.substring(0, 100)}`);
                } catch (e) {
                  console.warn(`⚠️ Could not stringify group item:`, groupItem);
                }
              }
            }
            
            if (!groupName || groupName.length === 0) {
              console.warn(`⚠️ Skipping invalid group item at index ${j}:`, typeof groupItem === 'object' ? JSON.stringify(groupItem).substring(0, 100) : groupItem);
              continue;
            }
            
            try {
              console.log(`📥 [${j + 1}/${groups.length}] Downloading stations for group: ${groupName}`);
              // Use normalized AC name for API call
              const stationsResult = await apiService.getPollingStationsByGroup(state, normalizedAC, groupName);
              if (stationsResult.success && stationsResult.data) {
                await this.savePollingStations(state, normalizedAC, groupName, stationsResult.data);
                console.log(`✅ Cached polling stations for: ${normalizedAC} - ${groupName}`);
                
                // Save GPS data from stations response (GPS is already included in the response, no need for individual API calls)
                const stations = stationsResult.data.stations || [];
                if (stations.length > 0 && includeGPS) {
                  console.log(`💾 Batch saving GPS data for ${stations.length} station(s) in ${groupName}...`);
                  
                  // Batch save all GPS data at once for better performance
                  try {
                    const allGPS = await this.getAllPollingGPS();
                    let savedCount = 0;
                    
                    for (const station of stations) {
                      const stationName = station.stationName || station.name || station;
                      if (stationName && typeof stationName === 'string') {
                        // GPS data is already in the station object from the API response
                        if (station.latitude && station.longitude) {
                          const key = `${state}::${normalizedAC}::${groupName}::${stationName}`;
                          allGPS[key] = {
                            gps_location: station.gps_location || station.gpsLocation || null,
                            latitude: station.latitude,
                            longitude: station.longitude,
                            state,
                            acIdentifier: normalizedAC,
                            groupName,
                            stationName,
                            cachedAt: new Date().toISOString(),
                          };
                          savedCount++;
                        }
                      }
                    }
                    
                    // Save all GPS data in a single write operation
                    if (savedCount > 0) {
                      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_GPS, JSON.stringify(allGPS));
                      console.log(`✅ Batch saved GPS data for ${savedCount}/${stations.length} station(s) in ${groupName}`);
                    }
                  } catch (batchError) {
                    console.error(`❌ Error batch saving GPS for ${groupName}:`, batchError);
                    // Fallback to individual saves if batch fails
                    console.log(`⚠️ Falling back to individual GPS saves for ${groupName}...`);
                    let savedCount = 0;
                    for (const station of stations) {
                      const stationName = station.stationName || station.name || station;
                      if (stationName && typeof stationName === 'string' && station.latitude && station.longitude) {
                        try {
                          await this.savePollingGPS(state, normalizedAC, groupName, stationName, {
                            gps_location: station.gps_location || station.gpsLocation || null,
                            latitude: station.latitude,
                            longitude: station.longitude
                          });
                          savedCount++;
                        } catch (gpsError) {
                          console.warn(`⚠️ Could not save GPS for ${stationName} (non-critical):`, gpsError);
                        }
                      }
                    }
                    console.log(`✅ Saved GPS data for ${savedCount}/${stations.length} station(s) in ${groupName} (fallback)`);
                  }
                } else if (stations.length > 0) {
                  console.log(`⏭️ Skipping GPS save for ${stations.length} station(s) in ${groupName} (will fetch on-demand)`);
                }
              } else {
                console.warn(`⚠️ Failed to download stations for ${normalizedAC} - ${groupName}`);
              }
            } catch (stationsError) {
              console.error(`❌ Error downloading stations for ${normalizedAC} - ${groupName}:`, stationsError);
            }
          }
        } else {
          // If groups fetch fails with normalized name, try original name as fallback
          if (normalizedAC !== originalAC) {
            console.log(`⚠️ Failed with normalized name ${normalizedAC}, trying original name ${originalAC}...`);
            try {
              const fallbackResult = await apiService.getGroupsByAC(state, originalAC);
              if (fallbackResult.success && fallbackResult.data) {
                await this.savePollingGroups(state, originalAC, fallbackResult.data);
                console.log(`✅ Cached polling groups for: ${originalAC} (using original name)`);
                // Continue with original AC name
                const groups = fallbackResult.data.groups || [];
                for (let j = 0; j < groups.length; j++) {
                  const groupItem = groups[j];
                  let groupName: string | null = null;
                  
                  if (typeof groupItem === 'string') {
                    groupName = groupItem.trim();
                  } else if (groupItem && typeof groupItem === 'object') {
                    groupName = (groupItem.name || groupItem.groupName || groupItem.group || groupItem.value || '').toString().trim();
                  }
                  
                  if (!groupName || groupName.length === 0) {
                    continue;
                  }
                  
                  try {
                    const stationsResult = await apiService.getPollingStationsByGroup(state, originalAC, groupName);
                    if (stationsResult.success && stationsResult.data) {
                      await this.savePollingStations(state, originalAC, groupName, stationsResult.data);
                      console.log(`✅ Cached polling stations for: ${originalAC} - ${groupName}`);
                    }
                  } catch (stationsError) {
                    console.error(`❌ Error downloading stations for ${originalAC} - ${groupName}:`, stationsError);
                  }
                }
              } else {
                console.error(`❌ Failed to download groups for ${originalAC}:`, fallbackResult.message);
              }
            } catch (fallbackError) {
              console.error(`❌ Error downloading polling groups for ${originalAC}:`, fallbackError);
            }
          } else {
            console.error(`❌ Failed to download groups for ${normalizedAC}:`, result.message);
          }
        }
      } catch (error: any) {
        console.error(`❌ Error downloading polling groups for ${normalizedAC}:`, error?.message || error);
      }
    }

    // Download gender quotas for all surveys
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

    // Download CATI set numbers for CATI surveys
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

      console.log('✅ Finished downloading dependent data');
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










