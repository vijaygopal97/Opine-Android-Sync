import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Text,
  Card,
  Button,
  Avatar,
  FAB,
  Snackbar,
  ActivityIndicator,
} from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiService } from '../services/api';
import { User, Survey } from '../types';
import { offlineStorage } from '../services/offlineStorage';
import { syncService } from '../services/syncService';

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
  const [isSyncingSurveys, setIsSyncingSurveys] = useState(false);
  
  // Get safe area insets for bottom navigation
  const insets = useSafeAreaInsets();
  
  // Calculate interview stats
  const interviewStats = useMemo(() => {
    const approved = myInterviews.filter(interview => interview.status === 'Approved').length;
    const pending = myInterviews.filter(interview => interview.status === 'Pending_Approval').length;
    return { approved, pending };
  }, [myInterviews]);

  useEffect(() => {
    loadDashboardData();
    loadPendingInterviewsCount();
    loadOfflineInterviews(); // Load offline interviews on mount
  }, []);

  // Refresh pending count and offline interviews when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      console.log('🔄 Dashboard focused - reloading offline interviews...');
      loadPendingInterviewsCount();
      loadOfflineInterviews();
    });
    return unsubscribe;
  }, [navigation]);

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
      
      if (allOfflineInterviews.length > 0) {
        console.log('📦 Offline interviews details:');
        allOfflineInterviews.forEach((i: any, index: number) => {
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
        await loadOfflineInterviews(); // Reload offline interviews to update the list
        await loadPendingInterviewsCount();
        await loadDashboardData(); // Refresh dashboard data
      } else if (result.failedCount > 0) {
        showSnackbar(`Synced ${result.syncedCount}, failed ${result.failedCount}. Check details.`, 'error');
        await loadOfflineInterviews(); // Reload offline interviews to show updated status
        await loadPendingInterviewsCount();
      } else if (result.syncedCount === 0 && result.failedCount === 0) {
        showSnackbar('No pending interviews to sync', 'info');
        await loadOfflineInterviews(); // Still reload to ensure UI is up to date
      } else {
        showSnackbar('Sync failed. Please check your internet connection.', 'error');
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
              await offlineStorage.deleteSyncedInterview(interviewId);
              console.log('✅ Deleted offline interview:', interviewId);
              showSnackbar('Offline interview deleted', 'success');
              // Reload offline interviews and dashboard data
              await loadOfflineInterviews();
              await loadPendingInterviewsCount();
              await loadDashboardData();
            } catch (error) {
              console.error('Error deleting offline interview:', error);
              showSnackbar('Failed to delete interview', 'error');
            }
          },
        },
      ]
    );
  };

  const handleClearAllFailedInterviews = () => {
    const failedCount = offlineInterviews.filter(
      (i: any) => i.status === 'failed' || (i.status === 'synced' && i.error)
    ).length;
    
    if (failedCount === 0) {
      showSnackbar('No failed interviews to clear', 'info');
      return;
    }
    
    Alert.alert(
      'Clear All Failed Interviews',
      `Are you sure you want to delete all ${failedCount} failed offline interview(s)? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              const failedInterviewIds = offlineInterviews
                .filter((i: any) => i.status === 'failed' || (i.status === 'synced' && i.error))
                .map((i: any) => i.id);
              
              for (const interviewId of failedInterviewIds) {
                await offlineStorage.deleteSyncedInterview(interviewId);
                console.log('✅ Deleted failed offline interview:', interviewId);
              }
              
              showSnackbar(`Deleted ${failedInterviewIds.length} failed interview(s)`, 'success');
              // Reload offline interviews and dashboard data
              await loadOfflineInterviews();
              await loadPendingInterviewsCount();
              await loadDashboardData();
            } catch (error) {
              console.error('Error clearing failed interviews:', error);
              showSnackbar('Failed to clear interviews', 'error');
            }
          },
        },
      ]
    );
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
        
        // Don't try to load myInterviews in offline mode
        setMyInterviews([]);
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

      // Fetch interviews from API
      const interviewsResult = await apiService.getMyInterviews();
      console.log('📊 getMyInterviews API response:', {
        success: interviewsResult.success,
        count: interviewsResult.interviews?.length || 0,
        interviews: interviewsResult.interviews?.map((i: any) => ({
          id: i._id || i.id,
          surveyName: i.survey?.surveyName,
          status: i.status,
          startTime: i.startTime
        }))
      });

      if (interviewsResult.success) {
        const interviews = interviewsResult.interviews || [];
        console.log('📊 Setting myInterviews count:', interviews.length);
        setMyInterviews(interviews);
      } else {
        // Don't show error, just leave empty
        console.log('⚠️ Failed to fetch interviews from API, setting empty array');
        setMyInterviews([]);
      }
      
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#001D48" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#001D48', '#373177', '#3FADCC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <View style={styles.userInfo}>
            <Avatar.Text
              size={50}
              label={user.firstName.charAt(0).toUpperCase()}
              style={styles.avatar}
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
            disabled={isSyncingSurveys || isOffline}
            style={[styles.syncSurveyButton, isOffline && styles.disabledButton]}
            icon="sync"
            buttonColor={isOffline ? "#cccccc" : "#ffffff"}
            textColor={isSyncingSurveys ? "#ffffff" : (isOffline ? "#666666" : "#001D48")}
            loadingIndicatorColor="#ffffff"
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
              <Text style={styles.statNumber}>{availableSurveys.length}</Text>
              <Text style={styles.statLabel}>Available Surveys</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{myInterviews.length}</Text>
              <Text style={styles.statLabel}>My Interviews</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.approved}</Text>
              <Text style={styles.statLabel}>Accepted</Text>
            </Card.Content>
          </Card>
          
          <Card style={styles.statCard}>
            <Card.Content style={styles.statContent}>
              <Text style={styles.statNumber}>{interviewStats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
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
          {/* Clear All button - moved to separate row to prevent overlap */}
          {offlineInterviews.length > 0 && (
            <View style={styles.clearAllContainer}>
              <Button
                mode="outlined"
                onPress={handleClearAllFailedInterviews}
                textColor="#dc2626"
                buttonColor="#fff"
                icon="delete-outline"
                compact
                style={styles.clearAllButton}
              >
                Clear All Failed
              </Button>
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
                        {interview.survey?.surveyName || 'Unknown Survey'}
                      </Text>
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
                  {/* Delete button row - separate row to prevent overlap */}
                  {(interview.status === 'failed' || (interview.status === 'synced' && interview.error)) && (
                    <View style={styles.deleteButtonContainer}>
                      <TouchableOpacity
                        onPress={() => handleDeleteOfflineInterview(interview.id)}
                        style={styles.deleteButtonRow}
                      >
                        <Ionicons name="trash-outline" size={18} color="#dc2626" />
                        <Text style={styles.deleteButtonText}>Delete Interview</Text>
                      </TouchableOpacity>
                    </View>
                  )}
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

      {/* Sync Offline Interviews Button - Show when there are pending interviews OR when offline interviews exist */}
      {/* Position above FAB button with proper safe area insets */}
      {(pendingInterviewsCount > 0 || offlineInterviews.length > 0) && (
        <View style={[styles.syncContainer, { 
          paddingBottom: Math.max(16, insets.bottom) + 80 // Add space for FAB button (56px FAB + 24px gap)
        }]}>
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
        </View>
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { bottom: Math.max(16, insets.bottom) + 25 }]} // Move 25px higher as requested
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
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
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
  avatar: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
  clearAllContainer: {
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'flex-end',
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
  syncContainer: {
    padding: 16,
    paddingTop: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    position: 'relative', // Ensure proper positioning
  },
  syncButton: {
    backgroundColor: '#059669',
  },
  disabledButton: {
    opacity: 0.5,
  },
  offlineBadge: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  clearAllButton: {
    borderColor: '#dc2626',
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
});
