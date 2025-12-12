import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  Avatar,
  Snackbar,
  ActivityIndicator,
} from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiService } from '../services/api';
import { User } from '../types';
import ResponseDetailsModal from '../components/ResponseDetailsModal';

const { width } = Dimensions.get('window');

interface QualityAgentDashboardProps {
  navigation: any;
  user: User;
  onLogout: () => void;
}

export default function QualityAgentDashboard({ navigation, user, onLogout }: QualityAgentDashboardProps) {
  const [totalReviewed, setTotalReviewed] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [selectedInterview, setSelectedInterview] = useState<any>(null);
  const [showResponseDetails, setShowResponseDetails] = useState(false);
  const [currentAssignment, setCurrentAssignment] = useState<any>(null);
  const [assignmentExpiresAt, setAssignmentExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [isGettingNextAssignment, setIsGettingNextAssignment] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Timer for assignment expiration
  useEffect(() => {
    if (!assignmentExpiresAt) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(assignmentExpiresAt);
      const diff = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
      
      if (diff === 0) {
        setTimeRemaining(null);
        setAssignmentExpiresAt(null);
        if (currentAssignment) {
          showSnackbar('Your review assignment has expired. Please start a new quality check.');
          handleReleaseAssignment();
        }
      } else {
        const minutes = Math.floor(diff / 60);
        const seconds = diff % 60;
        setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [assignmentExpiresAt, currentAssignment]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // Get all-time stats for total reviewed (same as web app)
      const allTimeResponse = await apiService.getQualityAgentAnalytics({ timeRange: 'all' });
      if (allTimeResponse.success && allTimeResponse.data?.overview) {
        setTotalReviewed(allTimeResponse.data.overview.totalReviewed || 0);
      } else {
        setTotalReviewed(0);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      showSnackbar('Failed to load dashboard data');
      setTotalReviewed(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDashboardData();
    setIsRefreshing(false);
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
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

  const handleStartQualityCheck = async () => {
    try {
      setIsGettingNextAssignment(true);
      const result = await apiService.getNextReviewAssignment();
      
      if (!result.success) {
        showSnackbar(result.message || 'Failed to get next assignment');
        return;
      }

      if (!result.data || !result.data.interview) {
        showSnackbar(result.data?.message || 'No responses available for review');
        return;
      }

      // Set the assigned response
      console.log('🔍 QualityAgentDashboard - Interview data received:', {
        responseId: result.data.interview?.responseId,
        hasInterviewer: !!result.data.interview?.interviewer,
        interviewerId: result.data.interview?.interviewer?._id?.toString(),
        interviewerName: result.data.interview?.interviewer ? `${result.data.interview.interviewer.firstName} ${result.data.interview.interviewer.lastName}` : 'null',
        interviewerMemberId: result.data.interview?.interviewer?.memberId || 'null',
        interviewerData: result.data.interview?.interviewer
      });
      setCurrentAssignment(result.data.interview);
      setAssignmentExpiresAt(result.data.expiresAt ? new Date(result.data.expiresAt) : null);
      setSelectedInterview(result.data.interview);
      setShowResponseDetails(true);
      
      showSnackbar('Response assigned. You have 30 minutes to complete the review.');
    } catch (error: any) {
      console.error('Error getting next assignment:', error);
      showSnackbar(error.response?.data?.message || 'Failed to get next assignment. Please try again.');
    } finally {
      setIsGettingNextAssignment(false);
    }
  };

  const handleReleaseAssignment = async () => {
    if (!currentAssignment || !currentAssignment.responseId) return;

    try {
      await apiService.releaseReviewAssignment(currentAssignment.responseId);
      setCurrentAssignment(null);
      setAssignmentExpiresAt(null);
      setSelectedInterview(null);
      setShowResponseDetails(false);
    } catch (error: any) {
      // Silently ignore 403/404 errors (assignment might already be expired/released)
      if (error.response?.status !== 403 && error.response?.status !== 404) {
        console.error('Error releasing assignment:', error);
      }
    }
  };

  const handleCloseModal = async () => {
    // Release assignment if one exists (user is closing without submitting)
    if (currentAssignment && currentAssignment.responseId) {
      try {
        await handleReleaseAssignment();
      } catch (error) {
        console.log('Assignment release skipped:', error);
      }
    }
    
    setShowResponseDetails(false);
    setSelectedInterview(null);
  };

  const handleVerificationSubmit = async (verificationData: any) => {
    try {
      const result = await apiService.submitVerification(verificationData);
      
      if (result.success) {
        showSnackbar('Verification submitted successfully');
        setCurrentAssignment(null);
        setAssignmentExpiresAt(null);
        setSelectedInterview(null);
        setShowResponseDetails(false);
        // Refresh stats
        await loadDashboardData();
      } else {
        showSnackbar(result.message || 'Failed to submit verification');
      }
    } catch (error: any) {
      console.error('Error submitting verification:', error);
      showSnackbar(error.response?.data?.message || 'Failed to submit verification');
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
              <Text style={styles.userRole}>Quality Agent</Text>
            </View>
          </View>
          <Button
            mode="outlined"
            onPress={handleLogout}
            style={styles.logoutButton}
            textColor="#ffffff"
            compact
          >
            Logout
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
        {/* Stats Card */}
        <View style={styles.statsContainer}>
          <Card style={styles.statCardLarge}>
            <Card.Content style={styles.statContentLarge}>
              <Text style={styles.statNumberLarge}>{totalReviewed}</Text>
              <Text style={styles.statLabelLarge}>Total Reviewed</Text>
            </Card.Content>
          </Card>
        </View>

        {/* Start Quality Check Section */}
        <View style={styles.section}>
          <Card style={styles.actionCard}>
            <Card.Content>
              <Text style={styles.sectionTitle}>Quality Review</Text>
              <Text style={styles.sectionDescription}>
                Start reviewing pending survey responses. You'll have 30 minutes to complete each review.
              </Text>
              
              {currentAssignment && timeRemaining && (
                <View style={styles.timerContainer}>
                  <Text style={styles.timerLabel}>Time Remaining:</Text>
                  <Text style={styles.timerValue}>{timeRemaining}</Text>
                </View>
              )}

              <Button
                mode="contained"
                onPress={currentAssignment ? () => setShowResponseDetails(true) : handleStartQualityCheck}
                style={styles.startButton}
                loading={isGettingNextAssignment}
                disabled={isGettingNextAssignment}
              >
                {currentAssignment ? 'Continue Review' : 'Start Quality Check'}
              </Button>

              {currentAssignment && (
                <Button
                  mode="outlined"
                  onPress={async () => {
                    Alert.alert(
                      'Release Assignment',
                      'Are you sure you want to release this assignment?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Release',
                          style: 'destructive',
                          onPress: async () => {
                            await handleReleaseAssignment();
                            showSnackbar('Assignment released');
                          }
                        }
                      ]
                    );
                  }}
                  style={styles.releaseButton}
                >
                  Release Assignment
                </Button>
              )}
            </Card.Content>
          </Card>
        </View>
      </ScrollView>

      {/* Response Details Modal */}
      {showResponseDetails && selectedInterview && (
        <ResponseDetailsModal
          visible={showResponseDetails}
          interview={selectedInterview}
          onClose={handleCloseModal}
          onSubmit={handleVerificationSubmit}
          assignmentExpiresAt={assignmentExpiresAt}
        />
      )}

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        style={styles.snackbar}
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
    paddingBottom: 20,
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
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 4,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 2,
  },
  userRole: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  logoutButton: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  statsContainer: {
    marginBottom: 20,
  },
  statCardLarge: {
    elevation: 4,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  statContentLarge: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  statNumberLarge: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#001D48',
    marginBottom: 8,
  },
  statLabelLarge: {
    fontSize: 18,
    color: '#6b7280',
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  actionCard: {
    elevation: 4,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
    lineHeight: 20,
  },
  timerContainer: {
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  timerLabel: {
    fontSize: 12,
    color: '#92400e',
    marginBottom: 4,
  },
  timerValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400e',
  },
  startButton: {
    marginTop: 8,
    backgroundColor: '#001D48',
  },
  releaseButton: {
    marginTop: 12,
    borderColor: '#dc2626',
  },
  snackbar: {
    backgroundColor: '#1f2937',
  },
});

