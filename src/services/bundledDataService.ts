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
   * Load bundled polling station data
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
        // In React Native, we need to fetch the bundled JSON file
        // Since require() might not work for large files, we'll use a fetch approach
        // But first, let's try require() - if it fails, we'll use an alternative
        
        console.log('📦 Loading bundled polling station data...');
        
        // In React Native/Expo, require() works for JSON files
        // The file is bundled with the app, so it's always available
        try {
          const pollingStations = require('../data/polling_stations.json');
          this.pollingStationData = pollingStations as PollingStationData;
          console.log('✅ Loaded bundled polling station data');
        } catch (requireError) {
          // If require() fails (e.g., in some bundlers), try alternative approach
          console.warn('⚠️ require() failed, trying alternative loading method...');
          // For now, we'll throw the error - the app should handle it gracefully
          throw requireError;
        }
      } catch (error) {
        console.error('❌ Error loading bundled polling station data:', error);
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
      console.log('✅ Loaded bundled AC data');
    } catch (error) {
      console.error('❌ Error loading bundled AC data:', error);
      // Return empty structure as fallback
      this.acData = { states: {} } as ACData;
    }

    return this.acData;
  }

  /**
   * Find AC number by AC name in a state (similar to backend logic)
   */
  async findACNumberByName(state: string, acName: string): Promise<string | null> {
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

      // Partial match
      if (normalizedStoredName.includes(normalizedSearchName) ||
          normalizedSearchName.includes(normalizedStoredName.replace(/\s*\([^)]*\)\s*/g, '').trim())) {
        return acNo;
      }

      // Try without parentheses
      const storedWithoutParens = normalizedStoredName.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const searchWithoutParens = normalizedSearchName.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (storedWithoutParens === searchWithoutParens) {
        return acNo;
      }
    }
    return null;
  }

  /**
   * Get groups for AC (by name or number) - similar to backend getGroupsForAC
   */
  async getGroupsForAC(state: string, acIdentifier: string): Promise<any> {
    const data = await this.loadPollingStationData();
    if (!data || !data[state]) return null;

    if (!acIdentifier || (typeof acIdentifier !== 'string' && typeof acIdentifier !== 'number')) return null;

    // Try to find by number first
    if (data[state][acIdentifier]) {
      return data[state][acIdentifier];
    }

    // Try to find by name
    const acNo = await this.findACNumberByName(state, acIdentifier);
    if (acNo && data[state][acNo]) {
      return data[state][acNo];
    }

    // Last resort: try direct case-insensitive name matching
    const normalizedSearch = String(acIdentifier).trim().toLowerCase();
    for (const [acNo, acData] of Object.entries(data[state])) {
      if (!acData.ac_name) continue;

      const normalizedStoredName = acData.ac_name.trim().toLowerCase();
      if (normalizedStoredName === normalizedSearch) {
        return acData;
      }

      // Also try without parentheses
      const nameWithoutParens = acData.ac_name?.replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
      if (nameWithoutParens === normalizedSearch) {
        return acData;
      }
    }

    return null;
  }

  /**
   * Get groups for an AC (returns format compatible with API response)
   */
  async getGroupsByAC(state: string, acIdentifier: string): Promise<{ success: boolean; data?: any; message?: string }> {
    try {
      const acData = await this.getGroupsForAC(state, acIdentifier);

      if (!acData) {
        return {
          success: false,
          message: 'AC not found in polling station data'
        };
      }

      const groups = Object.keys(acData.groups || {});
      const acNo = await this.findACNumberByName(state, acData.ac_name) || acIdentifier;

      return {
        success: true,
        data: {
          ac_name: acData.ac_name,
          ac_no: acNo,
          pc_no: acData.pc_no || null,
          pc_name: acData.pc_name || null,
          district: acData.district || null,
          groups: groups.map(groupName => ({
            name: groupName,
            polling_station_count: acData.groups[groupName].polling_stations.length
          }))
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
   * Get polling stations for a group
   */
  async getPollingStationsByGroup(state: string, acIdentifier: string, groupName: string): Promise<{ success: boolean; data?: any; message?: string }> {
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

      const stations = acData.groups[groupName].polling_stations;

      return {
        success: true,
        data: {
          stations: stations.map(station => ({
            name: station.name,
            gps_location: station.gps_location,
            latitude: station.latitude,
            longitude: station.longitude
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
}

export const bundledDataService = new BundledDataService();
