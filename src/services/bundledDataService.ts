/**
 * Service to access bundled polling station and AC data
 * These JSON files are bundled with the app, so they're always available offline
 */

// Import bundled JSON files
// Note: In React Native, we need to use require() for JSON files
// We'll load them dynamically to avoid bundling issues with large files

interface PollingStationData {
  [state: string]: {
    [acCode: string]: {
      ac_name: string;
      pc_no: number;
      pc_name: string;
      district: string;
      groups: {
        [groupName: string]: {
          polling_stations: Array<{
            name: string;
            gps_location: string;
            latitude: number;
            longitude: number;
          }>;
        };
      };
    };
  };
}

interface ACData {
  states: {
    [stateName: string]: {
      name: string;
      code: string;
      assemblyConstituencies: Array<{
        acCode: string;
        acName: string;
      }>;
    };
  };
}

class BundledDataService {
  private pollingStationData: PollingStationData | null = null;
  private acData: ACData | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Load polling station data
   * Priority: 1. Downloaded file (document directory) 2. Bundled file (require) 3. Empty object
   */
  async loadPollingStationData(): Promise<PollingStationData> {
    if (this.pollingStationData) {
      return this.pollingStationData;
    }

    if (this.loadingPromise) {
      await this.loadingPromise;
      return this.pollingStationData!;
    }

    this.loadingPromise = (async () => {
      try {
        console.log('📦 Loading polling station data...');
        
        // FIRST: Try to load from downloaded file (if available)
        try {
          const { pollingStationsSyncService } = await import('./pollingStationsSyncService');
          const downloadedData = await pollingStationsSyncService.loadDownloadedFile();
          
          if (downloadedData) {
            this.pollingStationData = downloadedData as PollingStationData;
            console.log('✅ Loaded polling station data from downloaded file');
            return;
          }
        } catch (downloadError) {
          console.log('⚠️ Could not load from downloaded file, trying bundled file...', downloadError);
        }

        // SECOND: Fallback to bundled file (require)
        try {
          const pollingStations = require('../data/polling_stations.json');
          this.pollingStationData = pollingStations as PollingStationData;
          console.log('✅ Loaded polling station data from bundled file');
        } catch (requireError) {
          // If require() fails, try alternative approach
          console.warn('⚠️ require() failed, trying alternative loading method...');
          throw requireError;
        }
      } catch (error) {
        console.error('❌ Error loading polling station data:', error);
        // Return empty object as fallback
        this.pollingStationData = {} as PollingStationData;
      }
    })();

    await this.loadingPromise;
    return this.pollingStationData!;
  }

  /**
   * Load bundled AC data
   */
  async loadACData(): Promise<ACData> {
    if (this.acData) {
      return this.acData;
    }

    try {
      console.log('📦 Loading bundled AC data...');
      // In React Native/Expo, require() works for JSON files
      const acData = require('../data/assemblyConstituencies.json');
      this.acData = acData as ACData;
      
      // Log summary
      const states = Object.keys(this.acData.states || {});
      const totalACs = states.reduce((sum, state) => {
        return sum + (this.acData.states[state]?.assemblyConstituencies?.length || 0);
      }, 0);
      console.log(`✅ Loaded bundled AC data: ${states.length} states, ${totalACs} total ACs`);
    } catch (error: any) {
      console.error('❌ Error loading bundled AC data:', error);
      console.error('❌ Error details:', error.message, error.stack);
      // Return empty structure as fallback - app will try cache/API as backup
      this.acData = { states: {} } as ACData;
    }

    return this.acData;
  }

  /**
   * Extract numeric AC code from full AC code (e.g., "WB051" -> "51")
   * Removes state prefix and leading zeros
   */
  private extractNumericACCode(fullACCode: string, stateCode?: string): string | null {
    if (!fullACCode || typeof fullACCode !== 'string') return null;
    
    // If state code is provided, remove it (e.g., "WB051" -> "051")
    let numericPart = fullACCode;
    if (stateCode) {
      if (numericPart.startsWith(stateCode)) {
        numericPart = numericPart.substring(stateCode.length);
      }
    } else {
      // Try to detect state code (first 2 letters)
      const stateCodeMatch = numericPart.match(/^([A-Z]{2})(\d+)$/);
      if (stateCodeMatch) {
        numericPart = stateCodeMatch[2];
      }
    }
    
    // Remove leading zeros (e.g., "051" -> "51", "001" -> "1")
    const numericCode = numericPart.replace(/^0+/, '') || numericPart;
    return numericCode;
  }

  /**
   * Find AC code from AC name using assemblyConstituencies.json
   * This is the PRIMARY method - AC codes are reliable, names can vary
   */
  async findACCodeByName(state: string, acName: string): Promise<string | null> {
    try {
      const acData = await this.loadACData();
      if (!acData || !acData.states || !acData.states[state]) return null;

      const stateData = acData.states[state];
      if (!stateData.assemblyConstituencies) return null;

      const normalizedSearchName = String(acName).trim().toLowerCase().replace(/\s+/g, ' ');

      // Search for matching AC name
      for (const ac of stateData.assemblyConstituencies) {
        if (!ac.acName) continue;

        const normalizedACName = ac.acName.trim().toLowerCase().replace(/\s+/g, ' ');

        // Exact match
        if (normalizedACName === normalizedSearchName) {
          return ac.acCode;
        }

        // Match without spaces (e.g., "English Bazaar" matches "Englishbazar")
        const acNameNoSpaces = normalizedACName.replace(/\s+/g, '');
        const searchNoSpaces = normalizedSearchName.replace(/\s+/g, '');
        if (acNameNoSpaces === searchNoSpaces) {
          return ac.acCode;
        }

        // Try without parentheses (exact match after removing parens)
        const acNameWithoutParens = normalizedACName.replace(/\s*\([^)]*\)\s*/g, '').trim();
        const searchWithoutParens = normalizedSearchName.replace(/\s*\([^)]*\)\s*/g, '').trim();
        if (acNameWithoutParens === searchWithoutParens && acNameWithoutParens !== '') {
          return ac.acCode;
        }

        // Partial match - ONLY if search term is longer or similar length (prevents "Para" matching "Hariharpara")
        // CRITICAL FIX: Prioritize exact matches to prevent substring conflicts
        // This prevents "Para" from matching "Hariharpara" and "Kashipur" from matching "Kashipur-Belgachhia"
        const lengthDiff = Math.abs(acNameWithoutParens.length - searchWithoutParens.length);
        
        // Only allow partial match if search term is longer or similar length (within 3 chars)
        // This prevents short names from matching longer names that contain them
        if (searchWithoutParens.length >= acNameWithoutParens.length && 
            acNameWithoutParens.includes(searchWithoutParens) && 
            lengthDiff <= 3) {
          return ac.acCode;
        }
      }
    } catch (error) {
      console.error('Error finding AC code by name:', error);
    }
    return null;
  }

  /**
   * Find AC number by AC name in a state (similar to backend logic)
   * This is a fallback method - primarily uses AC code lookup
   */
  async findACNumberByName(state: string, acName: string): Promise<string | null> {
    // FIRST: Try to find AC code from assemblyConstituencies.json (most reliable)
    const fullACCode = await this.findACCodeByName(state, acName);
    if (fullACCode) {
      // Extract numeric AC code (e.g., "WB051" -> "51")
      const acData = await this.loadACData();
      const stateCode = acData?.states?.[state]?.code;
      const numericCode = this.extractNumericACCode(fullACCode, stateCode);
      if (numericCode) {
        console.log(`🔍 Found AC code for "${acName}": ${fullACCode} -> ${numericCode}`);
        return numericCode;
      }
    }

    // FALLBACK: Try direct name matching in polling_stations.json
    const data = await this.loadPollingStationData();
    if (!data || !data[state]) return null;

    if (!acName || (typeof acName !== 'string' && typeof acName !== 'number')) return null;
    const acNameStr = String(acName).trim();
    if (!acNameStr || acNameStr === 'N/A' || acNameStr === '') return null;

    const normalizedSearchName = acNameStr.toLowerCase().replace(/\s+/g, ' ');

    for (const [acNo, acData] of Object.entries(data[state])) {
      if (!acData.ac_name) continue;

      const normalizedStoredName = acData.ac_name.trim().toLowerCase().replace(/\s+/g, ' ');

      // Exact match
      if (normalizedStoredName === normalizedSearchName) {
        return acNo;
      }

      // Match without spaces (e.g., "English Bazaar" matches "Englishbazar")
      const storedNoSpaces = normalizedStoredName.replace(/\s+/g, '');
      const searchNoSpaces = normalizedSearchName.replace(/\s+/g, '');
      if (storedNoSpaces === searchNoSpaces) {
        return acNo;
      }

      // Try without parentheses (exact match after removing parens)
      const storedWithoutParens = normalizedStoredName.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const searchWithoutParens = normalizedSearchName.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (storedWithoutParens === searchWithoutParens && storedWithoutParens !== '') {
        return acNo;
      }

      // Partial match - ONLY if search term is longer or similar length (prevents "Para" matching "Hariharpara")
      // CRITICAL FIX: Prioritize exact matches to prevent substring conflicts
      // This prevents "Para" from matching "Hariharpara" and "Kashipur" from matching "Kashipur-Belgachhia"
      const lengthDiff = Math.abs(storedWithoutParens.length - searchWithoutParens.length);
      
      // Only allow partial match if search term is longer or similar length (within 3 chars)
      // This prevents short names from matching longer names that contain them
      if (searchWithoutParens.length >= storedWithoutParens.length && 
          storedWithoutParens.includes(searchWithoutParens) && 
          lengthDiff <= 3) {
        return acNo;
      }
    }
    return null;
  }

  /**
   * Get groups for AC (by name or number) - similar to backend getGroupsForAC
   * PRIMARY METHOD: Uses AC code lookup from assemblyConstituencies.json
   */
  async getGroupsForAC(state: string, acIdentifier: string): Promise<any> {
    const data = await this.loadPollingStationData();
    if (!data || !data[state]) return null;

    if (!acIdentifier || (typeof acIdentifier !== 'string' && typeof acIdentifier !== 'number')) return null;

    // STEP 1: Try direct numeric lookup first (if identifier is already a number)
    if (data[state][acIdentifier]) {
      console.log(`📦 Direct numeric lookup found AC: ${acIdentifier}`);
      return data[state][acIdentifier];
    }

    // STEP 2: PRIMARY METHOD - Find AC code from assemblyConstituencies.json
    // This is the most reliable method - AC codes never fail, names can vary
    try {
      const fullACCode = await this.findACCodeByName(state, String(acIdentifier));
      if (fullACCode) {
        // Extract numeric AC code (e.g., "WB051" -> "51")
        const acData = await this.loadACData();
        const stateCode = acData?.states?.[state]?.code;
        const numericCode = this.extractNumericACCode(fullACCode, stateCode);
        
        if (numericCode && data[state][numericCode]) {
          console.log(`📦 AC code lookup: "${acIdentifier}" -> ${fullACCode} -> ${numericCode} (SUCCESS)`);
          return data[state][numericCode];
        } else if (numericCode) {
          console.warn(`⚠️ AC code lookup found ${numericCode} but not in polling_stations.json`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Error in AC code lookup, trying fallback:', error);
    }

    // STEP 3: FALLBACK - Try to find by name in polling_stations.json
    const acNo = await this.findACNumberByName(state, acIdentifier);
    if (acNo && data[state][acNo]) {
      console.log(`📦 Name lookup found AC: ${acNo} for "${acIdentifier}"`);
      return data[state][acNo];
    }

    // STEP 4: Last resort - try direct case-insensitive name matching (EXACT MATCHES ONLY)
    // CRITICAL: Only exact matches here to prevent "Para" matching "Hariharpara"
    const normalizedSearch = String(acIdentifier).trim().toLowerCase().replace(/\s+/g, '');
    for (const [acNo, acData] of Object.entries(data[state])) {
      if (!acData.ac_name) continue;

      const normalizedStoredName = acData.ac_name.trim().toLowerCase().replace(/\s+/g, '');
      // Exact match only - no partial matching
      if (normalizedStoredName === normalizedSearch) {
        console.log(`📦 Direct name match found AC: ${acNo} for "${acIdentifier}"`);
        return acData;
      }

      // Also try without parentheses (exact match only)
      const nameWithoutParens = acData.ac_name?.replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase().replace(/\s+/g, '');
      const searchWithoutParens = normalizedSearch.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (nameWithoutParens === searchWithoutParens && nameWithoutParens !== '') {
        console.log(`📦 Name match (no parens) found AC: ${acNo} for "${acIdentifier}"`);
        return acData;
      }
    }

    console.warn(`⚠️ Could not find AC "${acIdentifier}" in state "${state}"`);
    return null;
  }

  /**
   * Get groups for an AC (returns format compatible with API response)
   */
  async getGroupsByAC(state: string, acIdentifier: string, roundNumber?: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const acData = await this.getGroupsForAC(state, acIdentifier);

      if (!acData) {
        return {
          success: false,
          message: 'AC not found in polling station data'
        };
      }

      let groups = Object.keys(acData.groups || {});
      
      // Filter groups by round number if provided
      if (roundNumber) {
        groups = groups.filter(groupName => {
          const stations = acData.groups[groupName].polling_stations || [];
          return stations.some((station: any) => station.Interview_Round_number === roundNumber);
        });
      }
      
      const acNo = await this.findACNumberByName(state, acData.ac_name) || acIdentifier;

      return {
        success: true,
        data: {
          ac_name: acData.ac_name,
          ac_no: acNo,
          pc_no: acData.pc_no || null,
          pc_name: acData.pc_name || null,
          district: acData.district || null,
          groups: groups.map(groupName => {
            const stations = acData.groups[groupName].polling_stations || [];
            // Filter stations by round number if provided
            const filteredStations = roundNumber 
              ? stations.filter((s: any) => s.Interview_Round_number === roundNumber)
              : stations;
            return {
            name: groupName,
              polling_station_count: filteredStations.length
            };
          }).filter(group => group.polling_station_count > 0) // Only return groups with stations
        }
      };
    } catch (error: any) {
      console.error('Error getting groups from bundled data:', error);
      return {
        success: false,
        message: error.message || 'Failed to get groups from bundled data'
      };
    }
  }

  /**
   * Get all ACs for a state from bundled assemblyConstituencies.json
   */
  async getAllACsForState(state: string): Promise<{ success: boolean; data?: any[]; message?: string }> {
    try {
      const acData = await this.loadACData();
      if (!acData || !acData.states) {
        return {
          success: false,
          message: 'AC data not available'
        };
      }

      // Find the state in the data
      const stateData = acData.states[state];
      if (!stateData || !stateData.assemblyConstituencies) {
        return {
          success: false,
          message: `State "${state}" not found in bundled AC data`
        };
      }

      // Convert to the format expected by the app
      const acs = stateData.assemblyConstituencies.map((ac: any) => ({
        acCode: ac.acCode,
        acName: ac.acName,
        displayText: `${ac.acCode} - ${ac.acName}`,
        searchText: `${ac.acCode} ${ac.acName}`.toLowerCase()
      }));

      console.log(`📦 Loaded ${acs.length} ACs for state "${state}" from bundled data`);

      return {
        success: true,
        data: acs
      };
    } catch (error: any) {
      console.error('Error getting ACs from bundled data:', error);
      return {
        success: false,
        message: error.message || 'Failed to get ACs from bundled data'
      };
    }
  }

  /**
   * Get available round numbers for an AC
   */
  async getRoundNumbersByAC(state: string, acIdentifier: string): Promise<{ success: boolean; data?: { rounds: string[] }; message?: string }> {
    try {
      const acData = await this.getGroupsForAC(state, acIdentifier);

      if (!acData) {
        return {
          success: false,
          message: 'AC not found in polling station data'
        };
      }

      // Collect unique round numbers from all groups
      const roundNumbers = new Set<string>();
      for (const groupName in acData.groups || {}) {
        const stations = acData.groups[groupName].polling_stations || [];
        for (const station of stations) {
          if (station.Interview_Round_number) {
            roundNumbers.add(String(station.Interview_Round_number));
          }
        }
      }

      const rounds = Array.from(roundNumbers).sort((a, b) => parseInt(a) - parseInt(b));

      return {
        success: true,
        data: {
          rounds: rounds
        }
      };
    } catch (error: any) {
      console.error('Error getting round numbers from bundled data:', error);
      return {
        success: false,
        message: error.message || 'Failed to get round numbers from bundled data'
      };
    }
  }

  /**
   * Get polling stations for a group
   */
  async getPollingStationsByGroup(state: string, acIdentifier: string, groupName: string, roundNumber?: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const acData = await this.getGroupsForAC(state, acIdentifier);

      if (!acData) {
        return {
          success: false,
          message: 'AC not found in polling station data'
        };
      }

      if (!acData.groups[groupName]) {
        return {
          success: false,
          message: 'Group not found in polling station data'
        };
      }

      let stations = acData.groups[groupName].polling_stations || [];

      // Filter by round number if provided
      if (roundNumber) {
        stations = stations.filter((station: any) => station.Interview_Round_number === roundNumber);
      }

      return {
        success: true,
        data: {
          stations: stations.map((station: any) => ({
            name: station.name,
            gps_location: station.gps_location,
            latitude: station.latitude,
            longitude: station.longitude,
            Interview_Round_number: station.Interview_Round_number || null
          }))
        }
      };
    } catch (error: any) {
      console.error('Error getting polling stations from bundled data:', error);
      return {
        success: false,
        message: error.message || 'Failed to get polling stations from bundled data'
      };
    }
  }

  /**
   * Clear cached polling station data (useful after downloading new file)
   */
  clearCache(): void {
    this.pollingStationData = null;
    this.loadingPromise = null;
    console.log('🔄 Cleared polling station data cache');
  }
}

export const bundledDataService = new BundledDataService();
