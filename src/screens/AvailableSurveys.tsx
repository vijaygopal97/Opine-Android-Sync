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
import { apiService } from '../services/api';
import { Survey } from '../types';

export default function AvailableSurveys({ navigation }: any) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [filteredSurveys, setFilteredSurveys] = useState<Survey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    loadSurveys();
  }, []);

  useEffect(() => {
    loadSurveys();
  }, [searchQuery, selectedMode]);

  const loadSurveys = async () => {
    setIsLoading(true);
    try {
      const filters = {
        mode: selectedMode !== 'all' ? selectedMode : undefined,
        search: searchQuery.trim() || undefined
      };
      
      const result = await apiService.getAvailableSurveys(filters);
      
      if (result.success) {
        console.log('AvailableSurveys - Loaded surveys:', result.surveys?.length || 0);
        console.log('AvailableSurveys - Survey data:', result.surveys);
        setSurveys(result.surveys || []);
        setFilteredSurveys(result.surveys || []);
      } else {
        console.log('AvailableSurveys - Error:', result.message);
        showSnackbar(result.message || 'Failed to load surveys');
      }
    } catch (error) {
      console.error('Error loading surveys:', error);
      showSnackbar('Failed to load surveys. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadSurveys();
    setIsRefreshing(false);
  };


  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  const handleStartInterview = (survey: Survey) => {
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
            navigation.navigate('InterviewInterface', { survey });
          },
        },
      ]
    );
  };

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'capi': return '#059669';
      case 'cati': return '#2563eb';
      case 'online': return '#7c3aed';
      default: return '#6b7280';
    }
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'capi': return 'account';
      case 'cati': return 'phone';
      case 'online': return 'web';
      default: return 'help-circle';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#059669';
      case 'draft': return '#f59e0b';
      case 'completed': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const formatDuration = (minutes: number | undefined) => {
    if (!minutes || minutes === 0) {
      return 'Not specified';
    }
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading surveys...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Search and Filter */}
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Search surveys..."
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
              {selectedMode === 'all' ? 'All Modes' : selectedMode.toUpperCase()}
            </Button>
          }
        >
          <Menu.Item
            onPress={() => {
              setSelectedMode('all');
              setMenuVisible(false);
            }}
            title="All Modes"
          />
          <Menu.Item
            onPress={() => {
              setSelectedMode('capi');
              setMenuVisible(false);
            }}
            title="CAPI"
          />
          <Menu.Item
            onPress={() => {
              setSelectedMode('cati');
              setMenuVisible(false);
            }}
            title="CATI"
          />
          <Menu.Item
            onPress={() => {
              setSelectedMode('online');
              setMenuVisible(false);
            }}
            title="Online"
          />
        </Menu>
      </View>

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
        {filteredSurveys.length > 0 ? (
          filteredSurveys.map((survey) => (
            <Card key={survey._id} style={styles.surveyCard}>
              <Card.Content>
                <View style={styles.surveyHeader}>
                  <View style={styles.surveyTitleContainer}>
                    <Text style={styles.surveyTitle}>{survey.surveyName}</Text>
                    <View style={styles.badgesContainer}>
                      <Chip
                        icon={getModeIcon(survey.mode)}
                        style={[styles.modeChip, { backgroundColor: getModeColor(survey.mode) }]}
                        textStyle={styles.chipText}
                        compact
                      >
                        {survey.mode.toUpperCase()}
                      </Chip>
                      <Chip
                        style={[styles.statusChip, { backgroundColor: getStatusColor(survey.status) }]}
                        textStyle={styles.chipText}
                        compact
                      >
                        {survey.status}
                      </Chip>
                    </View>
                  </View>
                </View>

                <Text style={styles.surveyDescription} numberOfLines={3}>
                  {survey.description}
                </Text>

                <View style={styles.surveyMeta}>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Duration</Text>
                    <Text style={styles.metaValue}>{formatDuration(survey.estimatedDuration)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Questions</Text>
                    <Text style={styles.metaValue}>{survey.questions?.length || 0}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Target</Text>
                    <Text style={styles.metaValue}>{survey.sampleSize?.toLocaleString() || 0} samples</Text>
                  </View>
                </View>

                <Divider style={styles.divider} />

                <View style={styles.actionsContainer}>
                  <Button
                    mode="outlined"
                    onPress={() => {
                      // Navigate to survey details
                      Alert.alert('Survey Details', `Survey: ${survey.surveyName}\n\nDescription: ${survey.description}\n\nMode: ${survey.mode.toUpperCase()}\nDuration: ${formatDuration(survey.estimatedDuration)}\nQuestions: ${survey.questions?.length || 0}`);
                    }}
                    style={styles.detailsButton}
                    compact
                  >
                    View Details
                  </Button>
                  
                  <Button
                    mode="contained"
                    onPress={() => handleStartInterview(survey)}
                    style={styles.startButton}
                    compact
                  >
                    Start Interview
                  </Button>
                </View>
              </Card.Content>
            </Card>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Surveys Found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery || selectedMode !== 'all'
                ? 'Try adjusting your search or filter criteria'
                : 'No surveys are currently available. Check back later.'}
            </Text>
            {(searchQuery || selectedMode !== 'all') && (
              <Button
                mode="outlined"
                onPress={() => {
                  setSearchQuery('');
                  setSelectedMode('all');
                }}
                style={styles.clearButton}
              >
                Clear Filters
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
  surveyCard: {
    marginBottom: 20,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    borderRadius: 16,
  },
  surveyHeader: {
    marginBottom: 12,
  },
  surveyTitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  surveyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    flex: 1,
    marginRight: 12,
    lineHeight: 26,
  },
  badgesContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  modeChip: {
    height: 32,
    borderRadius: 16,
  },
  statusChip: {
    height: 32,
    borderRadius: 16,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  surveyDescription: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 16,
  },
  surveyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
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
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  divider: {
    marginVertical: 16,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailsButton: {
    flex: 1,
    borderColor: '#d1d5db',
  },
  startButton: {
    flex: 1,
    backgroundColor: '#2563eb',
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
    borderColor: '#2563eb',
  },
  snackbar: {
    backgroundColor: '#dc2626',
  },
});
