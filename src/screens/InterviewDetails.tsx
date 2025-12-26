import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Button } from 'react-native-paper';
import { Audio } from 'expo-av';
import { apiService } from '../services/api';
import { SurveyResponse } from '../types';

interface InterviewDetailsProps {
  route?: {
    params?: {
      interview?: SurveyResponse;
    };
  };
  navigation?: any;
}

const { width } = Dimensions.get('window');

const InterviewDetails: React.FC<InterviewDetailsProps> = ({ route, navigation }) => {
  const interview = route?.params?.interview;
  
  if (!interview) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 16, color: '#ef4444', marginBottom: 20 }}>Interview data not available</Text>
          <Button onPress={() => navigation?.goBack()}>Go Back</Button>
        </View>
      </SafeAreaView>
    );
  }
  const [isLoading, setIsLoading] = useState(false);
  const [detailedInterview, setDetailedInterview] = useState<SurveyResponse | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioPosition, setAudioPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  useEffect(() => {
    if (interview) {
      loadDetailedInterview();
    }
    
    // Cleanup audio when component unmounts
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [interview]);

  useEffect(() => {
    // Cleanup audio when component unmounts
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const loadDetailedInterview = async () => {
    if (!interview) {
      console.log('No interview data available');
      return;
    }
    
    setIsLoading(true);
    try {
      const result = await apiService.getInterviewDetails(interview._id);
      if (result.success) {
        setDetailedInterview(result.interview);
      }
    } catch (error) {
      console.error('Error loading interview details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Approved':
        return '#10b981';
      case 'Rejected':
        return '#ef4444';
      case 'Pending_Approval':
        return '#f59e0b';
      default:
        return '#6b7280';
    }
  };

  const handlePlayAudio = async () => {
    if (!interview) {
      Alert.alert('Error', 'Interview data not available.');
      return;
    }
    
    const audioUrl = interview.audioRecording?.url || interview.audioRecording?.audioUrl || interview.audioUrl;
    if (!audioUrl) {
      Alert.alert('No Audio', 'No audio recording available for this interview.');
      return;
    }

    try {
      if (sound) {
        if (isPlaying) {
          await sound.pauseAsync();
          setIsPlaying(false);
        } else {
          await sound.playAsync();
          setIsPlaying(true);
        }
      } else {
        setIsLoadingAudio(true);
        // Set API URL based on environment
        const API_BASE_URL = __DEV__ 
          ? 'https://opine.exypnossolutions.com'  // Development server
          : 'https://convo.convergentview.com';    // Production server
        const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL}${audioUrl}`;
        
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: fullAudioUrl },
          { shouldPlay: true }
        );
        
        setSound(newSound);
        setIsPlaying(true);
        
        const status = await newSound.getStatusAsync();
        if (status.isLoaded) {
          setAudioDuration(status.durationMillis || 0);
        }
        
        newSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded) {
            setAudioPosition(status.positionMillis || 0);
            if (status.didJustFinish) {
              setIsPlaying(false);
              setAudioPosition(0);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      Alert.alert('Audio Error', 'Failed to play audio recording.');
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const handleViewLocation = () => {
    if (!interview) return;
    const location = interview.location || interview.locationData;
    if (location?.latitude && location?.longitude) {
      const mapsUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
      Linking.openURL(mapsUrl);
    } else {
      Alert.alert('No Location', 'No location data available for this interview.');
    }
  };

  // Helper function to format response display text (similar to web version)
  const formatResponseDisplay = (response: any, surveyQuestion: any) => {
    if (!response || response === null || response === undefined) {
      return 'No response';
    }

    // If it's an array (multiple selections)
    if (Array.isArray(response)) {
      if (response.length === 0) return 'No selections';
      
      // Map each value to its display text using the question options
      const displayTexts = response.map((value: any) => {
        // Check if this is an "Others: [specified text]" response
        if (typeof value === 'string' && value.startsWith('Others: ')) {
          return value; // Return as-is (e.g., "Others: Custom text")
        }
        
        if (surveyQuestion && surveyQuestion.options) {
          const option = surveyQuestion.options.find((opt: any) => {
            const optValue = opt.value || opt.text;
            return optValue === value;
          });
          return option ? option.text : value;
        }
        return value;
      });
      
      return displayTexts.join(', ');
    }

    // If it's a string or single value
    if (typeof response === 'string' || typeof response === 'number') {
      // Check if this is an "Others: [specified text]" response
      if (typeof response === 'string' && response.startsWith('Others: ')) {
        return response; // Return as-is (e.g., "Others: Custom text")
      }
      
      // Handle rating responses with labels
      if (surveyQuestion && surveyQuestion.type === 'rating' && typeof response === 'number') {
        const scale = surveyQuestion.scale || {};
        const labels = scale.labels || [];
        const min = scale.min || 1;
        const label = labels[response - min];
        if (label) {
          return `${response} (${label})`;
        }
        return response.toString();
      }
      
      // Map to display text using question options
      if (surveyQuestion && surveyQuestion.options) {
        const option = surveyQuestion.options.find((opt: any) => {
          const optValue = opt.value || opt.text;
          return optValue === response;
        });
        return option ? option.text : response.toString();
      }
      return response.toString();
    }

    return JSON.stringify(response);
  };

  // Helper function to find question by text in survey
  const findQuestionByText = (questionText: string, survey: any) => {
    if (!survey || !questionText) return null;
    
    // Handle nested survey structure
    const actualSurvey = survey.survey || survey;
    
    // Search in sections
    if (actualSurvey.sections) {
      for (const section of actualSurvey.sections) {
        if (section.questions) {
          for (const question of section.questions) {
            if (question.text === questionText || question.questionText === questionText) {
              return question;
            }
          }
        }
      }
    }
    
    // Search in top-level questions
    if (actualSurvey.questions) {
      for (const question of actualSurvey.questions) {
        if (question.text === questionText || question.questionText === questionText) {
          return question;
        }
      }
    }
    
    return null;
  };

  // Helper function to find question by keywords in survey
  const findQuestionByKeywords = (keywords: string[], survey: any) => {
    if (!survey) return null;
    
    const actualSurvey = survey.survey || survey;
    const allQuestions: any[] = [];
    
    // Collect all questions
    if (actualSurvey.sections) {
      actualSurvey.sections.forEach((section: any) => {
        if (section.questions) {
          allQuestions.push(...section.questions);
        }
      });
    }
    if (actualSurvey.questions) {
      allQuestions.push(...actualSurvey.questions);
    }
    
    // Find question matching keywords
    const keywordsLower = keywords.map(k => k.toLowerCase());
    return allQuestions.find((q: any) => {
      const questionText = (q.text || '').toLowerCase();
      return keywordsLower.some(keyword => questionText.includes(keyword));
    });
  };

  // Helper function to get failed questions from verification criteria
  const getFailedQuestions = (verificationData: any, survey: any) => {
    if (!verificationData || !verificationData.criteria) return [];
    
    const criteria = verificationData.criteria;
    const failedQuestions: Array<{ criterion: string; questionText: string; reason: string }> = [];
    
    // Map criteria to question types and check if they failed
    // Based on getApprovalStatus logic from SurveyApprovals.jsx
    
    // Audio Status - fails if not '1', '4', or '7'
    if (criteria.audioStatus && !['1', '4', '7'].includes(criteria.audioStatus)) {
      failedQuestions.push({
        criterion: 'audioStatus',
        questionText: 'Audio Quality',
        reason: 'Audio quality did not match'
      });
    }
    
    // Gender Matching - fails if not '1'
    if (criteria.genderMatching && criteria.genderMatching !== '1') {
      const genderQuestion = findQuestionByKeywords(['gender'], survey) || 
                            findQuestionByText('What is your gender?', survey);
      failedQuestions.push({
        criterion: 'genderMatching',
        questionText: genderQuestion?.text || 'Gender question',
        reason: 'Gender response did not match'
      });
    }
    
    // Upcoming Elections Matching - fails if not '1' or '3'
    if (criteria.upcomingElectionsMatching && !['1', '3'].includes(criteria.upcomingElectionsMatching)) {
      const upcomingElectionsQuestion = findQuestionByKeywords(['upcoming', 'election', 'tomorrow', 'assembly election'], survey);
      failedQuestions.push({
        criterion: 'upcomingElectionsMatching',
        questionText: upcomingElectionsQuestion?.text || 'Upcoming elections question',
        reason: 'Upcoming elections response did not match'
      });
    }
    
    // Previous Elections Matching - fails if not '1' or '3'
    if (criteria.previousElectionsMatching && !['1', '3'].includes(criteria.previousElectionsMatching)) {
      const previousElectionsQuestion = findQuestionByKeywords(['previous', 'election', 'last assembly', 'voted'], survey);
      failedQuestions.push({
        criterion: 'previousElectionsMatching',
        questionText: previousElectionsQuestion?.text || 'Previous elections question',
        reason: 'Previous elections response did not match'
      });
    }
    
    // Previous Lok Sabha Elections Matching - fails if not '1' or '3'
    if (criteria.previousLoksabhaElectionsMatching && !['1', '3'].includes(criteria.previousLoksabhaElectionsMatching)) {
      const loksabhaQuestion = findQuestionByKeywords(['lok sabha', 'loksabha', 'parliamentary'], survey);
      failedQuestions.push({
        criterion: 'previousLoksabhaElectionsMatching',
        questionText: loksabhaQuestion?.text || 'Previous Lok Sabha elections question',
        reason: 'Previous Lok Sabha elections response did not match'
      });
    }
    
    // Name Matching - fails if not '1' or '3'
    if (criteria.nameMatching && !['1', '3'].includes(criteria.nameMatching)) {
      const nameQuestion = findQuestionByText('What is your full name?', survey) ||
                           findQuestionByKeywords(['name', 'full name'], survey);
      failedQuestions.push({
        criterion: 'nameMatching',
        questionText: nameQuestion?.text || 'Name question',
        reason: 'Name response did not match'
      });
    }
    
    // Age Matching - fails if not '1' or '3'
    if (criteria.ageMatching && !['1', '3'].includes(criteria.ageMatching)) {
      const ageQuestion = findQuestionByText('Could you please tell me your age in complete years?', survey) ||
                          findQuestionByKeywords(['age', 'year'], survey);
      failedQuestions.push({
        criterion: 'ageMatching',
        questionText: ageQuestion?.text || 'Age question',
        reason: 'Age response did not match'
      });
    }
    
    return failedQuestions;
  };

  const renderResponseItem = (response: any, index: number) => {
    // Find the corresponding question in the survey to get options
    const survey = detailedInterview?.survey || interview?.survey;
    const surveyQuestion = findQuestionByText(response.questionText, survey);
    
    // Format the response for display
    const formattedResponse = formatResponseDisplay(response.response, surveyQuestion);
    
    return (
      <View key={index} style={styles.responseItem}>
        <Text style={styles.questionText}>{response.questionText}</Text>
        <Text style={styles.answerText}>
          {response.isSkipped ? (
            <Text style={styles.skippedText}>Skipped</Text>
          ) : (
            formattedResponse
          )}
        </Text>
      </View>
    );
  };

  if (!interview) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation?.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#1f2937" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Interview Details</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.content}>
          <Text style={styles.errorText}>No interview data available</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation?.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Interview Details</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Survey Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Survey Information</Text>
          <View style={styles.infoCard}>
            <Text style={styles.surveyName}>{interview.survey?.surveyName}</Text>
            <Text style={styles.surveyDescription}>{interview.survey?.description}</Text>
            <View style={styles.surveyMeta}>
              <Chip style={[styles.categoryChip, { backgroundColor: '#3b82f6' }]}>
                {interview.survey?.category}
              </Chip>
              <Chip style={[styles.modeChip, { backgroundColor: '#7c3aed' }]}>
                {interview.survey?.mode?.toUpperCase() || 'CAPI'}
              </Chip>
            </View>
          </View>
        </View>

        {/* Interview Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Interview Status</Text>
          <View style={styles.infoCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status:</Text>
              <Chip
                style={[
                  styles.statusChip,
                  { backgroundColor: getStatusColor(interview.status) }
                ]}
                textStyle={styles.statusText}
              >
                {interview.status.replace('_', ' ')}
              </Chip>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Response ID:</Text>
              <Text style={styles.statusValue}>{interview.responseId}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Session ID:</Text>
              <Text style={styles.statusValue}>{interview.sessionId}</Text>
            </View>
          </View>
        </View>

        {/* Interview Statistics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Interview Statistics</Text>
          <View style={styles.infoCard}>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{interview.answeredQuestions}</Text>
                <Text style={styles.statLabel}>Answered</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{interview.skippedQuestions}</Text>
                <Text style={styles.statLabel}>Skipped</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{interview.totalQuestions}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{interview.completionPercentage}%</Text>
                <Text style={styles.statLabel}>Complete</Text>
              </View>
            </View>
            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>Duration:</Text>
              <Text style={styles.durationValue}>{formatDuration(interview.totalTimeSpent)}</Text>
            </View>
          </View>
        </View>

        {/* Timing Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timing Information</Text>
          <View style={styles.infoCard}>
            <View style={styles.timingRow}>
              <Text style={styles.timingLabel}>Started:</Text>
              <Text style={styles.timingValue}>{formatDate(interview.startTime)}</Text>
            </View>
            <View style={styles.timingRow}>
              <Text style={styles.timingLabel}>Completed:</Text>
              <Text style={styles.timingValue}>{formatDate(interview.endTime)}</Text>
            </View>
            <View style={styles.timingRow}>
              <Text style={styles.timingLabel}>Created:</Text>
              <Text style={styles.timingValue}>{formatDate(interview.createdAt)}</Text>
            </View>
          </View>
        </View>

        {/* Location Information */}
        {(interview.location || interview.locationData) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location Information</Text>
            <View style={styles.infoCard}>
              <View style={styles.locationRow}>
                <Text style={styles.locationLabel}>Address:</Text>
                <Text style={styles.locationValue}>{(interview.location || interview.locationData)?.address || 'N/A'}</Text>
              </View>
              <View style={styles.locationRow}>
                <Text style={styles.locationLabel}>City:</Text>
                <Text style={styles.locationValue}>{(interview.location || interview.locationData)?.city || 'N/A'}</Text>
              </View>
              <View style={styles.locationRow}>
                <Text style={styles.locationLabel}>State:</Text>
                <Text style={styles.locationValue}>{(interview.location || interview.locationData)?.state || 'N/A'}</Text>
              </View>
              <View style={styles.locationRow}>
                <Text style={styles.locationLabel}>Country:</Text>
                <Text style={styles.locationValue}>{(interview.location || interview.locationData)?.country || 'N/A'}</Text>
              </View>
              <TouchableOpacity style={styles.mapButton} onPress={handleViewLocation}>
                <Ionicons name="location" size={20} color="#3b82f6" />
                <Text style={styles.mapButtonText}>View on Map</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Audio Recording */}
        {(interview.audioRecording || interview.audioUrl) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Audio Recording</Text>
            <View style={styles.infoCard}>
              <View style={styles.audioRow}>
                <Text style={styles.audioLabel}>Has Audio:</Text>
                <Text style={styles.audioValue}>
                  {(interview.audioRecording?.url || interview.audioRecording?.audioUrl || interview.audioUrl) ? 'Yes' : 'No'}
                </Text>
              </View>
              {(interview.audioRecording?.url || interview.audioRecording?.audioUrl || interview.audioUrl) && (
                <>
                  {interview.audioRecording?.duration && (
                    <View style={styles.audioRow}>
                      <Text style={styles.audioLabel}>Duration:</Text>
                      <Text style={styles.audioValue}>
                        {formatDuration(interview.audioRecording.duration)}
                      </Text>
                    </View>
                  )}
                  {interview.audioRecording?.fileSize && (
                    <View style={styles.audioRow}>
                      <Text style={styles.audioLabel}>File Size:</Text>
                      <Text style={styles.audioValue}>
                        {(interview.audioRecording.fileSize / 1024 / 1024).toFixed(2)} MB
                      </Text>
                    </View>
                  )}
                  {sound && audioDuration > 0 ? (
                    <View style={styles.audioPlayerRow}>
                      <TouchableOpacity 
                        style={[styles.playButtonInline, isLoadingAudio && styles.disabledButton]} 
                        onPress={handlePlayAudio}
                        disabled={isLoadingAudio}
                      >
                        <Ionicons 
                          name={isLoadingAudio ? "hourglass" : (isPlaying ? "pause" : "play")} 
                          size={18} 
                          color="#ffffff" 
                        />
                        <Text style={styles.playButtonTextInline}>
                          {isLoadingAudio ? "Loading..." : (isPlaying ? "Pause" : "Play")}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.audioTime}>
                        {formatTime(audioPosition)}
                      </Text>
                      <View style={styles.audioTimeline}>
                        <View 
                          style={[
                            styles.audioTimelineProgress,
                            { width: `${audioDuration > 0 ? (audioPosition / audioDuration) * 100 : 0}%` }
                          ]}
                        />
                      </View>
                      <Text style={styles.audioTime}>
                        {formatTime(audioDuration)}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={[styles.playButton, isLoadingAudio && styles.disabledButton]} 
                      onPress={handlePlayAudio}
                      disabled={isLoadingAudio}
                    >
                      <Ionicons 
                        name={isLoadingAudio ? "hourglass" : (isPlaying ? "pause" : "play")} 
                        size={20} 
                        color="#ffffff" 
                      />
                      <Text style={styles.playButtonText}>
                        {isLoadingAudio ? "Loading..." : (isPlaying ? "Pause Audio" : "Play Audio")}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {/* Quality Metrics */}
        {interview.qualityMetrics && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quality Metrics</Text>
            <View style={styles.infoCard}>
              <View style={styles.qualityRow}>
                <Text style={styles.qualityLabel}>Data Quality Score:</Text>
                <Text style={styles.qualityValue}>{interview.qualityMetrics.dataQualityScore}%</Text>
              </View>
              <View style={styles.qualityRow}>
                <Text style={styles.qualityLabel}>Average Response Time:</Text>
                <Text style={styles.qualityValue}>{interview.qualityMetrics.averageResponseTime}s</Text>
              </View>
              <View style={styles.qualityRow}>
                <Text style={styles.qualityLabel}>Back Navigation:</Text>
                <Text style={styles.qualityValue}>{interview.qualityMetrics.backNavigationCount}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Verification Data */}
        {interview.verificationData && Object.keys(interview.verificationData).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Verification Data</Text>
            <View style={styles.infoCard}>
              {interview.verificationData.audioQuality && (
                <View style={styles.verificationRow}>
                  <Text style={styles.verificationLabel}>Audio Quality:</Text>
                  <Text style={styles.verificationValue}>{interview.verificationData.audioQuality}/5</Text>
                </View>
              )}
              {interview.verificationData.dataAccuracy && (
                <View style={styles.verificationRow}>
                  <Text style={styles.verificationLabel}>Data Accuracy:</Text>
                  <Text style={styles.verificationValue}>{interview.verificationData.dataAccuracy}</Text>
                </View>
              )}
              {interview.verificationData.feedback && (
                <View style={styles.verificationRow}>
                  <Text style={styles.verificationLabel}>Feedback:</Text>
                  <Text style={styles.verificationValue}>{interview.verificationData.feedback}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Rejection Reason - Only show if status is Rejected */}
        {interview.status === 'Rejected' && interview.verificationData && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rejection Reason</Text>
            <View style={[styles.infoCard, { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1 }]}>
              {interview.verificationData.feedback && (
                <View style={styles.verificationRow}>
                  <Text style={[styles.verificationLabel, { color: '#991b1b' }]}>Reason:</Text>
                  <Text style={[styles.verificationValue, { color: '#7f1d1d', flex: 1, textAlign: 'right' }]}>
                    {interview.verificationData.feedback}
                  </Text>
                </View>
              )}
              {(() => {
                const failedQuestions = getFailedQuestions(interview.verificationData, interview.survey);
                if (failedQuestions.length > 0) {
                  return (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.verificationLabel, { color: '#991b1b', marginBottom: 8, fontWeight: '600' }]}>
                        Questions that failed quality review:
                      </Text>
                      {failedQuestions.map((failed, index) => (
                        <View key={index} style={{ marginBottom: 8, paddingLeft: 8 }}>
                          <Text style={[styles.verificationValue, { color: '#7f1d1d', fontWeight: '500' }]}>
                            • {failed.questionText}
                          </Text>
                          {failed.reason && (
                            <Text style={[styles.verificationValue, { color: '#991b1b', fontSize: 12, marginTop: 2, marginLeft: 8 }]}>
                              {failed.reason}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  );
                }
                return null;
              })()}
            </View>
          </View>
        )}

        {/* Responses */}
        {interview.responses && interview.responses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interview Responses</Text>
            <View style={styles.responsesContainer}>
              {interview.responses.map((response, index) => renderResponseItem(response, index))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  surveyName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  surveyDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  surveyMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryChip: {
    borderRadius: 16,
  },
  modeChip: {
    borderRadius: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  statusChip: {
    borderRadius: 16,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  durationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  durationLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  durationValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '600',
  },
  timingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timingLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  timingValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  locationValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  mapButtonText: {
    color: '#3b82f6',
    fontWeight: '500',
    marginLeft: 8,
  },
  audioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  audioLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  audioValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  playButtonText: {
    color: '#ffffff',
    fontWeight: '500',
    marginLeft: 8,
  },
  playButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginRight: 8,
  },
  playButtonTextInline: {
    color: '#ffffff',
    fontWeight: '500',
    marginLeft: 6,
    fontSize: 14,
  },
  audioPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  audioTime: {
    fontSize: 12,
    color: '#6b7280',
    minWidth: 45,
    textAlign: 'center',
  },
  audioTimeline: {
    flex: 1,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    position: 'relative',
  },
  audioTimelineProgress: {
    height: 4,
    backgroundColor: '#3b82f6',
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  disabledButton: {
    backgroundColor: '#9ca3af',
    opacity: 0.6,
  },
  qualityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  qualityLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  qualityValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  verificationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  verificationLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  verificationValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  responsesContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  responseItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  questionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  answerText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  skippedText: {
    color: '#f59e0b',
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 50,
  },
});

export default InterviewDetails;

