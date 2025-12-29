import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
  Animated,
  AppState,
  AppStateStatus,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import {
  Text,
  Card,
  Button,
  Avatar,
  FAB,
  Snackbar,
  ActivityIndicator,
  Menu,
} from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiService } from '../services/api';
import { User, Survey } from '../types';
import { offlineStorage } from '../services/offlineStorage';
import { syncService } from '../services/syncService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { appLoggingService } from '../services/appLoggingService';

const { width } = Dimensions.get('window');

interface DashboardProps {
  navigation: any;
  user: User;
  onLogout: () => void;
}

export default function InterviewerDashboard({ navigation, user, onLogout }: DashboardProps) {
  const [availableSurveys, setAvailableSurveys] = useState<Survey[]>([]);
  const [myInterviews, setMyInterviews] = useState<any[]>([]);
  const [offlineInterviews, setOfflineInterviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarType, setSnackbarType] = useState<'success' | 'error' | 'info'>('info');
  const [pendingInterviewsCount, setPendingInterviewsCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const [isSyncingSurveys, setIsSyncingSurveys] = useState(false);
  const [expandedSurveys, setExpandedSurveys] = useState<Set<string>>(new Set());
  const [loadingAnimation] = useState(new Animated.Value(0));
  const [pulseAnimation] = useState(new Animated.Value(1));
  const [rotationAnimation] = useState(new Animated.Value(0));
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  // Interview stats from API (lightweight endpoint)
  const [interviewStats, setInterviewStats] = useState({
    totalCompleted: 0,
    approved: 0,
    rejected: 0,
    pendingApproval: 0
  });
  // Force Offline Mode - COMMENTED OUT (can be re-enabled when needed)
  // const [forceOfflineMode, setForceOfflineMode] = useState(false);
  
  // Network Condition Emulation - COMMENTED OUT (can be re-enabled when needed)
  // const [networkCondition, setNetworkCondition] = useState<'good_stable' | 'below_average' | 'slow_unstable' | 'very_slow'>('good_stable');
  // const [networkMenuVisible, setNetworkMenuVisible] = useState(false);
  
  // Get safe area insets for bottom navigation
  const insets = useSafeAreaInsets();

  // Load force offline mode state - COMMENTED OUT (can be re-enabled when needed)
  // useEffect(() => {
  //   const loadForceOfflineMode = async () => {
  //     try {
  //       const stored = await AsyncStorage.getItem('forceOfflineMode');
  //       const enabled = stored === 'true';
  //       setForceOfflineMode(enabled);
  //       apiService.setForceOfflineMode(enabled);
  //     } catch (error) {
  //       console.error('Error loading force offline mode:', error);
  //     }
  //   };
  //   loadForceOfflineMode();
  // }, []);

  // Load network condition state - COMMENTED OUT (can be re-enabled when needed)
  // Debug mode: Load saved network condition from storage
  // useEffect(() => {
  //   const loadNetworkCondition = async () => {
  //     try {
  //       const stored = await AsyncStorage.getItem('networkCondition');
  //       const condition: 'good_stable' | 'below_average' | 'slow_unstable' | 'very_slow' = 
  //         (stored as any) || 'good_stable';
  //       setNetworkCondition(condition);
  //       apiService.setNetworkCondition(condition);
  //       console.log('✅ Network condition loaded:', condition);
  //     } catch (error) {
  //       console.error('Error loading network condition:', error);
  //       // Fallback: ensure it's set to good_stable
  //       setNetworkCondition('good_stable');
  //       apiService.setNetworkCondition('good_stable');
  //     }
  //   };
  //   loadNetworkCondition();
  // }, []);

  // Toggle force offline mode function - COMMENTED OUT (can be re-enabled when needed)
  // const toggleForceOfflineMode = async () => {
  //   const newValue = !forceOfflineMode;
  //   setForceOfflineMode(newValue);
  //   apiService.setForceOfflineMode(newValue);
  //   try {
  //     await AsyncStorage.setItem('forceOfflineMode', String(newValue));
  //     showSnackbar(
  //       newValue 
  //         ? '🔴 Force Offline Mode ENABLED - All API calls will be blocked' 
  //         : '🟢 Force Offline Mode DISABLED - Normal mode restored',
  //       newValue ? 'info' : 'success'
  //     );
  //   } catch (error) {
  //     console.error('Error saving force offline mode:', error);
  //   }
  // };

  // Change network condition function - COMMENTED OUT (can be re-enabled when needed)
  // const changeNetworkCondition = async (condition: 'good_stable' | 'below_average' | 'slow_unstable' | 'very_slow') => {
  //   setNetworkCondition(condition);
  //   apiService.setNetworkCondition(condition);
  //   setNetworkMenuVisible(false);
  //   try {
  //     await AsyncStorage.setItem('networkCondition', condition);
  //     const conditionNames: Record<string, string> = {
  //       'good_stable': 'Good Stable Internet',
  //       'below_average': 'Below Average Internet',
  //       'slow_unstable': 'Slow & Unstable Internet',
  //       'very_slow': 'Very Slow Internet',
  //     };
  //     showSnackbar(
  //       `🌐 Network condition: ${conditionNames[condition]}`,
  //       'info'
  //     );
  //   } catch (error) {
  //     console.error('Error saving network condition:', error);
  //   }
  // };

  // Get network condition display name - COMMENTED OUT (can be re-enabled when needed)
  // const getNetworkConditionName = (condition: string): string => {
  //   const names: Record<string, string> = {
  //     'good_stable': 'Good Stable',
  //     'below_average': 'Below Average',
  //     'slow_unstable': 'Slow & Unstable',
  //     'very_slow': 'Very Slow',
  //   };
  //   return names[condition] || condition;
  // };
  
  // Animation effects for loading screen
  useEffect(() => {
    if (isLoading) {
      // Start pulsing animation
      const pulseAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnimation, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnimation, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );

      // Start rotation animation
      const rotateAnim = Animated.loop(
        Animated.timing(rotationAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      );

      // Start loading bar animation
      const loadingBarAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(loadingAnimation, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: false,
          }),
          Animated.timing(loadingAnimation, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ])
      );

      // Rotate loading text
      const textRotateInterval = setInterval(() => {
        setLoadingTextIndex((prev) => (prev + 1) % 4);
      }, 2000);

      pulseAnim.start();
      rotateAnim.start();
      loadingBarAnim.start();

      return () => {
        pulseAnim.stop();
        rotateAnim.stop();
        loadingBarAnim.stop();
        clearInterval(textRotateInterval);
      };
    }
  }, [isLoading]);

  useEffect(() => {
    loadDashboardData();
    loadPendingInterviewsCount();
    loadOfflineInterviews(); // Load offline interviews on mount
    
    // Check for polling stations update on app startup (background, non-blocking)
    const checkPollingStationsUpdate = async () => {
      try {
        const isOnline = await apiService.isOnline();
        if (isOnline) {
          const { pollingStationsSyncService } = await import('../services/pollingStationsSyncService');
          // Check in background without blocking
          pollingStationsSyncService.checkAndUpdate().then((result) => {
            if (result.updated) {
              console.log('✅ Polling stations updated on startup:', result.message);
              // Clear cache to force reload
              import('../services/bundledDataService').then((module) => {
                module.bundledDataService.clearCache();
              });
            }
          }).catch((err) => {
            console.error('Startup polling stations check error:', err);
          });
        }
      } catch (error) {
        console.error('Error checking polling stations on startup:', error);
      }
    };
    
    // Run check after a short delay to not block initial load
    setTimeout(checkPollingStationsUpdate, 2000);
  }, []);

  // Refresh stats, pending count and offline interviews when screen comes into focus
  // BUT: Only reload if it's been more than 2 seconds since last reload to prevent excessive reloads
  const lastFocusReloadRef = useRef<number>(0);
  const FOCUS_RELOAD_COOLDOWN_MS = 2000; // 2 seconds cooldown between focus reloads
  
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      const now = Date.now();
      const timeSinceLastReload = now - lastFocusReloadRef.current;
      
      // Only reload if it's been more than the cooldown period
      // This prevents excessive reloads when navigating back and forth
      if (timeSinceLastReload < FOCUS_RELOAD_COOLDOWN_MS) {
        console.log(`⏭️ Skipping dashboard reload - too soon since last reload (${Math.round(timeSinceLastReload)}ms ago)`);
        return;
      }
      
      console.log('🔄 Dashboard focused - reloading stats and offline interviews...');
      lastFocusReloadRef.current = now;
      
      // Refresh stats if online (lightweight operation)
      const refreshStats = async () => {
        const isOnline = await apiService.isOnline();
        if (isOnline) {
          const statsResult = await apiService.getInterviewerStats();
          if (statsResult.success && statsResult.stats) {
            setInterviewStats({
              totalCompleted: statsResult.stats.totalCompleted || 0,
              approved: statsResult.stats.approved || 0,
              rejected: statsResult.stats.rejected || 0,
              pendingApproval: statsResult.stats.pendingApproval || 0
            });
          }
        }
      };
      refreshStats();
      
      // Load pending interviews count first
      await loadPendingInterviewsCount();
      
      // CRITICAL: If online and there are pending interviews, trigger immediate sync
      // Get fresh pending count from storage (not state) to ensure accuracy
      const pendingInterviews = await offlineStorage.getPendingInterviews();
      const freshPendingCount = pendingInterviews.length;
      const isOnline = await apiService.isOnline();
      
      if (isOnline && freshPendingCount > 0 && !isSyncing) {
        console.log(`🔄 Dashboard focused with ${freshPendingCount} pending interviews - triggering immediate sync`);
        // Trigger sync in background (non-blocking)
        performBackgroundSync('dashboard_focus').catch(error => {
          console.error('Error triggering sync on dashboard focus:', error);
        });
      } else if (!isOnline) {
        console.log(`📴 Dashboard focused but device is offline - sync will run when online`);
      } else if (freshPendingCount === 0) {
        console.log(`✅ Dashboard focused - no pending interviews to sync`);
      }
      
      loadOfflineInterviews();
    });
    return unsubscribe;
  }, [navigation]);

  // Automatic background sync - Phase 4
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const MIN_SYNC_GAP_MS = 30 * 1000; // Minimum 30 seconds between syncs

  // Background sync function (silent, no UI blocking)
  const performBackgroundSync = async (reason: string) => {
    // Don't sync if already syncing
    if (isSyncing || syncService.isSyncInProgress()) {
      console.log(`⏭️ Skipping background sync (${reason}) - sync already in progress`);
      return;
    }

    // Check minimum time gap
    const now = Date.now();
    if (now - lastSyncTimeRef.current < MIN_SYNC_GAP_MS) {
      console.log(`⏭️ Skipping background sync (${reason}) - too soon since last sync`);
      return;
    }

    // Check if online
    const isOnline = await apiService.isOnline();
    if (!isOnline) {
      console.log(`⏭️ Skipping background sync (${reason}) - device is offline`);
      return;
    }

    // Check if there are pending interviews
    const pendingInterviews = await offlineStorage.getPendingInterviews();
    if (pendingInterviews.length === 0) {
      console.log(`⏭️ Skipping background sync (${reason}) - no pending interviews`);
      return;
    }

    console.log(`🔄 Starting background sync (${reason}) - ${pendingInterviews.length} pending interviews`);
    lastSyncTimeRef.current = now;

    try {
      setIsSyncing(true);
      const result = await syncService.syncOfflineInterviews();
      
      if (result.success && result.syncedCount > 0) {
        console.log(`✅ Background sync completed: ${result.syncedCount} synced, ${result.failedCount} failed`);
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: result.syncedCount, failed: result.failedCount });
        
        // Update data incrementally without full reload
        // Only reload what's necessary to reflect sync changes
        await loadOfflineInterviews(); // Update offline interviews list (removes synced ones)
        await loadPendingInterviewsCount(); // Update pending count
        // Don't reload full dashboard data - stats will update on next focus or periodic refresh
      } else if (result.failedCount > 0) {
        console.log(`⚠️ Background sync completed with errors: ${result.syncedCount} synced, ${result.failedCount} failed`);
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: result.syncedCount, failed: result.failedCount });
        // Only update offline interviews to show failed status
        await loadOfflineInterviews();
        await loadPendingInterviewsCount();
      } else if (result.syncedCount === 0 && result.failedCount === 0) {
        // No pending interviews - still update time to show sync ran
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: 0, failed: 0 });
      }
    } catch (error: any) {
      console.error('❌ Background sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Monitor network state in real-time using NetInfo
  const wasOfflineRef = useRef<boolean>(true); // Track previous state
  
  useEffect(() => {
    // Set initial network state
    NetInfo.fetch().then(state => {
      const isConnected = state.isConnected && state.isInternetReachable !== false;
      wasOfflineRef.current = isOffline;
      setIsOffline(!isConnected);
      console.log(`🌐 Initial network state: ${isConnected ? 'ONLINE' : 'OFFLINE'}`);
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected && state.isInternetReachable !== false;
      const wasOffline = wasOfflineRef.current;
      wasOfflineRef.current = !isConnected;
      setIsOffline(!isConnected);
      
      console.log(`🌐 Network state changed: ${isConnected ? 'ONLINE' : 'OFFLINE'}`);

      // If we just came online, trigger sync immediately
      if (wasOffline && isConnected) {
        console.log('🔄 Device came online - triggering background sync');
        performBackgroundSync('network_online').catch(error => {
          console.error('Error triggering sync on network online:', error);
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []); // Only run once on mount

  // Periodic check for pending interviews when online (backup mechanism)
  useEffect(() => {
    if (isOffline || isSyncing) {
      return; // Don't run if offline or already syncing
    }

    const checkAndSync = async () => {
      // Double-check we're still online
      const netState = await NetInfo.fetch();
      const isConnected = netState.isConnected && netState.isInternetReachable !== false;
      
      if (!isConnected) {
        setIsOffline(true);
        return;
      }

      // Get fresh pending count from storage
      const pendingInterviews = await offlineStorage.getPendingInterviews();
      const freshPendingCount = pendingInterviews.length;
      
      if (freshPendingCount > 0) {
        // Check if it's been more than 30 seconds since last sync attempt
        const now = Date.now();
        if (now - lastSyncTimeRef.current > MIN_SYNC_GAP_MS) {
          console.log(`🔄 Periodic check: ${freshPendingCount} pending interviews - triggering sync`);
          performBackgroundSync('periodic_check').catch(error => {
            console.error('Error triggering sync on periodic check:', error);
          });
        }
      }
    };

    // Check every 30 seconds when online
    const interval = setInterval(checkAndSync, 30000);
    
    // Initial check after 5 seconds
    const initialTimeout = setTimeout(checkAndSync, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialTimeout);
    };
  }, [isOffline, isSyncing]); // Re-run when network state or sync state changes

  // Periodic background sync (every 5 minutes when online)
  useEffect(() => {
    const setupPeriodicSync = async () => {
      const isOnline = await apiService.isOnline();
      if (isOnline) {
        // Clear existing interval if any
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
        }

        // Set up periodic sync
        syncIntervalRef.current = setInterval(() => {
          performBackgroundSync('periodic');
        }, SYNC_INTERVAL_MS);

        console.log(`⏰ Periodic sync enabled (every ${SYNC_INTERVAL_MS / 1000 / 60} minutes)`);
      }
    };

    setupPeriodicSync();

    // Re-setup when network condition changes
    const checkInterval = setInterval(async () => {
      const isOnline = await apiService.isOnline();
      if (isOnline && !syncIntervalRef.current) {
        setupPeriodicSync();
      } else if (!isOnline && syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    }, 10000); // Check every 10 seconds

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      clearInterval(checkInterval);
    };
  }, []);

  // Sync when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('📱 App came to foreground - triggering background sync');
        performBackgroundSync('app_foreground');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const loadPendingInterviewsCount = async () => {
    try {
      const pending = await offlineStorage.getPendingInterviews();
      console.log('📊 Pending interviews count:', pending.length);
      setPendingInterviewsCount(pending.length);
    } catch (error) {
      console.error('Error loading pending interviews count:', error);
    }
  };

  const loadOfflineInterviews = async () => {
    try {
      const allOfflineInterviews = await offlineStorage.getOfflineInterviews();
      console.log('📦 ========== OFFLINE INTERVIEWS DEBUG ==========');
      console.log('📦 Total offline interviews in storage:', allOfflineInterviews.length);
      
      // Populate surveyName for interviews that don't have it (for existing interviews)
      const interviewsWithSurveys = await Promise.all(
        (allOfflineInterviews || []).map(async (interview: any) => {
          // If surveyName is missing, try to fetch it from survey cache
          if (!interview.surveyName && interview.surveyId) {
            try {
              const survey = await offlineStorage.getSurveyById(interview.surveyId);
              if (survey && survey.surveyName) {
                interview.surveyName = survey.surveyName;
                console.log(`✅ Populated surveyName for interview ${interview.id}: ${survey.surveyName}`);
              }
            } catch (error) {
              console.error(`❌ Error fetching survey name for interview ${interview.id}:`, error);
            }
          }
          return interview;
        })
      );
      
      if (interviewsWithSurveys.length > 0) {
        console.log('📦 Offline interviews details:');
        interviewsWithSurveys.forEach((i: any, index: number) => {
          console.log(`  ${index + 1}. ID: ${i.id}`);
          console.log(`     Status: ${i.status}`);
          console.log(`     Survey: ${i.survey?.surveyName || i.surveyId || 'Unknown'}`);
          console.log(`     Saved: ${i.startTime ? new Date(i.startTime).toLocaleString() : 'N/A'}`);
          console.log(`     Completed: ${i.metadata?.isCompleted ? 'Yes' : 'No'}`);
          console.log(`     Sync Attempts: ${i.syncAttempts || 0}`);
          if (i.error) console.log(`     Error: ${i.error}`);
        });
      } else {
        console.log('📦 No offline interviews found in local storage');
      }
      
      // Fix incorrectly marked interviews: if status is 'synced' but has error, change to 'failed'
      const fixedInterviews = interviewsWithSurveys.map((interview: any) => {
        if (interview.status === 'synced' && interview.error) {
          console.log(`⚠️ Fixing incorrectly marked interview: ${interview.id} - has error "${interview.error}" but marked as synced`);
          interview.status = 'failed';
          // Save the fixed status
          offlineStorage.saveOfflineInterview(interview).catch(err => {
            console.error('Error fixing interview status:', err);
          });
        }
        return interview;
      });
      
      // Show ALL offline interviews EXCEPT those that are truly synced (no errors)
      // Include: pending, failed, syncing, and synced ones with errors (they need retry)
      const pendingOfflineInterviews = fixedInterviews.filter(
        (interview: any) => {
          const status = interview.status;
          // Include if status is pending, failed, syncing, undefined/null (legacy), OR synced with error
          const shouldInclude = !status || 
                               status === 'pending' || 
                               status === 'failed' || 
                               status === 'syncing' || 
                               (status === 'synced' && interview.error);
          if (status === 'synced' && interview.error) {
            console.log(`⚠️ Found interview with 'synced' status but has error - will show for retry: ${interview.id}`);
          }
          return shouldInclude;
        }
      );
      
      console.log('📦 Filtered offline interviews (including incorrectly synced):', pendingOfflineInterviews.length);
      console.log('📦 ============================================');
      
      setOfflineInterviews(pendingOfflineInterviews);
      // Also update pending count (include synced ones with errors as they need retry)
      const pendingCount = fixedInterviews.filter(
        (interview: any) => {
          const status = interview.status;
          return !status || 
                 status === 'pending' || 
                 status === 'failed' ||
                 (status === 'synced' && interview.error);
        }
      ).length;
      setPendingInterviewsCount(pendingCount);
      console.log('📊 Pending interviews count:', pendingCount);
    } catch (error) {
      console.error('❌ Error loading offline interviews:', error);
    }
  };

  const handleSyncSurveyDetails = async () => {
    if (isSyncingSurveys) return;
    
    // Check if online
    const isOnline = await apiService.isOnline();
    if (!isOnline) {
      showSnackbar('Please connect to the internet to sync survey details.', 'error');
      return;
    }
    
    setIsSyncingSurveys(true);
    try {
      showSnackbar('Downloading & syncing survey details for offline...', 'info');
      
      // Fetch surveys from API
      const surveysResult = await apiService.getAvailableSurveys();
      
      if (surveysResult.success) {
        const surveys = surveysResult.surveys || [];
        // Save to offline storage with dependent data download
        await offlineStorage.saveSurveys(surveys, true);
        setAvailableSurveys(surveys);
        showSnackbar(`Successfully synced ${surveys.length} survey(s) with offline data`, 'success');
        
        // Check for polling stations update in background (lightweight check only)
        // Don't await - let it run in background without blocking
        import('../services/pollingStationsSyncService').then((module) => {
          const pollingStationsSyncService = module.pollingStationsSyncService;
          pollingStationsSyncService.checkForUpdates().then((checkResult) => {
            if (checkResult.needsUpdate && !checkResult.error) {
              console.log('📥 Polling stations file needs update, downloading in background...');
              // Download in background without blocking UI
              pollingStationsSyncService.downloadLatest().then((downloadResult) => {
                if (downloadResult.success && downloadResult.hash) {
                  console.log('✅ Polling stations file updated in background');
                  // Clear cached data so it reloads with new file on next access
                  import('../services/bundledDataService').then((bundledModule) => {
                    bundledModule.bundledDataService.clearCache();
                  }).catch((clearErr) => {
                    console.error('Error clearing cache:', clearErr);
                  });
                }
              }).catch((err) => {
                console.error('Background polling stations download error:', err);
              });
            }
          }).catch((err) => {
            console.error('Background polling stations check error:', err);
          });
        }).catch((importErr) => {
          console.error('Error importing pollingStationsSyncService:', importErr);
        });
      } else {
        showSnackbar('Failed to sync survey details. Please try again.', 'error');
      }
    } catch (error: any) {
      console.error('Error syncing survey details:', error);
      showSnackbar('Failed to sync survey details. Please try again.', 'error');
    } finally {
      setIsSyncingSurveys(false);
    }
  };

  const handleSyncOfflineInterviews = async () => {
    if (isSyncing) return;
    
    // Check if online
    const isOnline = await apiService.isOnline();
    if (!isOnline) {
      showSnackbar('Please connect to the internet to sync offline interviews.', 'error');
      return;
    }
    
    setIsSyncing(true);
    try {
      showSnackbar('Syncing offline interviews...', 'info');
      const result = await syncService.syncOfflineInterviews();
      
      if (result.success && result.syncedCount > 0) {
        showSnackbar(`Successfully synced ${result.syncedCount} interview(s)`, 'success');
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: result.syncedCount, failed: result.failedCount });
        await loadOfflineInterviews(); // Reload offline interviews to update the list
        await loadPendingInterviewsCount();
        // Don't reload full dashboard data - only update stats if needed (lightweight)
        // Full dashboard reload is expensive and not needed after manual sync
      } else if (result.failedCount > 0) {
        showSnackbar(`Synced ${result.syncedCount}, failed ${result.failedCount}. Check details.`, 'error');
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: result.syncedCount, failed: result.failedCount });
        await loadOfflineInterviews(); // Reload offline interviews to show updated status
        await loadPendingInterviewsCount();
      } else if (result.syncedCount === 0 && result.failedCount === 0) {
        showSnackbar('No pending interviews to sync', 'info');
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: 0, failed: 0 });
        await loadOfflineInterviews(); // Still reload to ensure UI is up to date
      } else {
        showSnackbar('Sync failed. Please check your internet connection.', 'error');
        setLastSyncTime(new Date());
        setLastSyncResult({ synced: 0, failed: 0 });
        await loadOfflineInterviews(); // Reload to show any status changes
      }
    } catch (error: any) {
      console.error('Error syncing offline interviews:', error);
      showSnackbar('Failed to sync interviews. Please try again.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteOfflineInterview = async (interviewId: string) => {
    Alert.alert(
      'Delete Offline Interview',
      'Are you sure you want to delete this offline interview? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              appLoggingService.info('INTERVIEW', 'Deleting offline interview', { interviewId });
              await offlineStorage.deleteSyncedInterview(interviewId);
              console.log('✅ Deleted offline interview:', interviewId);
              showSnackbar('Offline interview deleted', 'success');
              await loadOfflineInterviews();
              await loadPendingInterviewsCount();
            } catch (error) {
              console.error('Error deleting offline interview:', error);
              appLoggingService.error('INTERVIEW', 'Failed to delete interview', { interviewId }, error as Error);
              showSnackbar('Failed to delete interview', 'error');
            }
          },
        },
      ]
    );
  };

  const handleChangeInterviewStatus = async (interviewId: string, currentStatus: string) => {
    Alert.alert(
      'Change Interview Status',
      `Current status: ${currentStatus}\n\nSelect new status:`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reset to Pending',
          onPress: async () => {
            try {
              appLoggingService.info('SYNC', 'Manually resetting interview status to pending', { interviewId, oldStatus: currentStatus });
              await offlineStorage.changeInterviewStatus(interviewId, 'pending');
              showSnackbar('Interview status changed to pending', 'success');
              await loadOfflineInterviews();
              await loadPendingInterviewsCount();
            } catch (error) {
              console.error('Error changing interview status:', error);
              appLoggingService.error('SYNC', 'Failed to change interview status', { interviewId }, error as Error);
              showSnackbar('Failed to change status', 'error');
            }
          },
        },
        {
          text: 'Mark as Failed',
          onPress: async () => {
            try {
              appLoggingService.info('SYNC', 'Manually marking interview as failed', { interviewId, oldStatus: currentStatus });
              await offlineStorage.changeInterviewStatus(interviewId, 'failed', 'Manually marked as failed');
              showSnackbar('Interview marked as failed', 'success');
              await loadOfflineInterviews();
              await loadPendingInterviewsCount();
            } catch (error) {
              console.error('Error changing interview status:', error);
              appLoggingService.error('SYNC', 'Failed to change interview status', { interviewId }, error as Error);
              showSnackbar('Failed to change status', 'error');
            }
          },
        },
      ]
    );
  };

  const handleExportInterview = async (interviewId: string) => {
    try {
      showSnackbar('Exporting interview...', 'info');
      appLoggingService.info('EXPORT', 'Exporting interview for sharing', { interviewId });
      
      const exportData = await offlineStorage.exportInterviewForSharing(interviewId);
      
      // Create export directory in cache (temporary, not stored with offline data)
      // Use cacheDirectory for exports to avoid confusion with offline storage
      const exportDir = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}exports/`;
      const dirInfo = await FileSystem.getInfoAsync(exportDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });
      }

      // Get interview for filename
      const interview = await offlineStorage.getOfflineInterviewById(interviewId);
      const surveyName = interview?.surveyName?.replace(/[^a-z0-9]/gi, '_') || 'interview';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonFileName = `${surveyName}_${timestamp}.json`;

      // Save JSON file
      const jsonFilePath = `${exportDir}${jsonFileName}`;
      await FileSystem.writeAsStringAsync(jsonFilePath, exportData.interviewData);

      let shareMessage = `Interview exported successfully!\n\nFiles:\n- ${jsonFileName}`;
      
      // Copy audio file if exists (for sharing)
      let audioFileName: string | null = null;
      let audioDestPath: string | null = null;
      
      if (exportData.audioExists && exportData.audioPath) {
        try {
          const audioExt = exportData.audioPath.split('.').pop() || 'm4a';
          audioFileName = `${surveyName}_${timestamp}.${audioExt}`;
          audioDestPath = `${exportDir}${audioFileName}`;
          
          console.log('📋 Copying audio for export:', {
            from: exportData.audioPath,
            to: audioDestPath
          });
          
          await FileSystem.copyAsync({
            from: exportData.audioPath,
            to: audioDestPath
          });
          
          // Verify copy succeeded
          const copiedFileInfo = await FileSystem.getInfoAsync(audioDestPath);
          if (copiedFileInfo.exists) {
            shareMessage += `\n- ${audioFileName} (${Math.round((copiedFileInfo.size || 0) / 1024)} KB)`;
            appLoggingService.info('EXPORT', 'Audio file copied for export', { 
              interviewId, 
              audioFileName,
              fileSize: copiedFileInfo.size 
            });
          } else {
            throw new Error('Audio file copy verification failed');
          }
        } catch (audioError) {
          console.error('Error copying audio file:', audioError);
          appLoggingService.error('EXPORT', 'Failed to copy audio file', { interviewId }, audioError as Error);
          shareMessage += `\n⚠️ Audio file could not be copied: ${audioError instanceof Error ? audioError.message : 'Unknown error'}`;
          audioFileName = null;
          audioDestPath = null;
        }
      } else {
        console.log('ℹ️ No audio file to export:', {
          hasAudioPath: !!exportData.audioPath,
          audioExists: exportData.audioExists,
          audioOfflinePath: interview?.audioOfflinePath,
          audioUri: interview?.audioUri
        });
      }

      // Create ZIP file containing both JSON and audio (if available)
      const zipFileName = `${surveyName}_${timestamp}.zip`;
      const zipFilePath = `${exportDir}${zipFileName}`;
      
      try {
        const zip = new JSZip();
        
        // Add JSON file to ZIP
        const jsonContent = await FileSystem.readAsStringAsync(jsonFilePath);
        zip.file(jsonFileName, jsonContent);
        console.log('✅ Added JSON file to ZIP:', jsonFileName);
        
        // Add audio file to ZIP if available
        if (audioDestPath && audioFileName) {
          try {
            const audioFileInfo = await FileSystem.getInfoAsync(audioDestPath);
            if (audioFileInfo.exists) {
              // Read audio file as base64
              const audioBase64 = await FileSystem.readAsStringAsync(audioDestPath, {
                encoding: FileSystem.EncodingType.Base64
              });
              zip.file(audioFileName, audioBase64, { base64: true });
              console.log('✅ Added audio file to ZIP:', audioFileName, `(${Math.round((audioFileInfo.size || 0) / 1024)} KB)`);
            }
          } catch (audioZipError) {
            console.error('Error adding audio to ZIP:', audioZipError);
            appLoggingService.warn('EXPORT', 'Failed to add audio to ZIP', { interviewId, error: audioZipError });
          }
        }
        
        // Generate ZIP file
        console.log('📦 Generating ZIP file...');
        const zipBlob = await zip.generateAsync({ 
          type: 'base64',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });
        
        await FileSystem.writeAsStringAsync(zipFilePath, zipBlob, {
          encoding: FileSystem.EncodingType.Base64
        });
        
        console.log('✅ ZIP file created:', zipFilePath);
        appLoggingService.info('EXPORT', 'ZIP file created successfully', { 
          interviewId, 
          zipFileName,
          containsAudio: !!audioDestPath
        });
        
        // Share ZIP file (contains both JSON and audio)
        const isSharingAvailable = await Sharing.isAvailableAsync();
        if (isSharingAvailable) {
          try {
            await Sharing.shareAsync(zipFilePath, {
              mimeType: 'application/zip',
              dialogTitle: 'Export Interview Data & Audio',
              UTI: 'public.zip-archive'
            });
            
            const successMessage = audioDestPath 
              ? '✅ Interview data and audio exported in ZIP file!' 
              : '✅ Interview data exported in ZIP file!';
            showSnackbar(successMessage, 'success');
          } catch (shareError) {
            console.error('Error sharing ZIP file:', shareError);
            Alert.alert(
              'Export Complete',
              `${shareMessage}\n\nZIP file created: ${zipFileName}\n\nFiles saved to:\n${exportDir}\n\nYou can find the ZIP file in your device's file manager.`,
              [{ text: 'OK' }]
            );
          }
        } else {
          Alert.alert(
            'Export Complete',
            `${shareMessage}\n\nZIP file created: ${zipFileName}\n\nFiles saved to:\n${exportDir}\n\nThe ZIP file contains both JSON and audio files.`,
            [{ text: 'OK' }]
          );
        }
      } catch (zipError) {
        console.error('Error creating ZIP file:', zipError);
        appLoggingService.error('EXPORT', 'Failed to create ZIP file', { interviewId }, zipError as Error);
        
        // Fallback: Share JSON file only
        const isSharingAvailable = await Sharing.isAvailableAsync();
        if (isSharingAvailable) {
          try {
            await Sharing.shareAsync(jsonFilePath);
            showSnackbar('Interview exported (ZIP creation failed, JSON shared)', 'info');
          } catch (shareError) {
            Alert.alert(
              'Export Error',
              `Failed to create ZIP file. JSON file saved to:\n${jsonFilePath}\n\nError: ${zipError instanceof Error ? zipError.message : 'Unknown error'}`,
              [{ text: 'OK' }]
            );
          }
        } else {
          Alert.alert(
            'Export Error',
            `Failed to create ZIP file. JSON file saved to:\n${jsonFilePath}\n\nError: ${zipError instanceof Error ? zipError.message : 'Unknown error'}`,
            [{ text: 'OK' }]
          );
        }
      }
      
      appLoggingService.info('EXPORT', 'Interview exported successfully', { interviewId, jsonFileName });
    } catch (error) {
      console.error('Error exporting interview:', error);
      appLoggingService.error('EXPORT', 'Failed to export interview', { interviewId }, error as Error);
      showSnackbar('Failed to export interview', 'error');
    }
  };

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // Check if offline
      const isOnline = await apiService.isOnline();
      setIsOffline(!isOnline);
      
      if (!isOnline) {
        // Offline mode - load from local storage
        console.log('📴 Offline mode - loading from local storage');
        const offlineSurveys = await offlineStorage.getSurveys();
        setAvailableSurveys(offlineSurveys || []);
        
        // Load offline interviews - show pending, failed, and syncing ones (not synced)
        const allOfflineInterviews = await offlineStorage.getOfflineInterviews();
        console.log('📴 Offline mode - All offline interviews:', allOfflineInterviews.length);
        const pendingOfflineInterviews = (allOfflineInterviews || []).filter(
          (interview: any) => interview.status === 'pending' || interview.status === 'failed' || interview.status === 'syncing'
        );
        console.log('📴 Offline mode - Filtered interviews:', pendingOfflineInterviews.length);
        setOfflineInterviews(pendingOfflineInterviews);
        // Update pending count
        const pendingCount = (allOfflineInterviews || []).filter(
          (interview: any) => interview.status === 'pending' || interview.status === 'failed'
        ).length;
        setPendingInterviewsCount(pendingCount);
        
        // Don't try to load stats or interviews in offline mode
        setMyInterviews([]);
        setInterviewStats({ totalCompleted: 0, approved: 0, rejected: 0, pendingApproval: 0 });
        return;
      }
      
      // Online mode - load from offline storage first
      const offlineSurveys = await offlineStorage.getSurveys();
      
      // First time login: If no surveys in offline storage, automatically sync
      if (offlineSurveys.length === 0) {
        console.log('🔄 First time login - no surveys cached, auto-syncing...');
        setAvailableSurveys([]);
        // Automatically sync survey details on first login (don't await - let it run in background)
        // The button will show loading state, and surveys will appear when sync completes
        handleSyncSurveyDetails().catch((error) => {
          console.error('Error auto-syncing surveys on first login:', error);
        });
      } else {
        // Not first time - just load from cache
        setAvailableSurveys(offlineSurveys || []);
      }

      // Fetch interviewer stats from lightweight endpoint (much faster than fetching all interviews)
      const statsResult = await apiService.getInterviewerStats();
      console.log('📊 getInterviewerStats API response:', {
        success: statsResult.success,
        stats: statsResult.stats
      });

      if (statsResult.success && statsResult.stats) {
        setInterviewStats({
          totalCompleted: statsResult.stats.totalCompleted || 0,
          approved: statsResult.stats.approved || 0,
          rejected: statsResult.stats.rejected || 0,
          pendingApproval: statsResult.stats.pendingApproval || 0
        });
      } else {
        // Fallback: set default stats if API fails
        console.log('⚠️ Failed to fetch stats from API, using defaults');
        setInterviewStats({ totalCompleted: 0, approved: 0, rejected: 0, pendingApproval: 0 });
      }

      // Don't fetch all interviews for dashboard - we only need stats
      // If needed for "Recent Interviews" section, fetch only first page with limit
      // For now, keep myInterviews empty since that section is commented out
      setMyInterviews([]);
      
      // Always load offline interviews - show pending, failed, syncing, AND incorrectly marked synced ones
      const allOfflineInterviews = await offlineStorage.getOfflineInterviews();
      console.log('🌐 Online mode - All offline interviews:', allOfflineInterviews.length);
      
      // Fix incorrectly marked interviews: if status is 'synced' but has error, change to 'failed'
      const fixedInterviews = (allOfflineInterviews || []).map((interview: any) => {
        if (interview.status === 'synced' && interview.error) {
          console.log(`⚠️ Fixing incorrectly marked interview: ${interview.id} - has error "${interview.error}" but marked as synced`);
          interview.status = 'failed';
          // Save the fixed status
          offlineStorage.saveOfflineInterview(interview).catch(err => {
            console.error('Error fixing interview status:', err);
          });
        }
        return interview;
      });
      
      // Show all interviews except those that are truly synced (no errors)
      const pendingOfflineInterviews = fixedInterviews.filter(
        (interview: any) => {
          // Include if status is pending, failed, syncing, or synced with error
          return interview.status === 'pending' || 
                 interview.status === 'failed' || 
                 interview.status === 'syncing' ||
                 (interview.status === 'synced' && interview.error); // Include synced ones with errors
        }
      );
      console.log('🌐 Online mode - Filtered interviews:', pendingOfflineInterviews.length);
      setOfflineInterviews(pendingOfflineInterviews);
      // Update pending count (include synced ones with errors as they need retry)
      const pendingCount = fixedInterviews.filter(
        (interview: any) => {
          return interview.status === 'pending' || 
                 interview.status === 'failed' ||
                 (interview.status === 'synced' && interview.error);
        }
      ).length;
      setPendingInterviewsCount(pendingCount);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      // Try to load from offline storage as fallback
      try {
        const offlineSurveys = await offlineStorage.getSurveys();
        setAvailableSurveys(offlineSurveys || []);
        const allOfflineInterviews = await offlineStorage.getOfflineInterviews();
        console.log('⚠️ Fallback - All offline interviews:', allOfflineInterviews.length);
        const pendingOfflineInterviews = (allOfflineInterviews || []).filter(
          (interview: any) => interview.status === 'pending' || interview.status === 'failed' || interview.status === 'syncing'
        );
        console.log('⚠️ Fallback - Filtered interviews:', pendingOfflineInterviews.length);
        setOfflineInterviews(pendingOfflineInterviews);
        // Update pending count
        const pendingCount = (allOfflineInterviews || []).filter(
          (interview: any) => interview.status === 'pending' || interview.status === 'failed'
        ).length;
        setPendingInterviewsCount(pendingCount);
        setIsOffline(true);
      } catch (fallbackError) {
        console.error('Error loading from offline storage:', fallbackError);
      showSnackbar('Failed to load dashboard data');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDashboardData();
    setIsRefreshing(false);
  };

  const showSnackbar = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setSnackbarMessage(message);
    setSnackbarType(type);
    setSnackbarVisible(true);
  };

  const handleLogout = async () => {
    try {
      await apiService.logout();
      onLogout();
    } catch (error) {
      console.error('Logout error:', error);
      onLogout(); // Still logout locally
    }
  };


  const getStatusColor = (status: string) => {
    if (!status) return '#6b7280';
    switch (status.toLowerCase()) {
      case 'active':
      case 'approved': return '#3FADCC';
      case 'completed': return '#001D48';
      case 'in_progress': return '#f59e0b';
      case 'pending_approval': return '#f59e0b';
      case 'rejected': return '#dc2626';
      case 'abandoned': return '#6b7280';
      case 'submitted': return '#001D48';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    if (!status) return 'Unknown';
    switch (status.toLowerCase()) {
      case 'active': return 'Active';
      case 'completed': return 'Completed';
      case 'in_progress': return 'In Progress';
      case 'pending_approval': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'abandoned': return 'Abandoned';
      case 'submitted': return 'Submitted';
      default: return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const formatDate = (dateString: string | Date | undefined) => {
    if (!dateString) return 'N/A';
    try {
      const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
      if (isNaN(date.getTime())) {
        return 'N/A';
      }
      return date.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'N/A';
    }
  };

  const formatTimeAgo = (date: Date | null) => {
    if (!date) return '';
    try {
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting time ago:', error);
      return '';
    }
  };

  const handleStartInterview = async (survey: Survey) => {
    // Check if this is a CATI interview (multi_mode with cati assignment or direct cati mode)
    const isCatiMode = survey.mode === 'cati' || (survey.mode === 'multi_mode' && survey.assignedMode === 'cati');
    
    if (isCatiMode) {
      // Check if offline - CATI interviews require internet connection
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        Alert.alert(
          'CATI Not Available in Offline Mode',
          'CATI (Computer-Assisted Telephonic Interviewing) interviews require an active internet connection. Please connect to the internet and try again.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // CATI interview - navigate directly
      Alert.alert(
        'Start CATI Interview',
        `You are about to start a CATI (Computer-Assisted Telephonic Interviewing) interview for "${survey.surveyName}". A call will be made to the respondent.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Start',
            onPress: () => {
              navigation.navigate('InterviewInterface', { survey, isCatiMode: true });
            },
          },
        ]
      );
    } else {
      // CAPI or other mode
      Alert.alert(
        'Start Interview',
        `Are you sure you want to start the interview for "${survey.surveyName}"?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Start',
            onPress: () => {
              navigation.navigate('InterviewInterface', { survey, isCatiMode: false });
            },
          },
        ]
      );
    }
  };

  if (isLoading) {
    const loadingTexts = [
      'Loading your dashboard...',
      'Fetching survey data...',
      'Preparing statistics...',
      'Almost ready...',
    ];

    const rotateInterpolate = rotationAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    const pulseScale = pulseAnimation;

    const loadingBarWidth = loadingAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <View style={styles.loadingContent}>
          {/* Animated Logo/Icon */}
          <Animated.View
            style={[
              styles.loadingLogoContainer,
              {
                transform: [
                  { scale: pulseScale },
                ],
              },
            ]}
          >
            <View style={styles.loadingLogoCircle}>
              <Animated.View
                style={[
                  styles.loadingLogoInner,
                  {
                    transform: [{ rotate: rotateInterpolate }],
                  },
                ]}
              >
                <Image
                  source={require('../../assets/icon.png')}
                  style={styles.loadingLogoIcon}
                  resizeMode="cover"
                />
              </Animated.View>
      </View>
          </Animated.View>

          {/* Loading Text */}
          <Text style={styles.loadingTitleText}>
            {loadingTexts[loadingTextIndex]}
          </Text>

          {/* Animated Dots */}
          <View style={styles.loadingDotsContainer}>
            {[0, 1, 2].map((index) => {
              const dotOpacity = pulseAnimation.interpolate({
                inputRange: [1, 1.2],
                outputRange: [0.3, 0.9],
              });

              return (
                <Animated.View
                  key={index}
                  style={[
                    styles.loadingDot,
                    {
                      opacity: dotOpacity,
                      transform: [
                        {
                          scale: pulseAnimation.interpolate({
                            inputRange: [1, 1.2],
                            outputRange: [1, 1.2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Subtle Progress Indicator */}
          <View style={styles.loadingProgressContainer}>
            <View style={styles.loadingProgressTrack}>
              <Animated.View
                style={[
                  styles.loadingProgressBar,
                  {
                    width: loadingBarWidth,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      {/* Debug Controls - Force Offline Mode & Network Condition - COMMENTED OUT (can be re-enabled when needed) */}
      {/* <View style={styles.debugControlsContainer}>
        <TouchableOpacity
          style={[styles.debugControlButton, forceOfflineMode && styles.debugControlButtonActive]}
          onPress={toggleForceOfflineMode}
        >
          <Ionicons 
            name={forceOfflineMode ? "cloud-offline" : "cloud"} 
            size={18} 
            color={forceOfflineMode ? "#fff" : "#666"} 
          />
          <Text style={[styles.debugControlText, forceOfflineMode && styles.debugControlTextActive]}>
            {forceOfflineMode ? "🔴 Offline" : "🟢 Online"}
          </Text>
        </TouchableOpacity>

        <Menu
          visible={networkMenuVisible}
          onDismiss={() => setNetworkMenuVisible(false)}
          anchor={
            <TouchableOpacity
              style={[styles.debugControlButton, networkCondition !== 'good_stable' && styles.debugControlButtonActive]}
              onPress={() => setNetworkMenuVisible(true)}
            >
              <Ionicons 
                name="speedometer" 
                size={18} 
                color={networkCondition !== 'good_stable' ? "#fff" : "#666"} 
              />
              <Text style={[styles.debugControlText, networkCondition !== 'good_stable' && styles.debugControlTextActive]}>
                🌐 {getNetworkConditionName(networkCondition)}
              </Text>
              <Ionicons 
                name="chevron-down" 
                size={16} 
                color={networkCondition !== 'good_stable' ? "#fff" : "#666"} 
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          }
        >
          <Menu.Item 
            onPress={() => changeNetworkCondition('good_stable')} 
            title="Good Stable Internet"
            titleStyle={networkCondition === 'good_stable' ? { fontWeight: 'bold' } : {}}
          />
          <Menu.Item 
            onPress={() => changeNetworkCondition('below_average')} 
            title="Below Average Internet"
            titleStyle={networkCondition === 'below_average' ? { fontWeight: 'bold' } : {}}
          />
          <Menu.Item 
            onPress={() => changeNetworkCondition('slow_unstable')} 
            title="Slow & Unstable Internet"
            titleStyle={networkCondition === 'slow_unstable' ? { fontWeight: 'bold' } : {}}
          />
          <Menu.Item 
            onPress={() => changeNetworkCondition('very_slow')} 
            title="Very Slow Internet"
            titleStyle={networkCondition === 'very_slow' ? { fontWeight: 'bold' } : {}}
          />
        </Menu>
      </View> */}
      <LinearGradient
        colors={['#001D48', '#373177', '#3FADCC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <View style={styles.userInfo}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.avatarLogo}
              resizeMode="cover"
            />
            <View style={styles.userDetails}>
              <Text style={styles.userName}>{user.firstName} {user.lastName}</Text>
              <Text style={styles.userRole}>Interviewer</Text>
            </View>
          </View>
          <Button
            mode="outlined"
            onPress={handleLogout}
            style={[styles.logoutButton, isOffline && styles.disabledButton]}
            textColor="#ffffff"
            disabled={isOffline}
            compact
          >
            Logout
          </Button>
        </View>
        {/* Sync Survey Details Button */}
        <View style={styles.syncSurveyContainer}>
          <Button
            mode="contained"
            onPress={handleSyncSurveyDetails}
            loading={isSyncingSurveys}
            disabled={isOffline}
            style={[
              styles.syncSurveyButton, 
              isOffline && styles.disabledButton,
              isSyncingSurveys && styles.syncingButton
            ]}
            icon="sync"
            buttonColor={isOffline ? "#cccccc" : (isSyncingSurveys ? "#001D48" : "#ffffff")}
            textColor={isSyncingSurveys ? "#ffffff" : (isOffline ? "#666666" : "#001D48")}
            contentStyle={isSyncingSurveys ? styles.syncingButtonContent : undefined}
            labelStyle={isSyncingSurveys ? styles.syncingButtonLabel : undefined}
            loadingIndicatorColor="#ffffff"
            theme={{
              colors: {
                primary: isSyncingSurveys ? '#001D48' : '#ffffff',
              }
            }}
          >
            {isSyncingSurveys ? 'Downloading & Syncing Data...' : 'Sync Survey Details'}
          </Button>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#001D48']}
            tintColor="#001D48"
          />
        }
      >
        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.totalCompleted}</Text>
              <Text style={styles.statLabel}>Total Completed</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.approved}</Text>
              <Text style={styles.statLabel}>Approved</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.rejected}</Text>
              <Text style={styles.statLabel}>Rejected</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.pendingApproval}</Text>
              <Text style={styles.statLabel}>Under QC</Text>
            </Card.Content>
          </Card>
        </View>

        {/* Available Surveys */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Surveys</Text>
            <Button
              mode="text"
              onPress={() => navigation.navigate('AvailableSurveys')}
              textColor="#001D48"
              compact
            >
              View All
            </Button>
          </View>
          
          {availableSurveys.length > 0 ? (
            availableSurveys.slice(0, 3).map((survey) => (
              <Card key={survey._id} style={styles.surveyCard}>
                <Card.Content>
                  <View style={styles.surveyHeader}>
                    <Text style={styles.surveyTitle}>{survey.surveyName}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(survey.status) }]}>
                      <Text style={styles.statusText}>{getStatusText(survey.status)}</Text>
                    </View>
                  </View>

                  {/* See More / See Less Button */}
                  <View style={styles.expandButtonContainer}>
                    <Button
                      mode="text"
                      onPress={() => {
                        const newExpanded = new Set(expandedSurveys);
                        if (newExpanded.has(survey._id)) {
                          newExpanded.delete(survey._id);
                        } else {
                          newExpanded.add(survey._id);
                        }
                        setExpandedSurveys(newExpanded);
                      }}
                      style={styles.expandButton}
                      icon={expandedSurveys.has(survey._id) ? 'chevron-up' : 'chevron-down'}
                      compact
                    >
                      {expandedSurveys.has(survey._id) ? 'See Less' : 'See More'}
                    </Button>
                  </View>

                  {/* Show additional details only if expanded */}
                  {expandedSurveys.has(survey._id) && (
                    <>
                  <Text style={styles.surveyDescription} numberOfLines={2}>
                    {survey.description}
                  </Text>
                  <View style={styles.surveyMeta}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Mode</Text>
                      <Text style={styles.metaValue}>{survey.mode.toUpperCase()}</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Duration</Text>
                      <Text style={styles.metaValue}>{survey.estimatedDuration || 0} min</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Questions</Text>
                      <Text style={styles.metaValue}>
                        {survey.sections?.reduce((total, section) => 
                          total + (section.questions?.length || 0), 0) || 0}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Target</Text>
                      <Text style={styles.metaValue}>{survey.sampleSize?.toLocaleString() || 0}</Text>
                    </View>
                  </View>

                  {/* Assigned ACs */}
                  {survey.assignedACs && survey.assignedACs.length > 0 && (
                    <View style={styles.assignedACsContainer}>
                      <View style={styles.assignedACsHeader}>
                        <Ionicons name="location" size={14} color="#6b7280" />
                        <Text style={styles.assignedACsLabel}>Areas:</Text>
                      </View>
                      <View style={styles.assignedACsChips}>
                        {survey.assignedACs.slice(0, 3).map((ac, index) => (
                          <View key={index} style={styles.acChip}>
                            <Text style={styles.acChipText}>{ac}</Text>
                          </View>
                        ))}
                        {survey.assignedACs.length > 3 && (
                          <View style={styles.acChip}>
                            <Text style={styles.acChipText}>+{survey.assignedACs.length - 3} more</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Quick targeting info */}
                  {survey.targetAudience && (
                    <View style={styles.quickTargeting}>
                      {survey.targetAudience.demographics?.ageRange && (
                        <Text style={styles.quickTargetingText}>
                          Age: {survey.targetAudience.demographics.ageRange.min || 'N/A'}-{survey.targetAudience.demographics.ageRange.max || 'N/A'}
                        </Text>
                      )}
                      {survey.targetAudience.demographics?.genderRequirements && (
                        <Text style={styles.quickTargetingText}>
                          Gender: {(() => {
                            const requirements = survey.targetAudience.demographics.genderRequirements;
                            const selectedGenders = Object.keys(requirements).filter(g => requirements[g] && !g.includes('Percentage'));
                            return selectedGenders.map(gender => {
                              const percentage = requirements[`${gender}Percentage`];
                              const displayPercentage = selectedGenders.length === 1 && !percentage ? 100 : (percentage || 0);
                              return `${gender}: ${displayPercentage}%`;
                            }).join(', ');
                          })()}
                        </Text>
                      )}
                      {survey.targetAudience.geographic?.stateRequirements && (
                        <Text style={styles.quickTargetingText}>
                          State: {survey.targetAudience.geographic.stateRequirements}
                        </Text>
                      )}
                    </View>
                  )}
                    </>
                  )}

                  {/* Start Interview Button */}
                  <View style={styles.startButtonContainer}>
                    <Button
                      mode="contained"
                      onPress={() => handleStartInterview(survey)}
                      style={styles.startInterviewButton}
                      compact
                    >
                      {survey.mode === 'multi_mode' && survey.assignedMode === 'cati' 
                        ? 'Start CATI Interview'
                        : survey.mode === 'multi_mode' && survey.assignedMode === 'capi' 
                        ? 'Start CAPI Interview' 
                        : survey.mode === 'cati'
                        ? 'Start CATI Interview'
                        : 'Start CAPI Interview'
                      }
                    </Button>
                  </View>
                </Card.Content>
              </Card>
            ))
          ) : (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <Text style={styles.emptyText}>No available surveys</Text>
                <Text style={styles.emptySubtext}>Check back later for new surveys</Text>
              </Card.Content>
            </Card>
          )}
        </View>

        {/* Recent Interviews - Only show in online mode */}
        {/* Temporarily commented out - not showing Recent Interviews section */}
        {/* {!isOffline && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Interviews</Text>
            <Button
              mode="text"
              onPress={() => navigation.navigate('MyInterviews')}
              textColor="#001D48"
              compact
            >
              View All
            </Button>
          </View>
          
          {myInterviews.length > 0 ? (
            myInterviews.slice(0, 3).map((interview) => (
              <Card key={interview._id} style={styles.interviewCard}>
                <Card.Content>
                  <View style={styles.interviewHeader}>
                    <Text style={styles.interviewTitle}>{interview.survey?.surveyName || 'Unknown Survey'}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(interview.status) }]}>
                      <Text style={styles.statusText}>{getStatusText(interview.status)}</Text>
                    </View>
                  </View>
                  <View style={styles.interviewMeta}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Started</Text>
                      <Text style={styles.metaValue}>
                        {formatDate(interview.startTime || interview.startedAt || interview.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Duration</Text>
                      <Text style={styles.metaValue}>
                        {interview.totalTimeSpent ? `${Math.floor(interview.totalTimeSpent / 60)} min` : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Progress</Text>
                      <Text style={styles.metaValue}>
                        {interview.completionPercentage ? `${interview.completionPercentage}%` : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Status</Text>
                      <Text style={styles.metaValue}>
                        {interview.status ? interview.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A'}
                      </Text>
                    </View>
                  </View>
                  {(interview.endTime || interview.completedAt) && (
                    <Text style={styles.interviewDate}>
                      Completed: {formatDate(interview.endTime || interview.completedAt)}
                    </Text>
                  )}
                </Card.Content>
              </Card>
            ))
          ) : (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <Text style={styles.emptyText}>No interviews yet</Text>
                <Text style={styles.emptySubtext}>Start your first interview from available surveys</Text>
              </Card.Content>
            </Card>
          )}
        </View>
        )} */}
        
        {/* Offline Interviews Section - Always show this section if there are offline interviews */}
        {/* This section allows users to sync their offline saved interviews to the server */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Text style={styles.sectionTitle}>Offline Saved Interviews</Text>
              {offlineInterviews.length > 0 && (
                <View style={styles.offlineBadgeContainer}>
                  <Text style={styles.offlineBadge}>📴 {offlineInterviews.length} {offlineInterviews.length === 1 ? 'Interview' : 'Interviews'}</Text>
                </View>
              )}
            </View>
          </View>
          {/* Sync Offline Interviews Button - Positioned above the section */}
          {(pendingInterviewsCount > 0 || offlineInterviews.length > 0) && (
            <View style={styles.syncButtonContainer}>
              <Button
                mode="contained"
                onPress={handleSyncOfflineInterviews}
                loading={isSyncing}
                disabled={isSyncing || isOffline || offlineInterviews.length === 0}
                style={[styles.syncButton, (isOffline || offlineInterviews.length === 0) && styles.disabledButton]}
                icon="sync"
                buttonColor={(isOffline || offlineInterviews.length === 0) ? "#cccccc" : "#059669"}
                textColor={(isOffline || offlineInterviews.length === 0) ? "#666666" : "#ffffff"}
              >
                {isSyncing ? 'Syncing...' : `Sync Offline Interviews${pendingInterviewsCount > 0 ? ` (${pendingInterviewsCount})` : ''}`}
              </Button>
              
              {/* Sync Status Indicator */}
              <View style={styles.syncStatusContainer}>
                {isSyncing ? (
                  <View style={styles.syncStatusRow}>
                    <ActivityIndicator size="small" color="#f59e0b" />
                    <Text style={styles.syncStatusText}>Syncing in background...</Text>
                  </View>
                ) : lastSyncTime ? (
                  <View style={styles.syncStatusRow}>
                    <Ionicons 
                      name={lastSyncResult && lastSyncResult.failed > 0 ? "warning" : lastSyncResult && lastSyncResult.synced > 0 ? "checkmark-circle" : "information-circle"} 
                      size={14} 
                      color={lastSyncResult && lastSyncResult.failed > 0 ? "#dc2626" : lastSyncResult && lastSyncResult.synced > 0 ? "#059669" : "#6b7280"} 
                    />
                    <Text style={styles.syncStatusText}>
                      {lastSyncResult && lastSyncResult.synced > 0 
                        ? `Last sync: ${lastSyncResult.synced} synced${lastSyncResult.failed > 0 ? `, ${lastSyncResult.failed} failed` : ''}`
                        : lastSyncResult && lastSyncResult.failed > 0
                        ? `Last sync: ${lastSyncResult.failed} failed`
                        : 'Auto-sync active'}
                      {' • '}
                      {formatTimeAgo(lastSyncTime)}
                    </Text>
                  </View>
                ) : pendingInterviewsCount > 0 ? (
                  <View style={styles.syncStatusRow}>
                    <Ionicons name={isOffline ? "time-outline" : "sync-outline"} size={14} color={isOffline ? "#6b7280" : "#10b981"} />
                    <Text style={styles.syncStatusText}>
                      {isOffline 
                        ? `Auto-sync will run when online (${pendingInterviewsCount} pending)`
                        : `Auto-sync active (${pendingInterviewsCount} pending)`}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
          
          {offlineInterviews.length > 0 ? (
            <>
            {offlineInterviews.slice(0, 5).map((interview) => (
              <Card key={interview.id} style={styles.interviewCard}>
                <Card.Content>
                  <View style={styles.interviewHeader}>
                    <View style={styles.interviewTitleContainer}>
                      <Text style={styles.interviewTitle} numberOfLines={2}>
                        {interview.surveyName || interview.survey?.surveyName || 'Unknown Survey'}
                      </Text>
                      {/* Interview ID and Session ID - for identification */}
                      <View style={styles.interviewIdContainer}>
                        <Text style={styles.interviewIdText}>
                          <Text style={styles.interviewIdLabel}>Interview ID: </Text>
                          {interview.id || 'N/A'}
                        </Text>
                        {interview.sessionId && (
                          <Text style={styles.interviewIdText}>
                            <Text style={styles.interviewIdLabel}>Session ID: </Text>
                            {interview.sessionId}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                  {/* Status badge - moved to separate row below title to prevent overflow */}
                  <View style={styles.statusBadgeContainer}>
                    <View style={[styles.statusBadge, { 
                      backgroundColor: interview.status === 'synced' ? '#059669' : 
                                       interview.status === 'syncing' ? '#f59e0b' : 
                                       interview.status === 'failed' ? '#dc2626' : '#6b7280'
                    }]}>
                      <Text style={styles.statusText}>
                        {interview.status === 'synced' ? 'Synced' : 
                         interview.status === 'syncing' ? 'Syncing' : 
                         interview.status === 'failed' ? 'Failed' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                  {/* Action buttons row */}
                  <View style={styles.actionButtonsContainer}>
                    {/* Change Status Button */}
                    {(interview.status === 'failed' || interview.status === 'syncing') && (
                      <TouchableOpacity
                        onPress={() => handleChangeInterviewStatus(interview.id, interview.status || 'unknown')}
                        style={styles.actionButton}
                      >
                        <Ionicons name="refresh-outline" size={16} color="#059669" />
                        <Text style={styles.actionButtonText}>Reset Status</Text>
                      </TouchableOpacity>
                    )}
                    
                    {/* Export Button */}
                    <TouchableOpacity
                      onPress={() => handleExportInterview(interview.id)}
                      style={styles.actionButton}
                    >
                      <Ionicons name="download-outline" size={16} color="#2563eb" />
                      <Text style={styles.actionButtonText}>Export</Text>
                    </TouchableOpacity>
                    
                    {/* Delete Button */}
                    {(interview.status === 'failed' || interview.status === 'synced') && (
                      <TouchableOpacity
                        onPress={() => handleDeleteOfflineInterview(interview.id)}
                        style={styles.actionButton}
                      >
                        <Ionicons name="trash-outline" size={16} color="#dc2626" />
                        <Text style={[styles.actionButtonText, { color: '#dc2626' }]}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.interviewMeta}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Saved</Text>
                      <Text style={styles.metaValue}>
                        {formatDate(interview.startTime)}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Duration</Text>
                      <Text style={styles.metaValue}>
                        {interview.duration ? `${Math.floor(interview.duration / 60)} min` : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Type</Text>
                      <Text style={styles.metaValue}>
                        {interview.isCatiMode ? 'CATI' : 'CAPI'}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Status</Text>
                      <Text style={styles.metaValue}>
                        {interview.isCompleted ? 'Completed' : 'Abandoned'}
                      </Text>
                    </View>
                  </View>
                  {interview.status === 'failed' && interview.error && (
                    <Text style={styles.errorText}>Error: {interview.error}</Text>
                  )}
                  {interview.lastSyncAttempt && (
                    <Text style={styles.interviewDate}>
                      Last sync: {formatDate(interview.lastSyncAttempt)}
                    </Text>
                  )}
                </Card.Content>
              </Card>
            ))}
            {offlineInterviews.length > 5 && (
              <Text style={styles.moreText}>+ {offlineInterviews.length - 5} more offline interviews</Text>
            )}
            </>
          ) : (
            // Show empty state if there are no offline interviews
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <Text style={styles.emptyText}>No Offline Interviews</Text>
                <Text style={styles.emptySubtext}>Interviews conducted offline will appear here for syncing to the server</Text>
              </Card.Content>
            </Card>
          )}
        </View>
        
        {/* Show message when offline and no interviews available */}
        {isOffline && myInterviews.length === 0 && offlineInterviews.length === 0 && (
          <View style={styles.section}>
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <Text style={styles.emptyText}>📴 Offline Mode</Text>
                <Text style={styles.emptySubtext}>Response history not available offline. Connect to internet to view your interviews.</Text>
              </Card.Content>
            </Card>
          </View>
        )}
      </ScrollView>

      <FAB
        icon="plus"
        style={[styles.fab, { bottom: Math.max(16, insets.bottom) + 16 }]} // Positioned at bottom with safe area margin
        onPress={() => navigation.navigate('AvailableSurveys')}
        label="Start Interview"
        iconColor="#ffffff"
        color="#ffffff"
        labelStyle={styles.fabLabel}
        theme={{ colors: { onSurface: '#ffffff', onPrimary: '#ffffff' } }}
      />

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        style={[
          styles.snackbar,
          snackbarType === 'success' && styles.snackbarSuccess,
          snackbarType === 'error' && styles.snackbarError,
          snackbarType === 'info' && styles.snackbarInfo,
        ]}
      >
        {snackbarMessage}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Debug Controls styles - Force Offline Mode & Network Condition - COMMENTED OUT (can be re-enabled when needed)
  // debugControlsContainer: {
  //   flexDirection: 'row',
  //   paddingHorizontal: 16,
  //   paddingTop: 8,
  //   paddingBottom: 4,
  //   backgroundColor: '#f5f5f5',
  //   borderBottomWidth: 1,
  //   borderBottomColor: '#e0e0e0',
  //   gap: 8,
  // },
  // debugControlButton: {
  //   flex: 1,
  //   flexDirection: 'row',
  //   alignItems: 'center',
  //   justifyContent: 'center',
  //   paddingVertical: 8,
  //   paddingHorizontal: 12,
  //   backgroundColor: '#fff',
  //   borderRadius: 8,
  //   borderWidth: 1,
  //   borderColor: '#ddd',
  // },
  // debugControlButtonActive: {
  //   backgroundColor: '#dc2626',
  //   borderColor: '#b91c1c',
  // },
  // debugControlText: {
  //   marginLeft: 6,
  //   fontSize: 13,
  //   fontWeight: '600',
  //   color: '#666',
  // },
  // debugControlTextActive: {
  //   color: '#fff',
  // },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 400,
    flex: 1,
  },
  loadingLogoContainer: {
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f4f8',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  loadingLogoInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  loadingLogoIcon: {
    width: '100%',
    height: '100%',
  },
  loadingTitleText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  loadingDotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 8,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#001D48',
  },
  loadingProgressContainer: {
    width: '100%',
    maxWidth: 200,
    alignItems: 'center',
  },
  loadingProgressTrack: {
    width: '100%',
    height: 2,
    backgroundColor: '#e5e7eb',
    borderRadius: 1,
    overflow: 'hidden',
  },
  loadingProgressBar: {
    height: '100%',
    backgroundColor: '#001D48',
    borderRadius: 1,
  },
  header: {
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarLogo: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
  },
  userDetails: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 2,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 2,
  },
  userRole: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  logoutButton: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  statCard: {
    width: '48%',
    marginBottom: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    borderRadius: 12,
  },
  statContent: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#001D48',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginRight: 12,
  },
  offlineBadgeContainer: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  surveyCard: {
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderRadius: 12,
  },
  surveyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  surveyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
    marginRight: 12,
  },
  surveyDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  surveyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  metaItem: {
    alignItems: 'center',
    flex: 1,
  },
  metaLabel: {
    fontSize: 10,
    color: '#9ca3af',
    marginBottom: 4,
    textAlign: 'center',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1f2937',
    textAlign: 'center',
  },
  interviewMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 8,
  },
  interviewCard: {
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderRadius: 12,
    overflow: 'hidden', // Prevent content from overflowing card boundaries
  },
  interviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 0, // Remove bottom margin since status badge is separate now
  },
  interviewHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButton: {
    padding: 4,
    marginLeft: 4,
  },
  interviewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  interviewTitleContainer: {
    flex: 1,
    marginRight: 0,
  },
  interviewIdContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  interviewIdText: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  interviewIdLabel: {
    fontWeight: '600',
    color: '#374151',
  },
  statusBadgeContainer: {
    marginTop: 8,
    marginBottom: 8,
    width: '100%', // Take full width of container
    flexDirection: 'row', // Ensure proper layout
    flexWrap: 'wrap', // Allow wrapping if needed
  },
  interviewDate: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start', // Align to left, prevent overflow
    maxWidth: '100%', // Ensure it doesn't exceed container width
    overflow: 'hidden', // Prevent badge content from overflowing
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase',
    flexShrink: 1, // Allow text to shrink if needed
  },
  emptyCard: {
    elevation: 1,
  },
  emptyContent: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    // bottom will be set dynamically based on safe area insets
    backgroundColor: '#001D48',
  },
  fabLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  snackbar: {
    // Default background color
  },
  snackbarSuccess: {
    backgroundColor: '#059669', // Green for success
  },
  snackbarError: {
    backgroundColor: '#dc2626', // Red for error
  },
  snackbarInfo: {
    backgroundColor: '#3b82f6', // Blue for info
  },
  syncSurveyContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  syncSurveyButton: {
    borderRadius: 8,
    elevation: 2,
  },
  syncingButton: {
    backgroundColor: '#001D48',
    opacity: 1,
  },
  syncingButtonContent: {
    backgroundColor: '#001D48',
  },
  syncingButtonLabel: {
    color: '#ffffff',
  },
  // Assigned ACs styles for dashboard
  assignedACsContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  assignedACsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  assignedACsLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4,
    fontWeight: '500',
  },
  assignedACsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  acChip: {
    backgroundColor: '#E0F4F8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3FADCC',
  },
  acChipText: {
    fontSize: 10,
    color: '#001D48',
    fontWeight: '500',
  },
  // Quick targeting styles
  quickTargeting: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  quickTargetingText: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 2,
  },
  startButtonContainer: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  startInterviewButton: {
    backgroundColor: '#001D48',
    borderRadius: 8,
  },
  expandButtonContainer: {
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  expandButton: {
    minWidth: 120,
  },
  syncButtonContainer: {
    marginTop: 8,
    marginBottom: 16,
    paddingHorizontal: 0,
  },
  syncButton: {
    backgroundColor: '#059669',
  },
  disabledButton: {
    opacity: 0.5,
  },
  syncStatusContainer: {
    marginTop: 8,
    marginBottom: 4,
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  syncStatusText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  offlineBadge: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 8,
  },
  moreText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexWrap: 'wrap',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    minWidth: 100,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
});
