/**
 * Service to sync polling_stations.json from backend
 * Only downloads when the file has changed (based on hash comparison)
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './api';

const STORAGE_KEYS = {
  POLLING_STATIONS_HASH: 'polling_stations_hash',
  POLLING_STATIONS_LAST_CHECK: 'polling_stations_last_check',
};

const POLLING_STATIONS_FILE_NAME = 'polling_stations.json';
const POLLING_STATIONS_DIR = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';

class PollingStationsSyncService {
  private isSyncing = false;

  /**
   * Get the local file path for downloaded polling_stations.json
   */
  getLocalFilePath(): string {
    return `${POLLING_STATIONS_DIR}${POLLING_STATIONS_FILE_NAME}`;
  }

  /**
   * Get stored hash from AsyncStorage
   */
  async getStoredHash(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.POLLING_STATIONS_HASH);
    } catch (error) {
      console.error('Error getting stored hash:', error);
      return null;
    }
  }

  /**
   * Store hash in AsyncStorage
   */
  async storeHash(hash: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_STATIONS_HASH, hash);
      await AsyncStorage.setItem(STORAGE_KEYS.POLLING_STATIONS_LAST_CHECK, new Date().toISOString());
    } catch (error) {
      console.error('Error storing hash:', error);
    }
  }

  /**
   * Get the hash of the bundled file (for initial comparison)
   */
  private async getBundledFileHash(): Promise<string | null> {
    try {
      // Calculate hash of bundled file
      const bundledFile = require('../data/polling_stations.json');
      const bundledContent = JSON.stringify(bundledFile);
      
      // Use crypto if available, otherwise calculate a simple hash
      // For React Native, we'll use a simple hash calculation
      let hash = '';
      for (let i = 0; i < bundledContent.length; i++) {
        const char = bundledContent.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      // Convert to hex string (simplified, but works for comparison)
      // For better accuracy, we should use crypto, but React Native might not have it
      // So we'll use the server's hash calculation instead
      return null; // Return null to indicate we should use server comparison
    } catch (error) {
      console.error('Error calculating bundled file hash:', error);
      return null;
    }
  }

  /**
   * Check if polling_stations.json needs to be updated
   * Returns { needsUpdate: boolean, hash: string, lastModified: string }
   */
  async checkForUpdates(): Promise<{ needsUpdate: boolean; hash: string | null; lastModified: string | null; error?: string }> {
    try {
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - cannot check for polling stations update');
        return { needsUpdate: false, hash: null, lastModified: null };
      }

      const result = await apiService.checkPollingStationsUpdate();
      
      if (!result.success || !result.data) {
        return { 
          needsUpdate: false, 
          hash: null, 
          lastModified: null,
          error: result.message || 'Failed to check update'
        };
      }

      const serverHash = result.data.hash;
      const serverLastModified = result.data.lastModified;
      let localHash = await this.getStoredHash();

      // If no stored hash exists, check if we have a downloaded file
      if (!localHash) {
        const hasDownloadedFile = await this.hasDownloadedFile();
        if (!hasDownloadedFile) {
          // No downloaded file and no stored hash means we're using bundled file
          // IMPORTANT: We cannot assume the bundled file matches the server file
          // The bundled file might be from an older build (e.g., V9)
          // We should ALWAYS download if hashes don't match, even if we have no stored hash
          // This ensures users with old bundled files get the latest version
          console.log('📦 No stored hash found - checking if bundled file matches server...');
          console.log('⚠️  Bundled file may be outdated - will download if hashes differ');
          
          // Compare bundled file hash with server hash
          // Since we can't reliably calculate bundled file hash in React Native,
          // we should ALWAYS treat "no stored hash" as needing an update check
          // The downloadLatest() method will handle the actual comparison via If-None-Match
          // For now, return needsUpdate: true to force a download attempt
          // The download endpoint will return 304 if file hasn't changed
          return {
            needsUpdate: true, // Force download attempt to verify bundled file
            hash: serverHash,
            lastModified: serverLastModified,
          };
        }
        // If we have a downloaded file but no hash, we should still check
        // (This shouldn't happen normally, but handle it gracefully)
      }

      const needsUpdate = localHash !== serverHash;

      console.log('🔍 Polling stations update check:', {
        localHash: localHash?.substring(0, 16) + '...',
        serverHash: serverHash?.substring(0, 16) + '...',
        needsUpdate,
      });

      return {
        needsUpdate,
        hash: serverHash,
        lastModified: serverLastModified,
      };
    } catch (error: any) {
      console.error('Error checking for updates:', error);
      return {
        needsUpdate: false,
        hash: null,
        lastModified: null,
        error: error.message || 'Failed to check for updates',
      };
    }
  }

  /**
   * Download the latest polling_stations.json file
   */
  async downloadLatest(): Promise<{ success: boolean; message: string; hash?: string }> {
    if (this.isSyncing) {
      return { success: false, message: 'Download already in progress' };
    }

    this.isSyncing = true;

    try {
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        return { success: false, message: 'No internet connection' };
      }

      const localHash = await this.getStoredHash();
      console.log('📥 Downloading polling_stations.json...');
      
      const result = await apiService.downloadPollingStations(localHash || undefined);

      if (result.unchanged) {
        console.log('✅ Polling stations file is up to date');
        return { success: true, message: 'File is up to date', hash: localHash || undefined };
      }

      if (!result.success || !result.data) {
        return { success: false, message: result.message || 'Failed to download file' };
      }

      // Save file to document directory
      const filePath = this.getLocalFilePath();
      const fileContent = typeof result.data === 'string' 
        ? result.data 
        : JSON.stringify(result.data);

      // Write file - UTF8 is default, so we can omit encoding or use string
      try {
        await FileSystem.writeAsStringAsync(filePath, fileContent);
      } catch (writeError: any) {
        // If that fails, try with explicit encoding as string
        if (writeError.message?.includes('encoding') || writeError.message?.includes('UTF8')) {
          // Try without encoding option (UTF8 is default)
          await FileSystem.writeAsStringAsync(filePath, fileContent);
        } else {
          throw writeError;
        }
      }

      // Store the hash
      if (result.hash) {
        await this.storeHash(result.hash);
      }

      console.log('✅ Downloaded and saved polling_stations.json');
      return {
        success: true,
        message: 'Polling stations file updated successfully',
        hash: result.hash,
      };
    } catch (error: any) {
      console.error('Error downloading polling stations:', error);
      return {
        success: false,
        message: error.message || 'Failed to download polling stations file',
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Check for updates and download if needed
   * Returns true if update was downloaded, false otherwise
   */
  async checkAndUpdate(): Promise<{ updated: boolean; message: string }> {
    try {
      const checkResult = await this.checkForUpdates();
      
      if (checkResult.error) {
        return { updated: false, message: checkResult.error };
      }

      if (!checkResult.needsUpdate) {
        return { updated: false, message: 'Polling stations file is up to date' };
      }

      const downloadResult = await this.downloadLatest();
      
      return {
        updated: downloadResult.success,
        message: downloadResult.message,
      };
    } catch (error: any) {
      console.error('Error in checkAndUpdate:', error);
      return {
        updated: false,
        message: error.message || 'Failed to check and update',
      };
    }
  }

  /**
   * Check if downloaded file exists
   */
  async hasDownloadedFile(): Promise<boolean> {
    try {
      const filePath = this.getLocalFilePath();
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      return fileInfo.exists === true;
    } catch (error) {
      console.error('Error checking downloaded file:', error);
      return false;
    }
  }

  /**
   * Load polling stations data from downloaded file
   */
  async loadDownloadedFile(): Promise<any | null> {
    try {
      const filePath = this.getLocalFilePath();
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      
      if (!fileInfo.exists) {
        return null;
      }

      // Read file - UTF8 is default encoding
      const fileContent = await FileSystem.readAsStringAsync(filePath);

      return JSON.parse(fileContent);
    } catch (error) {
      console.error('Error loading downloaded file:', error);
      return null;
    }
  }
}

export const pollingStationsSyncService = new PollingStationsSyncService();

