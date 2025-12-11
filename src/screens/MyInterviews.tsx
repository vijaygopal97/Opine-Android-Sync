import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  Chip,
  Searchbar,
  Snackbar,
  ActivityIndicator,
  Menu,
  Divider,
} from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiService } from '../services/api';
import { SurveyResponse } from '../types';

export default function MyInterviews({ navigation }: any) {
  const [interviews, setInterviews] = useState<SurveyResponse[]>([]);
  const [filteredInterviews, setFilteredInterviews] = useState<SurveyResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    loadInterviews();
  }, []);

  useEffect(() => {
    filterInterviews();
  }, [interviews, searchQuery, selectedStatus]);

  const loadInterviews = async () => {
    setIsLoading(true);
    try {
      const result = await apiService.getMyInterviews();
      
      if (result.success) {
        console.log('MyInterviews - Loaded interviews:', result.interviews?.length || 0);
        console.log('MyInterviews - Interview data:', result.interviews);
        setInterviews(result.interviews || []);
      } else {
        console.log('MyInterviews - Error:', result.message);
        showSnackbar(result.message || 'Failed to load interviews');
      }
    } catch (error) {
      console.error('Error loading interviews:', error);
      showSnackbar('Failed to load interviews. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadInterviews();
    setIsRefreshing(false);
  };

  const filterInterviews = () => {
    let filtered = interviews;

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(interview =>
        interview.survey?.surveyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        interview.survey?.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by status
    if (selectedStatus !== 'all') {
      filtered = filtered.filter(interview => interview.status === selectedStatus);
    }

    setFilteredInterviews(filtered);
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  const handleViewInterview = (interview: SurveyResponse) => {
    if (interview.status === 'in_progress') {
      // Continue interview
      navigation.navigate('InterviewInterface', { 
        survey: interview.survey,
        responseId: interview._id,
        isContinuing: true 
      });
    } else {
      // View completed interview details
      navigation.navigate('InterviewDetails', { interview });
    }
  };

  const handleDeleteInterview = (interview: SurveyResponse) => {
    Alert.alert(
      'Delete Interview',
      `Are you sure you want to delete this interview? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Implement delete functionality
            showSnackbar('Delete functionality will be implemented');
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#059669';
      case 'in_progress': return '#f59e0b';
      case 'submitted': return '#2563eb';
      default: return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return 'check-circle';
      case 'in_progress': return 'clock';
      case 'submitted': return 'upload';
      default: return 'help-circle';
    }
  };

  const formatDate = (dateString: string | Date | undefined) => {
    if (!dateString) return 'N/A';
    try {
      const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
      if (isNaN(date.getTime())) {
        return 'N/A';
      }
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'N/A';
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || isNaN(seconds)) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#001D48" />
        <Text style={styles.loadingText}>Loading interviews...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      
      {/* Search and Filter */}
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Search interviews..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
        />
        
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <Button
              mode="outlined"
              onPress={() => setMenuVisible(true)}
              style={styles.filterButton}
              icon="filter"
            >
              {selectedStatus === 'all' ? 'All Status' : selectedStatus.replace('_', ' ').toUpperCase()}
            </Button>
          }
        >
          <Menu.Item
            onPress={() => {
              setSelectedStatus('all');
              setMenuVisible(false);
            }}
            title="All Status"
          />
          <Menu.Item
            onPress={() => {
              setSelectedStatus('in_progress');
              setMenuVisible(false);
            }}
            title="In Progress"
          />
          <Menu.Item
            onPress={() => {
              setSelectedStatus('completed');
              setMenuVisible(false);
            }}
            title="Completed"
          />
          <Menu.Item
            onPress={() => {
              setSelectedStatus('submitted');
              setMenuVisible(false);
            }}
            title="Submitted"
          />
        </Menu>
      </View>

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
        {filteredInterviews.length > 0 ? (
          filteredInterviews.map((interview) => (
            <Card key={interview._id} style={styles.interviewCard}>
              <Card.Content>
                <View style={styles.interviewHeader}>
                  <View style={styles.interviewTitleContainer}>
                    <Text style={styles.interviewTitle}>{interview.survey?.surveyName}</Text>
                    <View style={styles.badgesContainer}>
                      <Chip
                        icon={getStatusIcon(interview.status)}
                        style={[styles.statusChip, { backgroundColor: getStatusColor(interview.status) }]}
                        textStyle={styles.chipText}
                        compact
                      >
                        {interview.status.replace('_', ' ').toUpperCase()}
                      </Chip>
                      <Chip
                        style={[styles.modeChip, { backgroundColor: '#7c3aed' }]}
                        textStyle={styles.chipText}
                        compact
                      >
                        {interview.survey?.mode?.toUpperCase() || 'CAPI'}
                      </Chip>
                    </View>
                  </View>
                </View>

                <View style={styles.interviewMeta}>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Started</Text>
                    <Text style={styles.metaValue}>
                      {formatDate(interview.startTime || interview.startedAt || interview.createdAt)}
                    </Text>
                  </View>
                  {(interview.endTime || interview.completedAt) && (
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Completed</Text>
                      <Text style={styles.metaValue}>
                        {formatDate(interview.endTime || interview.completedAt)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Duration</Text>
                    <Text style={styles.metaValue}>
                      {formatDuration(interview.totalTimeSpent || interview.totalDuration)}
                    </Text>
                  </View>
                </View>

                {interview.locationData && (
                  <View style={styles.locationContainer}>
                    <Text style={styles.locationLabel}>Location:</Text>
                    <Text style={styles.locationText}>
                      {interview.locationData.city}, {interview.locationData.state}
                    </Text>
                  </View>
                )}

                {interview.audioUrl && (
                  <View style={styles.audioContainer}>
                    <Text style={styles.audioLabel}>Audio Recording: Available</Text>
                  </View>
                )}

                <Divider style={styles.divider} />

                <View style={styles.actionsContainer}>
                  <Button
                    mode="outlined"
                    onPress={() => handleViewInterview(interview)}
                    style={styles.viewButton}
                    compact
                  >
                    {interview.status === 'in_progress' ? 'Continue' : 'View Details'}
                  </Button>
                  
                  {interview.status === 'in_progress' && (
                    <Button
                      mode="contained"
                      onPress={() => handleViewInterview(interview)}
                      style={styles.continueButton}
                      compact
                    >
                      Resume
                    </Button>
                  )}
                  
                  {interview.status === 'completed' && (
                    <Button
                      mode="outlined"
                      onPress={() => handleDeleteInterview(interview)}
                      style={styles.deleteButton}
                      textColor="#dc2626"
                      compact
                    >
                      Delete
                    </Button>
                  )}
                </View>
              </Card.Content>
            </Card>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Interviews Found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery || selectedStatus !== 'all'
                ? 'Try adjusting your search or filter criteria'
                : 'You haven\'t started any interviews yet. Go to Available Surveys to begin.'}
            </Text>
            {(searchQuery || selectedStatus !== 'all') && (
              <Button
                mode="outlined"
                onPress={() => {
                  setSearchQuery('');
                  setSelectedStatus('all');
                }}
                style={styles.clearButton}
              >
                Clear Filters
              </Button>
            )}
            {!searchQuery && selectedStatus === 'all' && (
              <Button
                mode="contained"
                onPress={() => navigation.navigate('AvailableSurveys')}
                style={styles.startButton}
              >
                Browse Surveys
              </Button>
            )}
          </View>
        )}
      </ScrollView>

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
  searchContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#ffffff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  searchbar: {
    flex: 1,
    marginRight: 12,
    elevation: 0,
  },
  filterButton: {
    borderColor: '#d1d5db',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  interviewCard: {
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  interviewHeader: {
    marginBottom: 12,
  },
  interviewTitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  interviewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    flex: 1,
    marginRight: 12,
  },
  badgesContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  statusChip: {
    height: 28,
  },
  modeChip: {
    height: 28,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
  interviewMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaItem: {
    alignItems: 'center',
    flex: 1,
  },
  metaLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1f2937',
    textAlign: 'center',
  },
  locationContainer: {
    marginBottom: 8,
  },
  locationLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 2,
  },
  locationText: {
    fontSize: 14,
    color: '#1f2937',
  },
  audioContainer: {
    marginBottom: 8,
  },
  audioLabel: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  divider: {
    marginVertical: 16,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  viewButton: {
    flex: 1,
    borderColor: '#d1d5db',
  },
  continueButton: {
    flex: 1,
    backgroundColor: '#001D48',
  },
  deleteButton: {
    flex: 1,
    borderColor: '#dc2626',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 40,
  },
  clearButton: {
    borderColor: '#001D48',
    marginBottom: 16,
  },
  startButton: {
    backgroundColor: '#001D48',
  },
  snackbar: {
    backgroundColor: '#dc2626',
  },
});
