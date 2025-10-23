import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  TextInput,
  RadioButton,
  Checkbox,
  Snackbar,
  ActivityIndicator,
  ProgressBar,
  Chip,
  Menu,
  Divider,
} from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { apiService } from '../services/api';
import { LocationService } from '../utils/location';
import { Survey, SurveyResponse } from '../types';

const { width, height } = Dimensions.get('window');

// Simple audio recorder
// Global recording instance
let globalRecording: Audio.Recording | null = null;

export default function InterviewInterface({ navigation, route }: any) {
  const { survey, responseId, isContinuing } = route.params;
  
  // State management
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [locationData, setLocationData] = useState<any>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [duration, setDuration] = useState(0);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [response, setResponse] = useState<SurveyResponse | null>(null);
  
  // Interview session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  
  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [recording, setRecording] = useState<any>(null);
  const [audioPermission, setAudioPermission] = useState<boolean | null>(null);
  const [isCreatingRecording, setIsCreatingRecording] = useState(false);
  
  // AC selection state
  const [selectedAC, setSelectedAC] = useState<string | null>(null);
  const [assignedACs, setAssignedACs] = useState<string[]>([]);
  const [requiresACSelection, setRequiresACSelection] = useState(false);

  // Get all questions from all sections
  const allQuestions = useMemo(() => {
    const questions = [];
    
    // Check if AC selection is required
    const needsACSelection = requiresACSelection && assignedACs.length > 0;
    
    // Add AC selection question as first question if required
    if (needsACSelection) {
      const acQuestion = {
        id: 'ac-selection',
        type: 'single_choice',
        text: 'Select Assembly Constituency',
        description: 'Please select the Assembly Constituency where you are conducting this interview.',
        required: true,
        order: -1, // Make it appear first
        options: assignedACs.map(ac => ({
          id: `ac-${ac}`,
          text: ac,
          value: ac
        })),
        sectionIndex: -1, // Special section for AC selection
        questionIndex: -1,
        sectionId: 'ac-selection',
        sectionTitle: 'Assembly Constituency Selection',
        isACSelection: true // Flag to identify this special question
      };
      questions.push(acQuestion);
    }
    
    // Add regular survey questions
    if (survey.sections) {
      survey.sections.forEach((section: any, sectionIndex: number) => {
        section.questions.forEach((question: any, questionIndex: number) => {
          questions.push({
            ...question,
            sectionIndex,
            questionIndex,
            sectionId: section.id,
            sectionTitle: section.title
          });
        });
      });
    }
    
    return questions;
  }, [survey.sections, requiresACSelection, assignedACs]);

  // Helper function to check if response has content
  const hasResponseContent = (response: any): boolean => {
    if (response === null || response === undefined) return false;
    if (typeof response === 'string') return response.trim().length > 0;
    if (Array.isArray(response)) return response.length > 0;
    if (typeof response === 'number') return !isNaN(response);
    return true;
  };

  // Evaluate conditional logic for a question
  const evaluateConditions = useCallback((question: any) => {
    if (!question.conditions || question.conditions.length === 0) {
      return true;
    }

    const results = question.conditions.map((condition: any) => {
      const response = responses[condition.questionId];
      
      if (response === undefined || response === null) {
        return false;
      }

      let met = false;

      switch (condition.operator) {
        case 'equals':
          met = String(response).toLowerCase() === String(condition.value).toLowerCase();
          break;
        case 'not_equals':
          met = String(response).toLowerCase() !== String(condition.value).toLowerCase();
          break;
        case 'contains':
          met = String(response).toLowerCase().includes(condition.value.toLowerCase());
          break;
        case 'not_contains':
          met = !String(response).toLowerCase().includes(condition.value.toLowerCase());
          break;
        case 'greater_than':
          met = parseFloat(response) > parseFloat(condition.value);
          break;
        case 'less_than':
          met = parseFloat(response) < parseFloat(condition.value);
          break;
        case 'is_empty':
          met = !hasResponseContent(response);
          break;
        case 'is_not_empty':
          met = hasResponseContent(response);
          break;
        case 'is_selected':
          if (Array.isArray(response)) {
            met = response.some(r => String(r).toLowerCase() === String(condition.value).toLowerCase());
          } else {
            met = String(response).toLowerCase() === String(condition.value).toLowerCase();
          }
          break;
        case 'is_not_selected':
          if (Array.isArray(response)) {
            met = !response.some(r => String(r).toLowerCase() === String(condition.value).toLowerCase());
          } else {
            met = String(response).toLowerCase() !== String(condition.value).toLowerCase();
          }
          break;
        default:
          met = false;
      }

      return met;
    });

    // Handle AND/OR logic between conditions
    if (results.length === 1) {
      return results[0];
    }

    let finalResult = results[0];
    for (let i = 1; i < results.length; i++) {
      const logic = question.conditions[i].logic || 'AND';
      if (logic === 'AND') {
        finalResult = finalResult && results[i];
      } else if (logic === 'OR') {
        finalResult = finalResult || results[i];
      }
    }

    return finalResult;
  }, [responses]);

  // Get visible questions based on conditional logic
  const visibleQuestions = useMemo(() => {
    return allQuestions.filter((question: any) => evaluateConditions(question));
  }, [allQuestions, evaluateConditions]);

  const currentQuestion = visibleQuestions[currentQuestionIndex];
  const progress = (currentQuestionIndex + 1) / visibleQuestions.length;

  // Check audio permissions
  useEffect(() => {
    const checkAudioPermission = async () => {
      try {
        // For now, assume permission is granted
        setAudioPermission(true);
      } catch (error) {
        console.error('Error checking audio permission:', error);
        setAudioPermission(false);
      }
    };

    checkAudioPermission();
  }, []);

  // Initialize interview
  useEffect(() => {
    const initializeInterview = async () => {
      setIsLoading(true);
      try {
        // Get location
        setLocationLoading(true);
        const location = await LocationService.getCurrentLocation();
        setLocationData(location);
        setLocationLoading(false);

        // Start timing
        setStartTime(new Date());

        // Start interview session
        const result = await apiService.startInterview(survey._id);
        if (result.success) {
          setSessionId(result.response.sessionId);
          setSessionData(result.response);
          setIsInterviewActive(true);
          
          // Check for AC assignment
          console.log('Session data loaded:', result.response);
          const needsACSelection = result.response.requiresACSelection && 
                                   result.response.assignedACs && 
                                   result.response.assignedACs.length > 0;
          
          console.log('AC Selection required:', needsACSelection);
          console.log('Assigned ACs:', result.response.assignedACs);
          
          setRequiresACSelection(needsACSelection);
          setAssignedACs(result.response.assignedACs || []);
          
          // Start audio recording automatically for CAPI mode
          if (survey.mode === 'capi' && audioPermission && !isRecording) {
            console.log('Auto-starting audio recording for CAPI mode...');
            // Add a longer delay to ensure component is fully mounted and ready
            setTimeout(() => {
              console.log('Attempting to start recording after delay...');
              startAudioRecording();
            }, 2000);
          }
        } else {
          showSnackbar('Failed to start interview');
        }
      } catch (error) {
        console.error('Error initializing interview:', error);
        showSnackbar('Failed to initialize interview');
      } finally {
        setIsLoading(false);
      }
    };

    initializeInterview();
  }, [survey, audioPermission]);

  // Update duration
  useEffect(() => {
    if (!startTime || isPaused) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      setDuration(diff);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isPaused]);

  // Cleanup recording on component unmount
  useEffect(() => {
    return () => {
      cleanupRecording().catch(console.error);
    };
  }, []);

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  // Simple cleanup function
  const cleanupRecording = async () => {
    try {
      if (globalRecording) {
        console.log('Cleaning up recording...');
        await globalRecording.stopAndUnloadAsync();
        globalRecording = null;
      }
    } catch (error) {
      console.log('Cleanup error:', error);
    } finally {
      setIsRecording(false);
      setIsAudioPaused(false);
      setAudioUri(null);
    }
  };

  const handleResponseChange = (questionId: string, response: any) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: response
    }));
    
    // Handle AC selection specially
    if (questionId === 'ac-selection') {
      setSelectedAC(response);
      console.log('AC selected:', response);
    }
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < visibleQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const pauseInterview = async () => {
    try {
      setIsPaused(true);
      if (sessionId) {
        await apiService.pauseInterview(sessionId);
      }
      
      // Pause audio recording if active
      if (isRecording && !isAudioPaused) {
        pauseAudioRecording();
      }
      
      showSnackbar('Interview paused');
    } catch (error) {
      console.error('Error pausing interview:', error);
      showSnackbar('Failed to pause interview');
    }
  };

  const resumeInterview = async () => {
    try {
      setIsPaused(false);
      if (sessionId) {
        await apiService.resumeInterview(sessionId);
      }
      
      // Resume audio recording if it was paused
      if (isRecording && isAudioPaused) {
        resumeAudioRecording();
      }
      
      showSnackbar('Interview resumed');
    } catch (error) {
      console.error('Error resuming interview:', error);
      showSnackbar('Failed to resume interview');
    }
  };

  const abandonInterview = async () => {
    try {
      if (sessionId) {
        await apiService.abandonInterview(sessionId);
      }
      showSnackbar('Interview abandoned');
      navigation.navigate('Dashboard');
    } catch (error) {
      console.error('Error abandoning interview:', error);
      showSnackbar('Failed to abandon interview');
    }
  };

  const startAudioRecording = async () => {
    try {
      console.log('=== EXPO-AV AUDIO RECORDING START ===');
      
      if (isRecording) {
        console.log('Already recording, skipping...');
        return;
      }
      
      // Clean up any existing recording
      if (globalRecording) {
        await globalRecording.stopAndUnloadAsync();
        globalRecording = null;
      }
      
      console.log('Requesting audio permissions...');
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Audio permission not granted');
      }
      
      console.log('Setting audio mode...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      
      console.log('Creating recording...');
      const recording = new Audio.Recording();
      globalRecording = recording;
      
      console.log('Preparing recording...');
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });
      
      console.log('Starting recording...');
      await recording.startAsync();
      
      const audioPath = `${FileSystem.documentDirectory}audio_${Date.now()}.m4a`;
      setAudioUri(audioPath);
      setIsRecording(true);
      setIsAudioPaused(false);
      setAudioPermission(true);
      
      console.log('Recording started successfully');
      showSnackbar('Audio recording started');
    } catch (error: any) {
      console.error('Error starting recording:', error);
      showSnackbar(`Failed to start recording: ${error.message}`);
      setAudioPermission(false);
      setIsRecording(false);
      globalRecording = null;
    }
  };

  const stopAudioRecording = async () => {
    try {
      console.log('Stopping audio recording...');
      
      if (!isRecording || !globalRecording) {
        console.log('No recording to stop');
        return null;
      }
      
      console.log('Stopping and unloading recording...');
      await globalRecording.stopAndUnloadAsync();
      
      const uri = globalRecording.getURI();
      console.log('Recording URI:', uri);
      
      setIsRecording(false);
      setIsAudioPaused(false);
      globalRecording = null;
      
      showSnackbar('Audio recording completed');
      return uri;
    } catch (error) {
      console.error('Error stopping recording:', error);
      showSnackbar('Failed to stop recording');
      return null;
    }
  };

  const pauseAudioRecording = async () => {
    try {
      if (isRecording && globalRecording) {
        console.log('Pausing audio recording...');
        await globalRecording.pauseAsync();
        setIsAudioPaused(true);
        showSnackbar('Audio recording paused');
      }
    } catch (error) {
      console.error('Error pausing recording:', error);
      showSnackbar('Failed to pause recording');
    }
  };

  const resumeAudioRecording = async () => {
    try {
      if (isRecording && isAudioPaused && globalRecording) {
        console.log('Resuming audio recording...');
        await globalRecording.startAsync();
        setIsAudioPaused(false);
        showSnackbar('Audio recording resumed');
      }
    } catch (error) {
      console.error('Error resuming recording:', error);
      showSnackbar('Failed to resume recording');
    }
  };

  const completeInterview = async () => {
    if (!sessionId) return;

    try {
      setIsLoading(true);
      
      // Stop audio recording and get audio URI
      let audioUrl = null;
      let currentAudioUri = audioUri;
      
      console.log('Current audioUri state:', audioUri);
      console.log('Is recording:', isRecording);
      
      if (isRecording) {
        // Stop recording and get the real audio file
        console.log('Stopping audio recording...');
        currentAudioUri = await stopAudioRecording();
        console.log('Audio file path from stopRecording:', currentAudioUri);
      }
      
      console.log('Final currentAudioUri:', currentAudioUri);
      
        // Upload audio file if available
        let audioFileSize = 0;
        if (currentAudioUri) {
          console.log('Uploading audio file...', currentAudioUri);
          
          const uploadResult = await apiService.uploadAudioFile(currentAudioUri, sessionId, survey._id);
          if (uploadResult.success) {
            audioUrl = uploadResult.response.audioUrl;
            audioFileSize = uploadResult.response.size || 0;
            console.log('Audio uploaded successfully:', audioUrl, 'Size:', audioFileSize);
            showSnackbar('Audio recording uploaded successfully');
          } else {
            console.error('Failed to upload audio:', uploadResult.message);
            showSnackbar('Failed to upload audio, continuing without audio');
          }
        } else {
          console.log('No audio file to upload');
        }
      
      // Prepare final response data
      const finalResponses = visibleQuestions.map((question: any, index: number) => ({
        sectionIndex: 0,
        questionIndex: index,
        questionId: question.id,
        questionType: question.type,
        questionText: question.text,
        questionDescription: question.description,
        questionOptions: question.options?.map((opt: any) => opt.value) || [],
        response: responses[question.id] || '',
        responseTime: 0,
        isRequired: question.required,
        isSkipped: !responses[question.id]
      }));

      const result = await apiService.completeInterview(sessionId, {
        responses: finalResponses,
        qualityMetrics: {
          averageResponseTime: 1,
          backNavigationCount: 0,
          dataQualityScore: 100,
          totalPauseTime: 0,
          totalPauses: 0
        },
        metadata: {
          survey: survey._id,
          interviewer: sessionData?.interviewer || 'current-user',
          status: 'Pending_Approval',
          sessionId: sessionId,
          startTime: sessionData?.startTime || new Date(),
          endTime: new Date(),
          totalTimeSpent: duration,
          interviewMode: survey.mode || 'capi',
          deviceInfo: {
            userAgent: 'React Native App',
            platform: 'Mobile',
            browser: 'React Native',
            screenResolution: `${width}x${height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
            audioRecording: {
              audioUrl: audioUrl,
              hasAudio: !!audioUrl,
              recordingDuration: Math.round(duration), // Use total interview duration
              format: 'm4a',
              codec: 'aac',
              bitrate: 128000,
              fileSize: audioFileSize, // Use actual file size from upload response
              uploadedAt: audioUrl ? new Date().toISOString() : null
            },
          location: locationData,
          selectedAC: selectedAC, // Include selected AC in response data
          totalQuestions: allQuestions.length,
          answeredQuestions: finalResponses.filter((r: any) => hasResponseContent(r.response)).length,
          skippedQuestions: finalResponses.filter((r: any) => !hasResponseContent(r.response)).length,
          completionPercentage: Math.round((finalResponses.filter((r: any) => hasResponseContent(r.response)).length / allQuestions.length) * 100)
        }
      });

      if (result.success) {
        Alert.alert(
          'Interview Completed',
          `Interview completed successfully! Response ID: ${result.response.responseId}. Your response has been submitted for quality approval.`,
          [
            {
              text: 'OK',
              onPress: () => navigation.navigate('Dashboard')
            }
          ]
        );
      } else {
        showSnackbar('Failed to complete interview');
      }
    } catch (error) {
      console.error('Error completing interview:', error);
      showSnackbar('Failed to complete interview');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Render question based on type
  const renderQuestion = (question: any) => {
    const currentResponse = responses[question.id] || '';

    switch (question.type) {
      case 'text':
      case 'textarea':
        return (
          <TextInput
            mode="outlined"
            value={currentResponse}
            onChangeText={(text) => handleResponseChange(question.id, text)}
            placeholder={`Enter your ${question.type === 'textarea' ? 'detailed ' : ''}response...`}
            style={styles.textInput}
            multiline={question.type === 'textarea'}
            numberOfLines={question.type === 'textarea' ? 6 : 3}
          />
        );

      case 'number':
        return (
          <TextInput
            mode="outlined"
            value={currentResponse?.toString() || ''}
            onChangeText={(text) => handleResponseChange(question.id, parseFloat(text) || 0)}
            placeholder="Enter a number..."
            keyboardType="numeric"
            style={styles.textInput}
          />
        );

      case 'multiple_choice':
        // Check if multiple selections are allowed
        const allowMultiple = question.settings?.allowMultiple || false;
        return (
          <View style={styles.optionsContainer}>
            {question.options?.map((option: any, index: number) => {
              const isSelected = allowMultiple 
                ? (Array.isArray(currentResponse) && currentResponse.includes(option.value))
                : (currentResponse === option.value);
              
              return (
                <View key={option.id || index} style={styles.optionItem}>
                  <Checkbox
                    status={isSelected ? 'checked' : 'unchecked'}
                    onPress={() => {
                      if (allowMultiple) {
                        const currentAnswers = Array.isArray(currentResponse) ? currentResponse : [];
                        const newAnswers = currentAnswers.includes(option.value)
                          ? currentAnswers.filter((a: string) => a !== option.value)
                          : [...currentAnswers, option.value];
                        handleResponseChange(question.id, newAnswers);
                      } else {
                        // Single selection - use radio button behavior
                        handleResponseChange(question.id, option.value);
                      }
                    }}
                  />
                  <Text style={styles.optionText}>{option.text}</Text>
                </View>
              );
            })}
          </View>
        );

      case 'single_choice':
      case 'single_select':
        return (
          <View style={styles.optionsContainer}>
            {question.options?.map((option: any, index: number) => (
              <View key={option.id || index} style={styles.optionItem}>
                <RadioButton
                  value={option.value}
                  status={currentResponse === option.value ? 'checked' : 'unchecked'}
                  onPress={() => handleResponseChange(question.id, option.value)}
                />
                <Text style={styles.optionText}>{option.text}</Text>
              </View>
            ))}
          </View>
        );

      case 'dropdown':
        return (
          <View style={styles.dropdownContainer}>
            <Text style={styles.dropdownText}>
              Dropdown: {currentResponse || 'Select an option...'}
            </Text>
            <Button
              mode="outlined"
              onPress={() => {
                // For now, show a simple selection
                Alert.alert(
                  'Select Option',
                  'Choose an option:',
                  question.options?.map((option: any) => ({
                    text: option.text,
                    onPress: () => handleResponseChange(question.id, option.value)
                  })) || []
                );
              }}
              style={styles.dropdownButton}
            >
              Select Option
            </Button>
          </View>
        );

      case 'rating':
      case 'rating_scale':
        const scale = question.scale || { min: 1, max: 5 };
        const ratings = [];
        for (let i = scale.min; i <= scale.max; i++) {
          ratings.push(i);
        }
        return (
          <View style={styles.ratingContainer}>
            {ratings.map((rating) => (
              <Button
                key={rating}
                mode={currentResponse === rating ? 'contained' : 'outlined'}
                onPress={() => handleResponseChange(question.id, rating)}
                style={styles.ratingButton}
                compact
              >
                {rating}
              </Button>
            ))}
          </View>
        );

      case 'yes_no':
        return (
          <View style={styles.optionsContainer}>
            <View style={styles.optionItem}>
              <RadioButton
                value="yes"
                status={currentResponse === 'yes' ? 'checked' : 'unchecked'}
                onPress={() => handleResponseChange(question.id, 'yes')}
              />
              <Text style={styles.optionText}>Yes</Text>
            </View>
            <View style={styles.optionItem}>
              <RadioButton
                value="no"
                status={currentResponse === 'no' ? 'checked' : 'unchecked'}
                onPress={() => handleResponseChange(question.id, 'no')}
              />
              <Text style={styles.optionText}>No</Text>
            </View>
          </View>
        );

      case 'date':
        return (
          <TextInput
            mode="outlined"
            value={currentResponse}
            onChangeText={(text) => handleResponseChange(question.id, text)}
            placeholder="YYYY-MM-DD"
            style={styles.textInput}
          />
        );

      default:
        return (
          <View style={styles.unsupportedContainer}>
            <Text style={styles.unsupportedText}>
              Unsupported question type: {question.type}
            </Text>
          </View>
        );
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading interview...</Text>
      </View>
    );
  }

  if (!currentQuestion) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>No questions available</Text>
        <Button onPress={() => navigation.goBack()}>Go Back</Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Button
            mode="text"
            onPress={() => navigation.goBack()}
            icon="arrow-left"
          >
            Back
          </Button>
          
          {/* Pause/Resume and Abandon buttons */}
          <View style={styles.headerActions}>
            {isPaused ? (
              <Button
                mode="contained"
                onPress={resumeInterview}
                icon="play"
                style={styles.actionButton}
                buttonColor="#10b981"
              >
                Resume
              </Button>
            ) : (
              <Button
                mode="outlined"
                onPress={pauseInterview}
                icon="pause"
                style={styles.actionButton}
                buttonColor="#f59e0b"
              >
                Pause
              </Button>
            )}
            <Button
              mode="contained"
              onPress={() => setShowAbandonConfirm(true)}
              icon="stop"
              style={styles.actionButton}
              buttonColor="#ef4444"
            >
              Abandon
            </Button>
          </View>
        </View>
        
        <View style={styles.headerInfo}>
          <Text style={styles.surveyTitle}>{survey.surveyName}</Text>
          <Text style={styles.progressText}>
            Question {currentQuestionIndex + 1} of {visibleQuestions.length}
          </Text>
          <Text style={styles.durationText}>{formatTime(duration)}</Text>
        </View>
        
        <ProgressBar progress={progress} color="#2563eb" style={styles.progressBar} />
      </View>

      <ScrollView style={styles.content}>
        <Card style={styles.questionCard}>
          <Card.Content>
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
            {currentQuestion.description && (
              <Text style={styles.questionDescription}>{currentQuestion.description}</Text>
            )}
            {currentQuestion.required && (
              <Text style={styles.requiredText}>* Required</Text>
            )}
            
            {renderQuestion(currentQuestion)}
          </Card.Content>
        </Card>

        {/* Location Status */}
        {locationLoading && (
          <Card style={styles.statusCard}>
            <Card.Content>
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={styles.statusText}>Getting location...</Text>
              </View>
            </Card.Content>
          </Card>
        )}

        {locationData && (
          <Card style={styles.statusCard}>
            <Card.Content>
              <View style={styles.statusRow}>
                <Text style={styles.statusText}>📍 Location: {locationData.address}</Text>
              </View>
            </Card.Content>
          </Card>
        )}

        {/* Audio Recording Indicator */}
        {survey.mode === 'capi' && (
          <Card style={styles.audioCard}>
            <Card.Content>
              <View style={styles.audioHeader}>
                <View style={styles.audioIndicator}>
                  <View style={[
                    styles.recordingDot,
                    {
                      backgroundColor: audioPermission === false 
                        ? '#ef4444'
                        : isRecording 
                          ? (isAudioPaused ? '#fbbf24' : '#ef4444') 
                          : '#6b7280'
                    }
                  ]} />
                  <Text style={styles.audioStatusText}>
                    {audioPermission === false 
                      ? 'Audio Permission Denied'
                      : isRecording 
                        ? (isAudioPaused ? 'Audio Paused' : 'Recording') 
                        : 'Audio Ready'
                    }
                  </Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        )}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navigation}>
        <Button
          mode="outlined"
          onPress={goToPreviousQuestion}
          disabled={currentQuestionIndex === 0}
          style={styles.navButton}
        >
          Previous
        </Button>
        
        {currentQuestionIndex === visibleQuestions.length - 1 ? (
          <Button
            mode="contained"
            onPress={completeInterview}
            style={styles.completeButton}
            loading={isLoading}
          >
            Complete Interview
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={goToNextQuestion}
            style={styles.nextButton}
          >
            Next
          </Button>
        )}
      </View>

      {/* Abandon Confirmation Modal */}
      {showAbandonConfirm && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Abandon Interview</Text>
            <Text style={styles.modalText}>
              Are you sure you want to abandon this interview? All progress will be lost.
            </Text>
            <View style={styles.modalButtons}>
              <Button
                mode="outlined"
                onPress={() => setShowAbandonConfirm(false)}
                style={styles.modalButton}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() => {
                  setShowAbandonConfirm(false);
                  abandonInterview();
                }}
                style={[styles.modalButton, { backgroundColor: '#ef4444' }]}
              >
                Abandon
              </Button>
            </View>
          </View>
        </View>
      )}

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={3000}
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: '#ef4444',
    marginBottom: 20,
    textAlign: 'center',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    marginLeft: 8,
  },
  headerInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  surveyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  progressText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  durationText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  questionCard: {
    marginBottom: 16,
    elevation: 2,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
    lineHeight: 24,
  },
  questionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  requiredText: {
    fontSize: 12,
    color: '#ef4444',
    marginBottom: 16,
  },
  textInput: {
    marginTop: 8,
  },
  optionsContainer: {
    marginTop: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  optionText: {
    fontSize: 16,
    color: '#374151',
    marginLeft: 8,
    flex: 1,
  },
  dropdownContainer: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    padding: 12,
  },
  dropdownText: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 8,
  },
  dropdownButton: {
    marginTop: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    flexWrap: 'wrap',
  },
  ratingButton: {
    marginHorizontal: 4,
    marginVertical: 4,
  },
  unsupportedContainer: {
    padding: 20,
    alignItems: 'center',
  },
  unsupportedText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  statusCard: {
    marginBottom: 12,
    elevation: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 8,
  },
  audioCard: {
    marginBottom: 16,
    elevation: 2,
  },
  audioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  audioIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  startRecordingButton: {
    marginTop: 8,
    backgroundColor: '#ef4444',
  },
  startRecordingButtonText: {
    color: 'white',
    fontSize: 12,
  },
  audioStatusText: {
    fontSize: 14,
    color: '#6b7280',
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  navButton: {
    flex: 0.45,
  },
  nextButton: {
    flex: 0.45,
  },
  completeButton: {
    flex: 0.45,
    backgroundColor: '#10b981',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    margin: 20,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 0.45,
  },
});