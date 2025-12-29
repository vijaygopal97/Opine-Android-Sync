/**
 * Comprehensive App Logging Service
 * Sends all app logs to backend for debugging and monitoring
 */

import { apiService } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export interface AppLog {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  category: string;
  metadata?: any;
  stackTrace?: string;
}

const LOG_QUEUE_KEY = 'app_logs_queue';
const MAX_QUEUE_SIZE = 100; // Maximum logs to keep in queue
const BATCH_SIZE = 20; // Send logs in batches
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class AppLoggingService {
  private deviceId: string | null = null;
  private userId: string | null = null;
  private logQueue: AppLog[] = [];
  private isSending = false;
  private lastSentTimestamp: Date | null = null;

  /**
   * Initialize logging service
   */
  async initialize(): Promise<void> {
    try {
      // Get or create device ID
      this.deviceId = await this.getDeviceId();
      
      // Get user ID from storage
      const userData = await AsyncStorage.getItem('userData');
      if (userData) {
        const user = JSON.parse(userData);
        this.userId = user._id || user.id;
      }
      
      // Load existing log queue
      await this.loadLogQueue();
      
      // Send logs periodically (every 5 minutes or when queue reaches batch size)
      this.startPeriodicSending();
      
      console.log('✅ App logging service initialized');
    } catch (error) {
      console.error('❌ Error initializing app logging service:', error);
    }
  }

  /**
   * Get or create device ID
   */
  private async getDeviceId(): Promise<string> {
    try {
      let deviceId = await AsyncStorage.getItem('device_id');
      if (!deviceId) {
        // Generate unique device ID
        const modelId = Device.modelId || 'unknown';
        const platform = Platform.OS;
        deviceId = `${platform}_${modelId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        await AsyncStorage.setItem('device_id', deviceId);
      }
      return deviceId;
    } catch (error) {
      console.error('Error getting device ID:', error);
      return `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
  }

  /**
   * Load log queue from storage
   */
  private async loadLogQueue(): Promise<void> {
    try {
      const queueData = await AsyncStorage.getItem(LOG_QUEUE_KEY);
      if (queueData) {
        this.logQueue = JSON.parse(queueData);
        // Clean old logs
        const now = new Date();
        this.logQueue = this.logQueue.filter(log => {
          const logTime = new Date(log.timestamp);
          return (now.getTime() - logTime.getTime()) < MAX_LOG_AGE_MS;
        });
        await this.saveLogQueue();
      }
    } catch (error) {
      console.error('Error loading log queue:', error);
      this.logQueue = [];
    }
  }

  /**
   * Save log queue to storage
   */
  private async saveLogQueue(): Promise<void> {
    try {
      // Keep only latest MAX_QUEUE_SIZE logs
      if (this.logQueue.length > MAX_QUEUE_SIZE) {
        this.logQueue = this.logQueue.slice(-MAX_QUEUE_SIZE);
      }
      await AsyncStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(this.logQueue));
    } catch (error) {
      console.error('Error saving log queue:', error);
    }
  }

  /**
   * Log a message
   */
  log(level: AppLog['level'], category: string, message: string, metadata?: any, error?: Error): void {
    try {
      const log: AppLog = {
        level,
        message,
        timestamp: new Date().toISOString(),
        category,
        metadata: metadata || {},
        stackTrace: error?.stack
      };

      // Add to queue
      this.logQueue.push(log);
      
      // Save queue
      this.saveLogQueue().catch(err => console.error('Error saving log queue:', err));

      // If queue is full, send immediately
      if (this.logQueue.length >= BATCH_SIZE) {
        this.sendLogsToBackend().catch(err => console.error('Error sending logs:', err));
      }

      // Also log to console for development
      if (__DEV__) {
        const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        consoleMethod(`[${category}] ${message}`, metadata || '');
      }
    } catch (error) {
      console.error('Error logging:', error);
    }
  }

  /**
   * Log info message
   */
  info(category: string, message: string, metadata?: any): void {
    this.log('info', category, message, metadata);
  }

  /**
   * Log warning
   */
  warn(category: string, message: string, metadata?: any): void {
    this.log('warn', category, message, metadata);
  }

  /**
   * Log error
   */
  error(category: string, message: string, metadata?: any, error?: Error): void {
    this.log('error', category, message, metadata, error);
  }

  /**
   * Log debug message
   */
  debug(category: string, message: string, metadata?: any): void {
    this.log('debug', category, message, metadata);
  }

  /**
   * Start periodic log sending
   */
  private startPeriodicSending(): void {
    // Send logs every 5 minutes
    setInterval(() => {
      this.sendLogsToBackend().catch(err => console.error('Error in periodic log send:', err));
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Send logs to backend
   */
  async sendLogsToBackend(): Promise<void> {
    if (this.isSending || this.logQueue.length === 0) {
      return;
    }

    this.isSending = true;

    try {
      // Check if online
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - logs will be sent when online');
        this.isSending = false;
        return;
      }

      // Get device info
      const deviceInfo = {
        deviceId: this.deviceId,
        platform: Platform.OS,
        version: Platform.Version,
        model: Device.modelName || 'unknown',
        brand: Device.brand || 'unknown',
        manufacturer: Device.manufacturer || 'unknown'
      };

      // Send logs in batches
      while (this.logQueue.length > 0) {
        const batch = this.logQueue.splice(0, BATCH_SIZE);
        
        try {
          await apiService.sendAppLogs({
            logs: batch,
            deviceInfo,
            userId: this.userId,
            appVersion: '12'
          });

          this.lastSentTimestamp = new Date();
          console.log(`✅ Sent ${batch.length} logs to backend`);
        } catch (error) {
          // Put logs back in queue if send fails
          this.logQueue.unshift(...batch);
          console.error('❌ Error sending logs to backend:', error);
          break;
        }
      }

      // Save updated queue
      await this.saveLogQueue();
    } catch (error) {
      console.error('❌ Error in sendLogsToBackend:', error);
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Log sync attempt with full details
   */
  logSyncAttempt(interviewId: string, action: string, details: any): void {
    this.info('SYNC', `Sync attempt: ${action}`, {
      interviewId,
      ...details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log sync result
   */
  logSyncResult(interviewId: string, success: boolean, result: any): void {
    const level = success ? 'info' : 'error';
    this.log(level, 'SYNC', `Sync result: ${success ? 'SUCCESS' : 'FAILED'}`, {
      interviewId,
      success,
      result
    });
  }

  /**
   * Log authentication events
   */
  logAuthEvent(event: string, details?: any): void {
    this.info('AUTH', event, details);
  }

  /**
   * Force send all logs immediately
   */
  async flushLogs(): Promise<void> {
    await this.sendLogsToBackend();
  }
}

// Export singleton instance
export const appLoggingService = new AppLoggingService();





