import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SurveyDetailsModal from '../components/SurveyDetailsModal';
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
import { Survey } from '../types';
import { offlineStorage } from '../services/offlineStorage';

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
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedSurvey, setSelectedSurvey] = useState<any>(null);
  const [expandedSurveys, setExpandedSurveys] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSurveys();
  }, []);

  useEffect(() => {
    if (surveys.length > 0) {
      applyFilters(surveys);
    }
  }, [searchQuery, selectedMode, surveys]);

  const loadSurveys = async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    try {
      // First, try to load from offline storage (if not forcing refresh)
      const offlineSurveys = await offlineStorage.getSurveys();
      
      if (offlineSurveys.length > 0 && !forceRefresh) {
        // Use cached surveys - no need to fetch again
        console.log('📦 Using cached surveys from offline storage');
        setSurveys(offlineSurveys);
        applyFilters(offlineSurveys);
        setIsLoading(false);
        return;
      }
      
      // No cached surveys or force refresh - check if online
      const isOnline = await apiService.isOnline();
      
      if (isOnline) {
        // Online - fetch from server
      const result = await apiService.getAvailableSurveys();
      
      if (result.success) {
          const surveys = result.surveys || [];
          setSurveys(surveys);
          // Save to offline storage AND download all dependent data immediately
          await offlineStorage.saveSurveys(surveys, true);
        // Apply client-side filtering
          applyFilters(surveys);
        } else {
          // If API fails, try loading from offline storage
          if (offlineSurveys.length > 0) {
            setSurveys(offlineSurveys);
            applyFilters(offlineSurveys);
            showSnackbar('Using cached surveys. Some data may be outdated.');
          } else {
            showSnackbar(result.message || 'Failed to load surveys');
          }
        }
      } else {
        // Offline - use cached data if available
        if (offlineSurveys.length > 0) {
          console.log('📴 Offline mode - loading surveys from local storage');
          setSurveys(offlineSurveys);
          applyFilters(offlineSurveys);
          showSnackbar('Offline mode: Using locally saved surveys');
        } else {
          showSnackbar('No surveys available offline. Please connect to the internet and sync from dashboard.');
        }
      }
    } catch (error) {
      console.error('Error loading surveys:', error);
      // Try loading from offline storage as fallback
      try {
        const offlineSurveys = await offlineStorage.getSurveys();
        if (offlineSurveys.length > 0) {
          setSurveys(offlineSurveys);
          applyFilters(offlineSurveys);
          showSnackbar('Using cached surveys due to error');
        } else {
          showSnackbar('Failed to load surveys. Please try again.');
        }
      } catch (offlineError) {
      showSnackbar('Failed to load surveys. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = (surveysToFilter: Survey[]) => {
    let filtered = surveysToFilter;

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(survey =>
        survey.surveyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        survey.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by mode
    if (selectedMode !== 'all') {
      filtered = filtered.filter(survey => {
        // For multi-mode surveys, check the assigned mode
        if (survey.mode === 'multi_mode') {
          return survey.assignedMode === selectedMode;
        }
        // For single-mode surveys, check the survey mode
        return survey.mode === selectedMode;
      });
    }

    setFilteredSurveys(filtered);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Force refresh from server
    await loadSurveys(true);
    setIsRefreshing(false);
  };


  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
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

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'capi': return '#059669';
      case 'cati': return '#2563eb';
      case 'online': return '#7c3aed';
      case 'multi_mode': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'capi': return 'account';
      case 'cati': return 'phone';
      case 'online': return 'web';
      case 'multi_mode': return 'layers';
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
        <ActivityIndicator size="large" color="#001D48" />
        <Text style={styles.loadingText}>Loading surveys...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
        {filteredSurveys.length > 0 ? (
          filteredSurveys.map((survey) => (
            <Card key={survey._id} style={styles.surveyCard}>
              <Card.Content>
                <View style={styles.surveyHeader}>
                  <Text style={styles.surveyTitle}>{survey.surveyName}</Text>
                  <View style={styles.badgesContainer}>
                    {/* Show assigned modes only */}
                    {survey.mode === 'multi_mode' ? (
                      // For multi-mode surveys, show the specific assigned mode(s)
                      survey.assignedMode ? (
                        <Chip
                          icon={getModeIcon(survey.assignedMode)}
                          style={[styles.modeChip, { backgroundColor: getModeColor(survey.assignedMode) }]}
                          textStyle={styles.chipText}
                          compact
                        >
                          {survey.assignedMode.toUpperCase()}
                        </Chip>
                      ) : null
                    ) : (
                      // For single-mode surveys, show the mode
                      <Chip
                        icon={getModeIcon(survey.mode)}
                        style={[styles.modeChip, { backgroundColor: getModeColor(survey.mode) }]}
                        textStyle={styles.chipText}
                        compact
                      >
                        {survey.mode.toUpperCase()}
                      </Chip>
                    )}
                    <Chip
                      style={[styles.statusChip, { backgroundColor: getStatusColor(survey.status) }]}
                      textStyle={styles.chipText}
                      compact
                    >
                      {survey.status}
                    </Chip>
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
                    <Divider style={styles.divider} />

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
                    <Text style={styles.metaValue}>
                      {survey.sections?.reduce((total: number, section: any) => 
                        total + (section.questions?.length || 0), 0) || 0}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Target</Text>
                    <Text style={styles.metaValue}>{survey.sampleSize?.toLocaleString() || 0} samples</Text>
                  </View>
                </View>

                {/* Assigned ACs */}
                {survey.assignedACs && survey.assignedACs.length > 0 && (
                  <View style={styles.assignedACsContainer}>
                    <View style={styles.assignedACsHeader}>
                      <Ionicons name="location" size={16} color="#6b7280" />
                      <Text style={styles.assignedACsLabel}>Assigned Areas:</Text>
                    </View>
                    <View style={styles.assignedACsChips}>
                      {survey.assignedACs.map((ac, index) => (
                        <View key={index} style={styles.acChip}>
                          <Text style={styles.acChipText}>{ac}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Targeting Details */}
                {survey.targetAudience && (
                  <View style={styles.targetingContainer}>
                    {/* Demographics */}
                    {survey.targetAudience.demographics && (
                      <View style={styles.targetingSection}>
                        <Text style={styles.targetingSectionTitle}>Demographics</Text>
                        {survey.targetAudience.demographics['Age Group'] && survey.targetAudience.demographics.ageRange && (
                          <View style={styles.targetingItem}>
                            <Text style={styles.targetingLabel}>Age Range:</Text>
                            <Text style={styles.targetingValue}>
                              {survey.targetAudience.demographics.ageRange.min || 'Not specified'} - {survey.targetAudience.demographics.ageRange.max || 'Not specified'} years
                            </Text>
                          </View>
                        )}
                        {survey.targetAudience.demographics['Gender'] && survey.targetAudience.demographics.genderRequirements && (
                          <View style={styles.targetingItem}>
                            <Text style={styles.targetingLabel}>Gender:</Text>
                            <View style={styles.genderChips}>
                              {(() => {
                                const requirements = survey.targetAudience.demographics.genderRequirements;
                                const selectedGenders = Object.keys(requirements).filter(g => requirements[g] && !g.includes('Percentage'));
                                
                                return selectedGenders.map(gender => {
                                  const percentage = requirements[`${gender}Percentage`];
                                  const displayPercentage = selectedGenders.length === 1 && !percentage ? 100 : (percentage || 0);
                                  return (
                                    <View key={gender} style={styles.genderChip}>
                                      <Text style={styles.genderChipText}>{gender}: {displayPercentage}%</Text>
                                    </View>
                                  );
                                });
                              })()}
                            </View>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Geographic */}
                    {survey.targetAudience.geographic && (
                      (() => {
                        const hasGeographicData = 
                          (survey.targetAudience.geographic['Country'] && survey.targetAudience.geographic.countryRequirements) ||
                          (survey.targetAudience.geographic['State/Province'] && survey.targetAudience.geographic.stateRequirements) ||
                          (survey.targetAudience.geographic['City'] && survey.targetAudience.geographic.cityRequirements) ||
                          (survey.targetAudience.geographic['Postal Code'] && survey.targetAudience.geographic.postalCodeRequirements) ||
                          (survey.targetAudience.geographic['Timezone'] && survey.targetAudience.geographic.timezoneRequirements);
                        
                        return hasGeographicData ? (
                          <View style={styles.targetingSection}>
                            <Text style={styles.targetingSectionTitle}>Geographic</Text>
                            {survey.targetAudience.geographic['Country'] && survey.targetAudience.geographic.countryRequirements && (
                              <View style={styles.targetingItem}>
                                <Text style={styles.targetingLabel}>Country:</Text>
                                <Text style={styles.targetingValue}>{survey.targetAudience.geographic.countryRequirements}</Text>
                              </View>
                            )}
                            {survey.targetAudience.geographic['State/Province'] && survey.targetAudience.geographic.stateRequirements && (
                              <View style={styles.targetingItem}>
                                <Text style={styles.targetingLabel}>State:</Text>
                                <Text style={styles.targetingValue}>{survey.targetAudience.geographic.stateRequirements}</Text>
                              </View>
                            )}
                            {survey.targetAudience.geographic['City'] && survey.targetAudience.geographic.cityRequirements && (
                              <View style={styles.targetingItem}>
                                <Text style={styles.targetingLabel}>City:</Text>
                                <Text style={styles.targetingValue}>{survey.targetAudience.geographic.cityRequirements}</Text>
                              </View>
                            )}
                            {survey.targetAudience.geographic['Postal Code'] && survey.targetAudience.geographic.postalCodeRequirements && (
                              <View style={styles.targetingItem}>
                                <Text style={styles.targetingLabel}>Postal Code:</Text>
                                <Text style={styles.targetingValue}>{survey.targetAudience.geographic.postalCodeRequirements}</Text>
                              </View>
                            )}
                            {survey.targetAudience.geographic['Timezone'] && survey.targetAudience.geographic.timezoneRequirements && (
                              <View style={styles.targetingItem}>
                                <Text style={styles.targetingLabel}>Timezone:</Text>
                                <Text style={styles.targetingValue}>
                                  {Object.keys(survey.targetAudience.geographic.timezoneRequirements)
                                    .filter(tz => survey.targetAudience.geographic.timezoneRequirements[tz])
                                    .join(', ')}
                                </Text>
                              </View>
                            )}
                          </View>
                        ) : null;
                      })()
                    )}

                    {/* Assignment Info */}
                    {survey.assignedAt && (
                      <View style={styles.assignmentInfo}>
                        <View style={styles.assignmentItem}>
                          <Text style={styles.assignmentLabel}>Assigned:</Text>
                          <Text style={styles.assignmentValue}>
                            {new Date(survey.assignedAt).toLocaleDateString()}
                          </Text>
                        </View>
                        {survey.deadline && (
                          <View style={styles.assignmentItem}>
                            <Text style={styles.assignmentLabel}>Deadline:</Text>
                            <Text style={styles.assignmentValue}>
                              {new Date(survey.deadline).toLocaleDateString()}
                            </Text>
                          </View>
                        )}
                        {survey.selectedState && (
                          <View style={styles.assignmentItem}>
                            <Text style={styles.assignmentLabel}>State:</Text>
                            <Text style={styles.assignmentValue}>{survey.selectedState}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}

                <Divider style={styles.divider} />
                  </>
                )}

                <View style={styles.actionsContainer}>
                  <Button
                    mode="outlined"
                    onPress={() => {
                      setSelectedSurvey(survey);
                      setShowDetailsModal(true);
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
                    {survey.mode === 'multi_mode' && survey.assignedMode === 'cati' 
                      ? 'Start CATI Interview'
                      : survey.mode === 'multi_mode' && survey.assignedMode === 'capi' 
                      ? 'Start CAPI Interview' 
                      : 'Start Interview'
                    }
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

      {/* Survey Details Modal */}
      <SurveyDetailsModal
        visible={showDetailsModal}
        survey={selectedSurvey}
        onClose={() => {
          setShowDetailsModal(false);
          setSelectedSurvey(null);
        }}
      />
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
  surveyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
    lineHeight: 26,
  },
  badgesContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
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
    backgroundColor: '#001D48',
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
  },
  snackbar: {
    backgroundColor: '#dc2626',
  },
  // Assigned ACs styles
  assignedACsContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  assignedACsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  assignedACsLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 4,
    fontWeight: '500',
  },
  assignedACsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  acChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  acChipText: {
    fontSize: 12,
    color: '#1e40af',
    fontWeight: '500',
  },
  // Targeting styles
  targetingContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  targetingSection: {
    marginBottom: 12,
  },
  targetingSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  targetingItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  targetingLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
    width: 80,
  },
  targetingValue: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  // Assignment info styles
  assignmentInfo: {
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  assignmentItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  assignmentLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
    width: 80,
  },
  assignmentValue: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  // Gender chips styles
  genderChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  genderChip: {
    backgroundColor: '#f3e8ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c084fc',
  },
  genderChipText: {
    fontSize: 11,
    color: '#7c3aed',
    fontWeight: '500',
  },
  expandButtonContainer: {
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  expandButton: {
    minWidth: 120,
  },
});
