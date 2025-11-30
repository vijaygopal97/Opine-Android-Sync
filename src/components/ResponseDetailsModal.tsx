import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import {
  Text,
  Card,
  Button,
  TextInput,
  RadioButton,
  Divider,
  ActivityIndicator,
  Snackbar,
} from 'react-native-paper';
import { apiService } from '../services/api';

const { width, height } = Dimensions.get('window');

interface ResponseDetailsModalProps {
  visible: boolean;
  interview: any;
  onClose: () => void;
  onSubmit: (verificationData: any) => void;
  assignmentExpiresAt?: Date | null;
}

export default function ResponseDetailsModal({
  visible,
  interview,
  onClose,
  onSubmit,
  assignmentExpiresAt
}: ResponseDetailsModalProps) {
  const [verificationForm, setVerificationForm] = useState({
    audioStatus: '',
    genderMatching: '',
    upcomingElectionsMatching: '',
    previousElectionsMatching: '',
    previousLoksabhaElectionsMatching: '',
    nameMatching: '',
    ageMatching: '',
    phoneNumberAsked: '',
    customFeedback: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [audioSound, setAudioSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPosition, setAudioPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const sliderRef = useRef<View>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [catiCallDetails, setCatiCallDetails] = useState<any>(null);
  const [catiRecordingUri, setCatiRecordingUri] = useState<string | null>(null);
  const [loadingCatiRecording, setLoadingCatiRecording] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    if (visible && interview) {
      // Load audio if CAPI interview has audio recording
      const audioUrl = interview.metadata?.audioRecording?.audioUrl || 
                      interview.audioUrl || 
                      interview.audioRecording?.url ||
                      interview.audioRecording?.audioUrl;
      
      if (interview.interviewMode === 'capi' && audioUrl) {
        loadAudio(audioUrl);
      }
      
      // Fetch CATI call details if CATI interview
      if (interview.interviewMode === 'cati' && interview.call_id) {
        fetchCatiCallDetails(interview.call_id);
      }
    } else {
      // Stop and cleanup audio when modal closes
      if (audioSound) {
        stopAudio();
        audioSound.unloadAsync().catch(console.error);
        setAudioSound(null);
      }
    }

    return () => {
      // Cleanup audio on unmount
      if (audioSound) {
        audioSound.unloadAsync().catch(console.error);
      }
    };
  }, [visible, interview?.responseId]);

  const fetchCatiCallDetails = async (callId: string) => {
    try {
      const result = await apiService.getCatiCallById(callId);
      if (result.success && result.data) {
        setCatiCallDetails(result.data);
        // Fetch recording if available
        if (result.data.recordingUrl || result.data._id) {
          await fetchCatiRecording(result.data._id || callId);
        }
      }
    } catch (error) {
      console.error('Error fetching CATI call details:', error);
    }
  };

  const fetchCatiRecording = async (callId: string) => {
    try {
      setLoadingCatiRecording(true);
      const result = await apiService.getCatiRecording(callId);
      if (result.success && result.blob) {
        // For React Native, we need to convert blob to a playable URI
        // This would typically require saving to file system or using a different approach
        // For now, we'll handle it differently - the API should return a direct URL
        showSnackbar('Recording available - playback will be implemented');
      }
    } catch (error) {
      console.error('Error fetching CATI recording:', error);
    } finally {
      setLoadingCatiRecording(false);
    }
  };

  const loadAudio = async (audioUrl: string) => {
    try {
      if (audioSound) {
        await audioSound.unloadAsync();
        setAudioSound(null);
      }

      // Construct full URL if needed
      let fullAudioUrl = audioUrl;
      if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
        // If it's a relative URL, prepend the base URL
        const API_BASE_URL = 'https://opine.exypnossolutions.com';
        fullAudioUrl = `${API_BASE_URL}${audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl}`;
      }

      console.log('Loading audio from URL:', fullAudioUrl);

      const { sound } = await Audio.Sound.createAsync(
        { uri: fullAudioUrl },
        { shouldPlay: false }
      );

      setAudioSound(sound);
      
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        setAudioDuration(status.durationMillis || 0);
      }

      // Listen to playback status
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && !isSeeking) {
          setIsPlaying(status.isPlaying);
          setAudioPosition(status.positionMillis || 0);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setAudioPosition(0);
          }
        }
      });
    } catch (error) {
      console.error('Error loading audio:', error);
      showSnackbar('Failed to load audio recording');
    }
  };

  const playAudio = async () => {
    try {
      if (!audioSound) {
        // Try to get audio URL from various possible locations
        const audioUrl = interview.metadata?.audioRecording?.audioUrl || 
                        interview.audioUrl || 
                        interview.audioRecording?.url ||
                        interview.audioRecording?.audioUrl;
        if (audioUrl) {
          await loadAudio(audioUrl);
          // After loading, play it
          if (audioSound) {
            await audioSound.playAsync();
          }
          return;
        }
        showSnackbar('No audio recording available');
        return;
      }

      if (isPlaying) {
        await audioSound.pauseAsync();
      } else {
        await audioSound.playAsync();
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      showSnackbar('Failed to play audio. Please check your connection.');
    }
  };

  const stopAudio = async () => {
    if (audioSound) {
      try {
        await audioSound.stopAsync();
        await audioSound.setPositionAsync(0);
        setIsPlaying(false);
        setAudioPosition(0);
      } catch (error) {
        console.error('Error stopping audio:', error);
      }
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSeek = async (positionMillis: number) => {
    if (!audioSound || audioDuration === 0) return;
    
    try {
      const clampedPosition = Math.max(0, Math.min(positionMillis, audioDuration));
      await audioSound.setPositionAsync(clampedPosition);
      setAudioPosition(clampedPosition);
    } catch (error) {
      console.error('Error seeking audio:', error);
    } finally {
      setIsSeeking(false);
    }
  };

  const handleSliderPress = (event: any) => {
    if (!sliderRef.current || sliderWidth === 0 || audioDuration === 0) return;
    
    const { locationX } = event.nativeEvent;
    const percentage = Math.max(0, Math.min(1, locationX / sliderWidth));
    const positionMillis = Math.floor(percentage * audioDuration);
    handleSeek(positionMillis);
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      setIsSeeking(true);
      if (sliderWidth === 0 || audioDuration === 0) return;
      const { locationX } = event.nativeEvent;
      const percentage = Math.max(0, Math.min(1, locationX / sliderWidth));
      const positionMillis = Math.floor(percentage * audioDuration);
      setAudioPosition(positionMillis);
    },
    onPanResponderMove: (event) => {
      if (sliderWidth === 0 || audioDuration === 0) return;
      const { locationX } = event.nativeEvent;
      const percentage = Math.max(0, Math.min(1, locationX / sliderWidth));
      const positionMillis = Math.floor(percentage * audioDuration);
      setAudioPosition(positionMillis);
    },
    onPanResponderRelease: (event) => {
      if (sliderWidth === 0 || audioDuration === 0) {
        setIsSeeking(false);
        return;
      }
      const { locationX } = event.nativeEvent;
      const percentage = Math.max(0, Math.min(1, locationX / sliderWidth));
      const positionMillis = Math.floor(percentage * audioDuration);
      handleSeek(positionMillis);
    },
  });

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  const handleVerificationFormChange = (field: string, value: string) => {
    setVerificationForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const isVerificationFormValid = () => {
    return verificationForm.audioStatus !== '' &&
           verificationForm.genderMatching !== '' &&
           verificationForm.upcomingElectionsMatching !== '' &&
           verificationForm.previousElectionsMatching !== '' &&
           verificationForm.previousLoksabhaElectionsMatching !== '' &&
           verificationForm.nameMatching !== '' &&
           verificationForm.ageMatching !== '' &&
           verificationForm.phoneNumberAsked !== '';
  };

  const getApprovalStatus = () => {
    const audioStatus = verificationForm.audioStatus;
    if (audioStatus !== '1' && audioStatus !== '4' && audioStatus !== '7') {
      return 'rejected';
    }
    
    if (verificationForm.genderMatching !== '1') {
      return 'rejected';
    }
    
    if (verificationForm.upcomingElectionsMatching !== '1' && 
        verificationForm.upcomingElectionsMatching !== '3') {
      return 'rejected';
    }
    
    if (verificationForm.previousElectionsMatching !== '1' && 
        verificationForm.previousElectionsMatching !== '3') {
      return 'rejected';
    }
    
    if (verificationForm.previousLoksabhaElectionsMatching !== '1' && 
        verificationForm.previousLoksabhaElectionsMatching !== '3') {
      return 'rejected';
    }
    
    if (verificationForm.nameMatching !== '1' && 
        verificationForm.nameMatching !== '3') {
      return 'rejected';
    }
    
    if (verificationForm.ageMatching !== '1' && 
        verificationForm.ageMatching !== '3') {
      return 'rejected';
    }
    
    return 'approved';
  };

  const handleSubmit = async () => {
    if (!isVerificationFormValid()) {
      showSnackbar('Please answer all required questions before submitting');
      return;
    }

    try {
      setIsSubmitting(true);
      
      const approvalStatus = getApprovalStatus();
      const verificationData = {
        responseId: interview.responseId,
        status: approvalStatus,
        verificationCriteria: {
          audioStatus: verificationForm.audioStatus,
          genderMatching: verificationForm.genderMatching,
          upcomingElectionsMatching: verificationForm.upcomingElectionsMatching,
          previousElectionsMatching: verificationForm.previousElectionsMatching,
          previousLoksabhaElectionsMatching: verificationForm.previousLoksabhaElectionsMatching,
          nameMatching: verificationForm.nameMatching,
          ageMatching: verificationForm.ageMatching,
          phoneNumberAsked: verificationForm.phoneNumberAsked
        },
        feedback: verificationForm.customFeedback || ''
      };

      await onSubmit(verificationData);
    } catch (error: any) {
      console.error('Error submitting verification:', error);
      showSnackbar('Failed to submit verification. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRespondentInfo = () => {
    const responses = interview.responses || [];
    const nameResponse = responses.find((r: any) => 
      r.questionText?.toLowerCase().includes('name') || 
      r.questionText?.toLowerCase().includes('respondent')
    );
    const genderResponse = responses.find((r: any) => 
      r.questionText?.toLowerCase().includes('gender') || 
      r.questionText?.toLowerCase().includes('sex')
    );
    const ageResponse = responses.find((r: any) => 
      r.questionText?.toLowerCase().includes('age') || 
      r.questionText?.toLowerCase().includes('year')
    );

    const extractValue = (response: any) => {
      if (!response || !response.response) return null;
      if (Array.isArray(response.response)) {
        return response.response.length > 0 ? response.response[0] : null;
      }
      return response.response;
    };

    return {
      name: extractValue(nameResponse) || 'Not Available',
      gender: extractValue(genderResponse) || 'Not Available',
      age: extractValue(ageResponse) || 'Not Available'
    };
  };

  const formatResponseDisplay = (response: any, question: any) => {
    if (!response || response === null || response === undefined) {
      return 'No response';
    }

    if (Array.isArray(response)) {
      if (response.length === 0) return 'No selections';
      
      const displayTexts = response.map((value: any) => {
        if (typeof value === 'string' && value.startsWith('Others: ')) {
          return value;
        }
        
        if (question && question.options) {
          const option = question.options.find((opt: any) => opt.value === value);
          return option ? option.text : value;
        }
        return value;
      });
      
      return displayTexts.join(', ');
    }

    if (typeof response === 'string' || typeof response === 'number') {
      if (typeof response === 'string' && response.startsWith('Others: ')) {
        return response;
      }
      
      if (question && question.options) {
        const option = question.options.find((opt: any) => opt.value === response);
        return option ? option.text : response.toString();
      }
      return response.toString();
    }

    return JSON.stringify(response);
  };

  const findQuestionByText = (questionText: string, survey: any) => {
    if (survey?.sections) {
      for (const section of survey.sections) {
        if (section.questions) {
          for (const question of section.questions) {
            if (question.text === questionText) {
              return question;
            }
          }
        }
      }
    }
    return null;
  };

  const respondentInfo = getRespondentInfo();
  const survey = interview.survey || interview.survey?.survey;

  if (!interview) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Header - Fixed at top */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Response Details</Text>
          <Button
            mode="text"
            onPress={onClose}
            icon="close"
            textColor="#6b7280"
            compact
          >
            Close
          </Button>
        </View>

        <Divider style={styles.divider} />

        {/* Scrollable Content */}
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
            {/* Interview Info */}
            <Card style={styles.card}>
              <Card.Content>
                <Text style={styles.sectionTitle}>Interview Information</Text>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Survey:</Text>
                  <Text style={styles.infoValue}>{survey?.surveyName || 'N/A'}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Response ID:</Text>
                  <Text style={styles.infoValue}>{interview.responseId || 'N/A'}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Mode:</Text>
                  <Text style={styles.infoValue}>{(interview.interviewMode || 'CAPI').toUpperCase()}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Duration:</Text>
                  <Text style={styles.infoValue}>
                    {interview.totalTimeSpent 
                      ? `${Math.floor(interview.totalTimeSpent / 60)}m ${interview.totalTimeSpent % 60}s`
                      : 'N/A'}
                  </Text>
                </View>
                
                {interview.selectedAC && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Assembly Constituency:</Text>
                    <Text style={styles.infoValue}>{interview.selectedAC}</Text>
                  </View>
                )}
                
                {interview.selectedPollingStation?.stationName && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Polling Station:</Text>
                    <Text style={styles.infoValue}>
                      {interview.selectedPollingStation.stationName}
                    </Text>
                  </View>
                )}
              </Card.Content>
            </Card>

            {/* Respondent Info */}
            <Card style={styles.card}>
              <Card.Content>
                <Text style={styles.sectionTitle}>Respondent Information</Text>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Name:</Text>
                  <Text style={styles.infoValue}>{respondentInfo.name}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Gender:</Text>
                  <Text style={styles.infoValue}>{respondentInfo.gender}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Age:</Text>
                  <Text style={styles.infoValue}>{respondentInfo.age}</Text>
                </View>
              </Card.Content>
            </Card>

            {/* Audio Recording (CAPI) */}
            {interview.interviewMode === 'capi' && (
              <Card style={styles.card}>
                <Card.Content>
                  <Text style={styles.sectionTitle}>Audio Recording</Text>
                  
                  {(interview.metadata?.audioRecording?.audioUrl || 
                    interview.audioUrl || 
                    interview.audioRecording?.url ||
                    interview.audioRecording?.audioUrl) ? (
                    <View style={styles.audioControls}>
                      <Button
                        mode="contained"
                        onPress={playAudio}
                        icon={isPlaying ? "pause" : "play"}
                        style={styles.audioButton}
                      >
                        {isPlaying ? 'Pause' : 'Play'}
                      </Button>
                      
                      {audioDuration > 0 && (
                        <View style={styles.audioTimelineContainer}>
                          <Text style={styles.audioTime}>
                            {formatTime(audioPosition)}
                          </Text>
                          <TouchableOpacity
                            activeOpacity={1}
                            style={styles.sliderContainer}
                            onLayout={(event) => {
                              const { width } = event.nativeEvent.layout;
                              setSliderWidth(width);
                            }}
                            onPress={handleSliderPress}
                            {...panResponder.panHandlers}
                          >
                            <View 
                              ref={sliderRef}
                              style={styles.sliderTrack}
                            >
                              <View 
                                style={[
                                  styles.sliderProgress,
                                  { width: `${audioDuration > 0 ? (audioPosition / audioDuration) * 100 : 0}%` }
                                ]}
                              />
                              <View
                                style={[
                                  styles.sliderThumb,
                                  { left: `${audioDuration > 0 ? (audioPosition / audioDuration) * 100 : 0}%` }
                                ]}
                              />
                            </View>
                          </TouchableOpacity>
                          <Text style={styles.audioTime}>
                            {formatTime(audioDuration)}
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.noDataText}>No audio recording available</Text>
                  )}
                </Card.Content>
              </Card>
            )}

            {/* CATI Call Recording */}
            {interview.interviewMode === 'cati' && (
              <Card style={styles.card}>
                <Card.Content>
                  <Text style={styles.sectionTitle}>Call Information</Text>
                  
                  {loadingCatiRecording ? (
                    <ActivityIndicator size="small" color="#2563eb" />
                  ) : catiCallDetails ? (
                    <View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Call ID:</Text>
                        <Text style={styles.infoValue}>{catiCallDetails.callId || 'N/A'}</Text>
                      </View>
                      
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Status:</Text>
                        <Text style={styles.infoValue}>{catiCallDetails.callStatus || 'N/A'}</Text>
                      </View>
                      
                      {catiCallDetails.recordingUrl && (
                        <Text style={styles.infoValue}>Recording available</Text>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.infoValue}>Call details not available</Text>
                  )}
                </Card.Content>
              </Card>
            )}

            {/* Responses */}
            <Card style={styles.card}>
              <Card.Content>
                <Text style={styles.sectionTitle}>Responses</Text>
                
                {interview.responses && interview.responses.length > 0 ? (
                  interview.responses
                    .filter((r: any) => {
                      // Filter out AC and polling station questions
                      const questionText = r.questionText || '';
                      return !questionText.toLowerCase().includes('select assembly constituency') &&
                             !questionText.toLowerCase().includes('select polling station');
                    })
                    .map((response: any, index: number) => {
                      const question = findQuestionByText(response.questionText, survey);
                      return (
                        <View key={index} style={styles.responseItem}>
                          <Text style={styles.questionText}>
                            Q{index + 1}: {response.questionText}
                          </Text>
                          <Text style={styles.responseText}>
                            {formatResponseDisplay(response.response, question)}
                          </Text>
                        </View>
                      );
                    })
                ) : (
                  <Text style={styles.noDataText}>No responses available</Text>
                )}
              </Card.Content>
            </Card>

            {/* Verification Form */}
            <Card style={styles.card}>
              <Card.Content>
                <Text style={styles.sectionTitle}>Quality Verification</Text>
                
                {/* Audio Status */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>1. Audio status (অডিও স্ট্যাটাস) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('audioStatus', value)}
                    value={verificationForm.audioStatus}
                  >
                    <RadioButton.Item 
                      label="1 - Survey Conversation can be heard (জরিপের কথোপকথন শোনা যাচ্ছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - No Conversation (কোনো কথোপকথন নেই)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Irrelevant Conversation (অপ্রাসঙ্গিক কথোপকথন)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Can hear the interviewer more than the respondent (সাক্ষাৎকারগ্রহণকারীর কণ্ঠস্বর উত্তরদাতার তুলনায় বেশি শোনা যাচ্ছে)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="7 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="7" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="8 - Duplicate Audio (ডুপ্লিকেট অডিও)" 
                      value="8" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Gender Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>2. Gender of the Respondent Matching? (উত্তরদাতার লিঙ্গ কি মেলানো হয়েছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('genderMatching', value)}
                    value={verificationForm.genderMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Male answering on behalf of female (মহিলার পক্ষ থেকে পুরুষ উত্তর দিচ্ছেন।)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Upcoming Elections Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>3. Is the Response Matching for the Upcoming Elections preference (Q8)? (উত্তরটি কি আসন্ন নির্বাচনের পছন্দ (প্রশ্ন ৮) এর সাথে মিলে যাচ্ছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('upcomingElectionsMatching', value)}
                    value={verificationForm.upcomingElectionsMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Previous Elections Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>4. Is the Response Matching for the Previous 2021 Assembly Election (Q5)? (উত্তরটি কি ২০২১ সালের পূর্ববর্তী বিধানসভা নির্বাচনের (প্রশ্ন ৫) সাথে মিলে যাচ্ছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('previousElectionsMatching', value)}
                    value={verificationForm.previousElectionsMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Previous Loksabha Elections Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>5. Is the Response Matching for the Previous 2024 Loksabha Election (Q6)? (উত্তরটি কি ২০২৪ সালের পূর্ববর্তী লোকসভা নির্বাচনের (প্রশ্ন ৬) সাথে মিলে যাচ্ছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('previousLoksabhaElectionsMatching', value)}
                    value={verificationForm.previousLoksabhaElectionsMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Name Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>6. Name of the Respondent Matching? (উত্তরদাতার নাম কি মিলে গেছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('nameMatching', value)}
                    value={verificationForm.nameMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Age Matching */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>7. Is the Age matching? (বয়স কি মিলে গেছে?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('ageMatching', value)}
                    value={verificationForm.ageMatching}
                  >
                    <RadioButton.Item 
                      label="1 - Matched (মিলে গেছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Not Matched (মেলেনি)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Cannot hear the response clearly (উত্তর স্পষ্টভাবে শোনা যাচ্ছে না)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="4 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="4" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Phone Number Asked */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>8. Did the interviewer ask the phone number of the respondent? (সাক্ষাৎকারগ্রহণকারী কি উত্তরদাতার ফোন নম্বর জিজ্ঞাসা করেছিলেন?) *</Text>
                  <RadioButton.Group
                    onValueChange={(value) => handleVerificationFormChange('phoneNumberAsked', value)}
                    value={verificationForm.phoneNumberAsked}
                  >
                    <RadioButton.Item 
                      label="1 - Asked the number and noted in the questionnaire (নম্বরটি জিজ্ঞাসা করে প্রশ্নপত্রে নোট করা হয়েছে)" 
                      value="1" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="2 - Asked the question but the respondent refused to share (প্রশ্নটি করা হয়েছে কিন্তু উত্তরদাতা শেয়ার করতে অস্বীকার করেছেন)" 
                      value="2" 
                      style={styles.radioItem}
                    />
                    <RadioButton.Item 
                      label="3 - Did not ask (জিজ্ঞাসা করা হয়নি)" 
                      value="3" 
                      style={styles.radioItem}
                    />
                  </RadioButton.Group>
                </View>

                {/* Custom Feedback */}
                <View style={styles.formSection}>
                  <Text style={styles.formLabel}>9. Additional Feedback (Optional)</Text>
                  <TextInput
                    mode="outlined"
                    multiline
                    numberOfLines={4}
                    placeholder="Enter any additional feedback..."
                    value={verificationForm.customFeedback}
                    onChangeText={(text) => handleVerificationFormChange('customFeedback', text)}
                    style={styles.feedbackInput}
                  />
                </View>

                {/* Submit Button */}
                <Button
                  mode="contained"
                  onPress={handleSubmit}
                  style={styles.submitButton}
                  loading={isSubmitting}
                  disabled={!isVerificationFormValid() || isSubmitting}
                >
                  Submit Verification
                </Button>
              </Card.Content>
            </Card>
          </ScrollView>

        <Snackbar
          visible={snackbarVisible}
          onDismiss={() => setSnackbarVisible(false)}
          duration={3000}
          style={styles.snackbar}
        >
          {snackbarMessage}
        </Snackbar>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  divider: {
    height: 0,
  },
  card: {
    marginBottom: 16,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
    width: 140,
  },
  infoValue: {
    fontSize: 14,
    color: '#1f2937',
    flex: 1,
  },
  audioControls: {
    marginTop: 12,
  },
  audioButton: {
    minWidth: 100,
    marginBottom: 12,
  },
  audioTimelineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 8,
    marginTop: 8,
  },
  sliderContainer: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    position: 'relative',
    width: '100%',
  },
  sliderProgress: {
    height: 4,
    backgroundColor: '#2563eb',
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    position: 'absolute',
    top: -6,
    marginLeft: -8,
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  audioTime: {
    fontSize: 12,
    color: '#6b7280',
    minWidth: 50,
    textAlign: 'center',
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
    color: '#374151',
    marginBottom: 8,
  },
  responseText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  noDataText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  formSection: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    lineHeight: 20,
  },
  radioItem: {
    paddingVertical: 4,
    marginVertical: 0,
  },
  feedbackInput: {
    marginTop: 8,
  },
  submitButton: {
    marginTop: 20,
    backgroundColor: '#2563eb',
  },
  snackbar: {
    backgroundColor: '#1f2937',
  },
});

