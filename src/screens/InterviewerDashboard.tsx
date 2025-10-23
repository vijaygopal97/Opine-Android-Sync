import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
} from 'react-native';
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
import { apiService } from '../services/api';
import { User, Survey } from '../types';

const { width } = Dimensions.get('window');

interface DashboardProps {
  navigation: any;
  user: User;
  onLogout: () => void;
}

export default function InterviewerDashboard({ navigation, user, onLogout }: DashboardProps) {
  const [availableSurveys, setAvailableSurveys] = useState<Survey[]>([]);
  const [myInterviews, setMyInterviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [surveysResult, interviewsResult] = await Promise.all([
        apiService.getAvailableSurveys(),
        apiService.getMyInterviews(),
      ]);

      if (surveysResult.success) {
        console.log('Available surveys loaded:', surveysResult.surveys?.length || 0);
        setAvailableSurveys(surveysResult.surveys || []);
      } else {
        console.log('Available surveys error:', surveysResult.message);
      }

      if (interviewsResult.success) {
        console.log('My interviews loaded:', interviewsResult.interviews?.length || 0);
        setMyInterviews(interviewsResult.interviews || []);
      } else {
        console.log('My interviews error:', interviewsResult.message);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      showSnackbar('Failed to load dashboard data');
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#059669';
      case 'completed': return '#2563eb';
      case 'in_progress': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Active';
      case 'completed': return 'Completed';
      case 'in_progress': return 'In Progress';
      default: return 'Unknown';
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#2563eb', '#7c3aed']}
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
              <Text style={styles.greeting}>{getGreeting()}</Text>
              <Text style={styles.userName}>{user.firstName} {user.lastName}</Text>
              <Text style={styles.userRole}>Interviewer</Text>
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
            colors={['#2563eb']}
            tintColor="#2563eb"
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
        </View>

        {/* Available Surveys */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Surveys</Text>
            <Button
              mode="text"
              onPress={() => navigation.navigate('AvailableSurveys')}
              textColor="#2563eb"
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
                      <Text style={styles.metaValue}>{survey.questions?.length || 0}</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Target</Text>
                      <Text style={styles.metaValue}>{survey.sampleSize?.toLocaleString() || 0}</Text>
                    </View>
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

        {/* Recent Interviews */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Interviews</Text>
            <Button
              mode="text"
              onPress={() => navigation.navigate('MyInterviews')}
              textColor="#2563eb"
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
                        {interview.startedAt ? new Date(interview.startedAt).toLocaleDateString() : 'Unknown'}
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
                        {interview.status?.replace('_', ' ') || 'Unknown'}
                      </Text>
                    </View>
                  </View>
                  {interview.completedAt && (
                    <Text style={styles.interviewDate}>
                      Completed: {new Date(interview.completedAt).toLocaleDateString()}
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
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AvailableSurveys')}
        label="Start Interview"
        iconColor="#ffffff"
        labelTextColor="#ffffff"
      />

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        style={styles.snackbar}
      >
        {snackbarMessage}
      </Snackbar>
    </View>
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
    paddingBottom: 30,
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
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 5,
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
    color: '#2563eb',
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
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
  },
  interviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  interviewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
    marginRight: 12,
  },
  interviewDate: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase',
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
    bottom: 0,
    backgroundColor: '#2563eb',
  },
  snackbar: {
    backgroundColor: '#dc2626',
  },
});
