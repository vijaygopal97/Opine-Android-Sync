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
  
  // Helper function to check if an option is "Other", "Others", or "Others (Specify)"
  const isOthersOption = (optText: string | null | undefined): boolean => {
    if (!optText) return false;
    const normalized = optText.toLowerCase().trim();
    return normalized === 'other' || 
           normalized === 'others' || 
           normalized === 'others (specify)';
  };
  
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
  
  // Quota management state
  const [genderQuotas, setGenderQuotas] = useState<any>(null);
  const [targetAudienceErrors, setTargetAudienceErrors] = useState<Map<string, string>>(new Map());
  const [othersTextInputs, setOthersTextInputs] = useState<Record<string, string>>({}); // Store "Others" text input values by questionId_optionValue
  const [shuffledOptions, setShuffledOptions] = useState<Record<string, any[]>>({}); // Store shuffled options per questionId to maintain consistent order

  // Get all questions from all sections
  const allQuestions = useMemo(() => {
    const questions = [];
    
    // Debug survey data
    console.log('🔍 Survey data received:', {
      surveyName: survey.surveyName,
      sectionsCount: survey.sections ? survey.sections.length : 0,
      questionsCount: survey.questions ? survey.questions.length : 0,
      sections: survey.sections,
      questions: survey.questions
    });
    
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
    
    // Add regular survey questions from sections
    if (survey.sections && survey.sections.length > 0) {
      survey.sections.forEach((section: any, sectionIndex: number) => {
        if (section.questions && section.questions.length > 0) {
          section.questions.forEach((question: any, questionIndex: number) => {
            questions.push({
              ...question,
              sectionIndex,
              questionIndex,
              sectionId: section.id,
              sectionTitle: section.title
            });
          });
        }
      });
    }
    
    // Add direct survey questions (not in sections)
    if (survey.questions && survey.questions.length > 0) {
      survey.questions.forEach((question: any, questionIndex: number) => {
        questions.push({
          ...question,
          sectionIndex: 0, // Default section for direct questions
          questionIndex,
          sectionId: 'direct-questions',
          sectionTitle: 'Survey Questions'
        });
      });
    }
    
    console.log('🔍 Total questions processed:', questions.length);
    console.log('🔍 Questions array:', questions.map(q => ({ id: q.id, text: q.text, type: q.type })));
    
    return questions;
  }, [survey.sections, survey.questions, requiresACSelection, assignedACs]);

  // Helper function to check if response has content
  const hasResponseContent = (response: any): boolean => {
    if (response === null || response === undefined) return false;
    if (typeof response === 'string') return response.trim().length > 0;
    if (Array.isArray(response)) return response.length > 0;
    if (typeof response === 'number') return !isNaN(response) && isFinite(response); // Allow 0 and negative numbers
    if (typeof response === 'boolean') return true;
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
          
          // Start audio recording automatically for CAPI mode (both single-mode and multi-mode)
          const shouldRecordAudio = (survey.mode === 'capi') || 
                                   (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
          
          if (shouldRecordAudio && audioPermission && !isRecording) {
            console.log('Auto-starting audio recording for CAPI mode...');
            console.log('Survey mode:', survey.mode, 'Assigned mode:', survey.assignedMode);
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

  // Cleanup any existing recording on component mount - ensure clean state
  useEffect(() => {
    const cleanupOnMount = async () => {
      // Always ensure globalRecording is null on mount
      if (globalRecording) {
        try {
          console.log('Cleaning up existing recording on mount...');
          const status = await globalRecording.getStatusAsync();
          if (status.isRecording || status.canRecord) {
            await globalRecording.stopAndUnloadAsync();
          }
        } catch (error) {
          console.log('Cleanup on mount error (non-fatal):', error);
        }
        globalRecording = null;
      }
      // Also reset audio mode to ensure clean state
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        // Wait a bit before allowing new recording
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.log('Error resetting audio mode (non-fatal):', error);
      }
    };
    cleanupOnMount();
  }, []);

  // Cleanup recording on component unmount
  useEffect(() => {
    return () => {
      cleanupRecording().catch(console.error);
    };
  }, []);

  // Fetch gender quotas from backend
  const fetchGenderQuotas = useCallback(async () => {
    try {
      const result = await apiService.getGenderResponseCounts(survey._id);
      if (result.success) {
        setGenderQuotas(result.data.genderQuotas);
      }
    } catch (error) {
      console.error('Error fetching gender quotas:', error);
    }
  }, [survey._id]);

  // Fetch gender quotas when component mounts
  useEffect(() => {
    if (survey._id) {
      fetchGenderQuotas();
    }
  }, [survey._id, fetchGenderQuotas]);

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  // Simple cleanup function
  const cleanupRecording = async () => {
    try {
      if (globalRecording) {
        console.log('Cleaning up recording...');
        try {
          const status = await globalRecording.getStatusAsync();
          if (status.isRecording || status.canRecord) {
            await globalRecording.stopAndUnloadAsync();
          }
        } catch (error) {
          console.log('Error during cleanup:', error);
        }
        globalRecording = null;
      }
    } catch (error) {
      console.log('Cleanup error:', error);
    } finally {
      setIsRecording(false);
      setIsAudioPaused(false);
      setAudioUri(null);
      globalRecording = null;
    }
  };

  const handleResponseChange = (questionId: string, response: any) => {
    // Prevent interaction if recording hasn't started (for CAPI mode)
    const shouldRecordAudio = (survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
    if (shouldRecordAudio && !isRecording && audioPermission !== false) {
      return; // Block interaction until recording starts
    }
    
    setResponses(prev => ({
      ...prev,
      [questionId]: response
    }));
    
    // Handle AC selection specially
    if (questionId === 'ac-selection') {
      setSelectedAC(response);
      console.log('AC selected:', response);
    }

    // Real-time target audience validation for fixed questions
    if (response && response.toString().trim().length > 0) {
      const validationError = validateFixedQuestion(questionId, response);
      setTargetAudienceErrors(prev => {
        const newErrors = new Map(prev);
        if (validationError) {
          newErrors.set(questionId, validationError);
        } else {
          newErrors.delete(questionId);
        }
        return newErrors;
      });

      // Refresh gender quotas if gender question is answered
      if (questionId === 'fixed_respondent_gender') {
        // Small delay to allow backend to process the response
        setTimeout(() => {
          fetchGenderQuotas();
        }, 1000);
      }
    } else {
      // Clear target audience error if response is empty
      setTargetAudienceErrors(prev => {
        const newErrors = new Map(prev);
        newErrors.delete(questionId);
        return newErrors;
      });
    }
  };

  const goToNextQuestion = () => {
    const currentQuestion = visibleQuestions[currentQuestionIndex];
    
    // Check for target audience validation errors
    if (targetAudienceErrors.has(currentQuestion.id)) {
      showSnackbar('Please correct the validation error before proceeding');
      return;
    }

    // Check if current question is required and not answered
    if (currentQuestion.required) {
      const response = responses[currentQuestion.id];
      const hasValidResponse = response !== null && 
                              response !== undefined && 
                              response !== '' && 
                              (Array.isArray(response) ? response.length > 0 : true);
      
      if (!hasValidResponse) {
        showSnackbar('This is a required question. Please provide an answer before proceeding.');
        return;
      }
    }
    
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
    if (isRecording) {
      console.log('Already recording, skipping...');
      return;
    }
    
    try {
      console.log('=== EXPO-AV AUDIO RECORDING START ===');
      
      // Clean up any existing recording - simple approach like before
      if (globalRecording) {
        try {
          console.log('Cleaning up existing recording...');
          await globalRecording.stopAndUnloadAsync();
        } catch (cleanupError) {
          console.log('Cleanup error (non-fatal):', cleanupError);
        }
        globalRecording = null;
        // Wait a bit for native module to release
        await new Promise(resolve => setTimeout(resolve, 300));
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
      
      console.log('Creating new recording object...');
      // Create a completely new recording object
      const recording = new Audio.Recording();
      
      console.log('Preparing recording...');
      // Only set globalRecording AFTER successful preparation
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
      
      // Only set globalRecording after successful preparation
      globalRecording = recording;
      
      console.log('Starting recording...');
      await recording.startAsync();
      
      // Don't set audioUri here - it will be set when we stop recording and get the actual URI
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
      // Clean up on error
      if (globalRecording) {
        try {
          await globalRecording.stopAndUnloadAsync();
        } catch (cleanupError) {
          console.log('Error cleaning up on failure:', cleanupError);
        }
        globalRecording = null;
      }
    }
  };

  const stopAudioRecording = async () => {
    try {
      console.log('Stopping audio recording...');
      
      if (!isRecording || !globalRecording) {
        console.log('No recording to stop');
        return audioUri; // Return existing URI if available
      }
      
      console.log('Stopping and unloading recording...');
      await globalRecording.stopAndUnloadAsync();
      
      const uri = globalRecording.getURI();
      console.log('Recording URI:', uri);
      
      // Update audioUri state with the actual file URI
      if (uri) {
        setAudioUri(uri);
      }
      
      setIsRecording(false);
      setIsAudioPaused(false);
      globalRecording = null;
      
      showSnackbar('Audio recording completed');
      return uri;
    } catch (error) {
      console.error('Error stopping recording:', error);
      showSnackbar('Failed to stop recording');
      return audioUri; // Return existing URI if available, even if stop failed
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

  // Function to validate required questions
  const validateRequiredQuestions = () => {
    const unansweredRequiredQuestions: Array<{question: any, index: number}> = [];
    
    // Check all visible questions (questions that were actually shown to the user)
    visibleQuestions.forEach((question, index) => {
      if (question.required) {
        const response = responses[question.id];
        const hasValidResponse = response !== null && 
                                response !== undefined && 
                                response !== '' && 
                                (Array.isArray(response) ? response.length > 0 : true);
        
        if (!hasValidResponse) {
          unansweredRequiredQuestions.push({
            question: question,
            index: index
          });
        }
      }
    });
    
    return unansweredRequiredQuestions;
  };

  const completeInterview = async () => {
    if (!sessionId) return;

    // Check for any target audience validation errors
    if (targetAudienceErrors.size > 0) {
      showSnackbar('Please correct all validation errors before completing the interview');
      return;
    }

    // Check for unanswered required questions
    const unansweredRequired = validateRequiredQuestions();
    if (unansweredRequired.length > 0) {
      const firstUnanswered = unansweredRequired[0];
      const questionIndex = visibleQuestions.findIndex(q => q.id === firstUnanswered.question.id);
      
      if (questionIndex !== -1) {
        setCurrentQuestionIndex(questionIndex);
        showSnackbar(`Please answer the required question: "${firstUnanswered.question.text}"`);
        return;
      }
    }

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
        
        try {
          // Check if file exists before uploading
          const fileInfo = await FileSystem.getInfoAsync(currentAudioUri);
          if (!fileInfo.exists) {
            console.error('Audio file does not exist at path:', currentAudioUri);
            showSnackbar('Audio file not found, continuing without audio');
          } else {
            console.log('Audio file exists, size:', fileInfo.size);
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
          }
        } catch (uploadError: any) {
          console.error('Error during audio upload:', uploadError);
          showSnackbar('Failed to upload audio, continuing without audio');
        }
      } else {
        console.log('No audio file to upload');
      }
      
      // Prepare final response data for ALL questions (including skipped ones)
      const finalResponses = allQuestions.map((question: any, index: number) => {
        const response = responses[question.id] || '';
        
        // Process response to include option codes and handle "Others" text input
        let processedResponse = response || (question.type === 'multiple_choice' ? [] : '');
        let responseCodes: string | string[] | null = null;
        let responseWithCodes: any = null;
        
        // Find "Others" option value for this question
        const othersOption = question.options?.find((opt: any) => {
          const optText = opt.text || '';
          return isOthersOption(optText);
        });
        const othersOptionValue = othersOption ? (othersOption.value || othersOption.text) : null;
        
        if (question.type === 'multiple_choice' && question.options) {
          if (Array.isArray(processedResponse)) {
            // Multiple selection
            responseCodes = [];
            responseWithCodes = [];
            
            processedResponse.forEach((respValue: string) => {
              const selectedOption = question.options.find((opt: any) => {
                const optValue = opt.value || opt.text;
                return optValue === respValue;
              });
              
              if (selectedOption) {
                const optText = selectedOption.text || '';
                const optCode = selectedOption.code || null;
                const isOthers = isOthersOption(optText);
                
                if (isOthers) {
                  // Get the "Others" text input value
                  const othersText = othersTextInputs[`${question.id}_${respValue}`] || '';
                  if (othersText) {
                    // Save with code but answer is the text input
                    (responseCodes as string[]).push(optCode || respValue);
                    (responseWithCodes as any[]).push({
                      code: optCode || respValue,
                      answer: othersText,
                      optionText: optText
                    });
                  } else {
                    // No text provided, just save the option
                    (responseCodes as string[]).push(optCode || respValue);
                    (responseWithCodes as any[]).push({
                      code: optCode || respValue,
                      answer: optText,
                      optionText: optText
                    });
                  }
                } else {
                  // Regular option
                  (responseCodes as string[]).push(optCode || respValue);
                  (responseWithCodes as any[]).push({
                    code: optCode || respValue,
                    answer: optText,
                    optionText: optText
                  });
                }
              }
            });
          } else {
            // Single selection
            const selectedOption = question.options.find((opt: any) => {
              const optValue = opt.value || opt.text;
              return optValue === processedResponse;
            });
            
            if (selectedOption) {
              const optText = selectedOption.text || '';
              const optCode = selectedOption.code || null;
              const isOthers = isOthersOption(optText);
              
              if (isOthers) {
                // Get the "Others" text input value
                const othersText = othersTextInputs[`${question.id}_${processedResponse}`] || '';
                if (othersText) {
                  responseCodes = optCode || processedResponse;
                  responseWithCodes = {
                    code: optCode || processedResponse,
                    answer: othersText,
                    optionText: optText
                  };
                } else {
                  responseCodes = optCode || processedResponse;
                  responseWithCodes = {
                    code: optCode || processedResponse,
                    answer: optText,
                    optionText: optText
                  };
                }
              } else {
                responseCodes = optCode || processedResponse;
                responseWithCodes = {
                  code: optCode || processedResponse,
                  answer: optText,
                  optionText: optText
                };
              }
            }
          }
        }
        
        // For "Others" option, update the response to include the specified text
        let finalResponse = processedResponse;
        if (question.type === 'multiple_choice' && responseWithCodes) {
          // Check if any response has "Others" with specified text
          if (Array.isArray(responseWithCodes)) {
            const othersResponse = responseWithCodes.find((r: any) => r.optionText && isOthersOption(r.optionText) && r.answer !== r.optionText);
            if (othersResponse) {
              // Replace the "Others" value with the specified text in the response array
              finalResponse = (processedResponse as string[]).map((val: string) => {
                if (val === othersResponse.code || val === othersOptionValue) {
                  return `Others: ${othersResponse.answer}`;
                }
                return val;
              });
            }
          } else if (responseWithCodes.optionText && isOthersOption(responseWithCodes.optionText) && responseWithCodes.answer !== responseWithCodes.optionText) {
            // Single selection with "Others" specified text
            finalResponse = `Others: ${responseWithCodes.answer}`;
          }
        }
        
        return {
          sectionIndex: 0,
          questionIndex: index,
          questionId: question.id,
          questionType: question.type,
          questionText: question.text,
          questionDescription: question.description,
          questionOptions: question.options?.map((opt: any) => opt.value) || [],
          response: finalResponse, // Use finalResponse which includes "Others: [specified text]"
          responseCodes: responseCodes, // Include option codes
          responseWithCodes: responseWithCodes, // Include structured response with codes
          responseTime: 0,
          isRequired: question.required,
          isSkipped: !response // True if no response provided
        };
      });

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
          interviewMode: survey.mode === 'multi_mode' ? (survey.assignedMode || 'capi') : (survey.mode || 'capi'),
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
              onPress: () => {
                // Reset navigation stack to prevent going back to interview
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Dashboard' }],
                });
              }
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

  // Validate age against target audience requirements
  const validateAge = (age: string) => {
    const ageRange = survey.targetAudience?.demographics?.ageRange;
    if (!ageRange || !ageRange.min || !ageRange.max) return null; // No age restrictions
    
    const ageNum = parseInt(age);
    if (isNaN(ageNum)) return null; // Invalid age format
    
    if (ageNum < ageRange.min || ageNum > ageRange.max) {
      return `Only respondents of age between ${ageRange.min} and ${ageRange.max} are allowed to participate`;
    }
    return null; // Valid age
  };

  // Validate gender against target audience requirements and quotas
  const validateGender = (gender: string) => {
    const genderRequirements = survey.targetAudience?.demographics?.genderRequirements;
    if (!genderRequirements) return null; // No gender restrictions
    
    // Check if the selected gender is allowed
    const allowedGenders = Object.keys(genderRequirements).filter(g => 
      genderRequirements[g] && !g.includes('Percentage')
    );
    
    if (allowedGenders.length === 0) return null; // No gender restrictions
    
    // Map the response value to the requirement key format
    const genderMapping = {
      'male': 'Male',
      'female': 'Female', 
      'non_binary': 'Non-binary'
    };
    
    const mappedGender = genderMapping[gender as keyof typeof genderMapping];
    if (!mappedGender || !allowedGenders.includes(mappedGender)) {
      const allowedList = allowedGenders.join(', ');
      return `Only ${allowedList} respondents are allowed to participate`;
    }

    // Check quota if available
    if (genderQuotas && genderQuotas[mappedGender]) {
      const quota = genderQuotas[mappedGender];
      if (quota.isFull) {
        return `Sample size for ${mappedGender} is completed. Please select a different gender.`;
      }
    }

    return null; // Valid gender
  };

  // Validate fixed questions against target audience
  const validateFixedQuestion = (questionId: string, response: any) => {
    if (questionId === 'fixed_respondent_age') {
      return validateAge(response);
    } else if (questionId === 'fixed_respondent_gender') {
      return validateGender(response);
    }
    return null; // No validation for other questions
  };

  // Fisher-Yates shuffle algorithm for randomizing options
  const shuffleArray = (array: any[]): any[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Get shuffled options for a question (shuffle once, then reuse)
  const getShuffledOptions = (questionId: string, originalOptions: any[]): any[] => {
    if (!originalOptions || originalOptions.length === 0) return originalOptions || [];
    
    // If already shuffled for this question, return cached shuffled order
    if (shuffledOptions[questionId]) {
      return shuffledOptions[questionId];
    }
    
    // Shuffle options for the first time
    const shuffled = shuffleArray(originalOptions);
    setShuffledOptions(prev => ({
      ...prev,
      [questionId]: shuffled
    }));
    
    return shuffled;
  };

  // Render question based on type
  const renderQuestion = (question: any) => {
    const currentResponse = responses[question.id] || '';
    const questionId = question.id;
    
    // Get shuffled options for display (for multiple_choice, single_choice, and dropdown)
    const displayOptions = (question.type === 'multiple_choice' || question.type === 'single_choice' || question.type === 'dropdown') 
      ? getShuffledOptions(questionId, question.options || [])
      : question.options;

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
      case 'numeric':
        return (
          <TextInput
            mode="outlined"
            value={currentResponse !== null && currentResponse !== undefined ? currentResponse.toString() : ''}
            onChangeText={(text) => {
              // Allow empty string or valid number (including 0 and negative numbers)
              if (text === '') {
                handleResponseChange(question.id, '');
              } else {
                const numValue = parseFloat(text);
                if (!isNaN(numValue) && isFinite(numValue)) {
                  handleResponseChange(question.id, numValue);
                }
              }
            }}
            placeholder="Enter a number..."
            keyboardType="numeric"
            style={styles.textInput}
          />
        );

      case 'multiple_choice':
        // Check if multiple selections are allowed
        const allowMultiple = question.settings?.allowMultiple || false;
        const maxSelections = question.settings?.maxSelections;
        const currentSelections = Array.isArray(currentResponse) ? currentResponse.length : 0;
        
        // Use shuffled options for display
        const shuffledMultipleChoiceOptions = displayOptions || question.options || [];
        
        // Check if "None" option exists
        const noneOption = shuffledMultipleChoiceOptions.find((opt: any) => {
          const optText = opt.text || '';
          return optText.toLowerCase().trim() === 'none';
        });
        const noneOptionValue = noneOption ? (noneOption.value || noneOption.text) : null;
        
        // Check if "Others" option exists
        const othersOption = shuffledMultipleChoiceOptions.find((opt: any) => {
          const optText = opt.text || '';
          return isOthersOption(optText);
        });
        const othersOptionValue = othersOption ? (othersOption.value || othersOption.text) : null;
        
        // Check if "Others" is selected
        const isOthersSelected = allowMultiple 
          ? (Array.isArray(currentResponse) && currentResponse.includes(othersOptionValue))
          : (currentResponse === othersOptionValue);
        
        return (
          <View style={styles.optionsContainer}>
            {allowMultiple && maxSelections && (
              <View style={styles.selectionLimitContainer}>
                <Text style={styles.selectionLimitText}>
                  Selection limit: {currentSelections} / {maxSelections}
                </Text>
              </View>
            )}
            {shuffledMultipleChoiceOptions.map((option: any, index: number) => {
              const optionValue = option.value || option.text;
              const optionText = option.text || '';
              const isNoneOption = optionText.toLowerCase().trim() === 'none';
              const isOthers = isOthersOption(optionText);
              const isSelected = allowMultiple 
                ? (Array.isArray(currentResponse) && currentResponse.includes(optionValue))
                : (currentResponse === optionValue);
              
              return (
                <View key={option.id || index} style={styles.optionItem}>
                  <Checkbox
                    status={isSelected ? 'checked' : 'unchecked'}
                    onPress={() => {
                      if (allowMultiple) {
                        let currentAnswers = Array.isArray(currentResponse) ? [...currentResponse] : [];
                        const maxSelections = question.settings?.maxSelections;
                        
                        if (currentAnswers.includes(optionValue)) {
                          // Deselecting
                          currentAnswers = currentAnswers.filter((a: string) => a !== optionValue);
                          
                          // Clear "Others" text input if "Others" is deselected
                          if (isOthers) {
                            setOthersTextInputs(prev => {
                              const updated = { ...prev };
                              delete updated[`${questionId}_${optionValue}`];
                              return updated;
                            });
                          }
                        } else {
                          // Selecting
                          // Handle "None" option - mutual exclusivity
                          if (isNoneOption) {
                            // If "None" is selected, clear all other selections
                            currentAnswers = [optionValue];
                            // Clear "Others" text input if it was selected
                            if (othersOptionValue && currentAnswers.includes(othersOptionValue)) {
                              setOthersTextInputs(prev => {
                                const updated = { ...prev };
                                delete updated[`${questionId}_${othersOptionValue}`];
                                return updated;
                              });
                            }
                          } else if (isOthers) {
                            // If "Others" is selected, clear all other selections (mutual exclusivity)
                            currentAnswers = [optionValue];
                            // Clear "None" if it exists
                            if (noneOptionValue && currentAnswers.includes(noneOptionValue)) {
                              currentAnswers = currentAnswers.filter((a: string) => a !== noneOptionValue);
                            }
                          } else {
                            // If any other option is selected, remove "None" and "Others" if they exist
                            if (noneOptionValue && currentAnswers.includes(noneOptionValue)) {
                              currentAnswers = currentAnswers.filter((a: string) => a !== noneOptionValue);
                            }
                            if (othersOptionValue && currentAnswers.includes(othersOptionValue)) {
                              currentAnswers = currentAnswers.filter((a: string) => a !== othersOptionValue);
                              // Clear "Others" text input
                              setOthersTextInputs(prev => {
                                const updated = { ...prev };
                                delete updated[`${questionId}_${othersOptionValue}`];
                                return updated;
                              });
                            }
                            
                            // Check if we've reached the maximum selections limit
                            if (maxSelections && currentAnswers.length >= maxSelections) {
                              showSnackbar(`Maximum ${maxSelections} selection${maxSelections > 1 ? 's' : ''} allowed`);
                              return;
                            }
                            currentAnswers.push(optionValue);
                          }
                        }
                        handleResponseChange(question.id, currentAnswers);
                      } else {
                        // Single selection
                        if (isNoneOption) {
                          // "None" selected - just set it
                          handleResponseChange(question.id, optionValue);
                          // Clear "Others" text input if it exists
                          if (othersOptionValue && currentResponse === othersOptionValue) {
                            setOthersTextInputs(prev => {
                              const updated = { ...prev };
                              delete updated[`${questionId}_${othersOptionValue}`];
                              return updated;
                            });
                          }
                        } else if (isOthers) {
                          // "Others" selected - just set it
                          handleResponseChange(question.id, optionValue);
                        } else {
                          // Other option selected - clear "None" and "Others" if they were selected
                          if (noneOptionValue && currentResponse === noneOptionValue) {
                            handleResponseChange(question.id, optionValue);
                          } else if (othersOptionValue && currentResponse === othersOptionValue) {
                            handleResponseChange(question.id, optionValue);
                            // Clear "Others" text input
                            setOthersTextInputs(prev => {
                              const updated = { ...prev };
                              delete updated[`${questionId}_${othersOptionValue}`];
                              return updated;
                            });
                          } else {
                            handleResponseChange(question.id, optionValue);
                          }
                        }
                      }
                    }}
                  />
                  <Text style={styles.optionText}>{optionText}</Text>
                </View>
              );
            })}
            {/* Show text input for "Others" option when selected */}
            {isOthersSelected && othersOptionValue && (
              <View style={styles.othersInputContainer}>
                <TextInput
                  mode="outlined"
                  value={othersTextInputs[`${questionId}_${othersOptionValue}`] || ''}
                  onChangeText={(text) => {
                    setOthersTextInputs(prev => ({
                      ...prev,
                      [`${questionId}_${othersOptionValue}`]: text
                    }));
                  }}
                  placeholder="Please specify..."
                  style={styles.othersTextInput}
                />
              </View>
            )}
          </View>
        );

      case 'single_choice':
      case 'single_select':
        // Check if this is a gender question for quota display
        const isGenderQuestion = question.id === 'fixed_respondent_gender';
        
        // Use shuffled options for display
        const shuffledSingleChoiceOptions = displayOptions || question.options || [];
        
        return (
          <View style={styles.optionsContainer}>
            {shuffledSingleChoiceOptions.map((option: any, index: number) => {
              // Get quota information for gender question
              let quotaInfo = null;
              if (isGenderQuestion && genderQuotas) {
                const genderMapping = {
                  'male': 'Male',
                  'female': 'Female', 
                  'non_binary': 'Non-binary'
                };
                const mappedGender = genderMapping[option.value as keyof typeof genderMapping];
                if (mappedGender && genderQuotas[mappedGender]) {
                  quotaInfo = genderQuotas[mappedGender];
                }
              }
              
              return (
                <View key={option.id || index} style={styles.optionItem}>
                  <RadioButton
                    value={option.value}
                    status={currentResponse === option.value ? 'checked' : 'unchecked'}
                    onPress={() => handleResponseChange(question.id, option.value)}
                  />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionText}>{option.text}</Text>
                    {quotaInfo && (
                      <View style={styles.quotaInfo}>
                        <Text style={styles.quotaText}>
                          {quotaInfo.currentCount}/{quotaInfo.quota} ({quotaInfo.percentage}%)
                        </Text>
                        {quotaInfo.isFull && (
                          <Text style={styles.quotaFullText}>Full</Text>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        );

      case 'dropdown':
        // Use shuffled options for display
        const shuffledDropdownOptions = displayOptions || question.options || [];
        
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
                  shuffledDropdownOptions.map((option: any) => ({
                    text: option.text,
                    onPress: () => handleResponseChange(question.id, option.value)
                  }))
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
        const min = scale.min || 1;
        const max = scale.max || 5;
        const labels = scale.labels || [];
        const minLabel = scale.minLabel || '';
        const maxLabel = scale.maxLabel || '';
        const ratings = [];
        for (let i = min; i <= max; i++) {
          ratings.push(i);
        }
        return (
          <View style={styles.ratingContainer}>
            <View style={styles.ratingButtonsRow}>
              {ratings.map((rating) => {
                const label = labels[rating - min] || '';
                return (
                  <View key={rating} style={styles.ratingButtonWrapper}>
                    <Button
                      mode={currentResponse === rating ? 'contained' : 'outlined'}
                      onPress={() => handleResponseChange(question.id, rating)}
                      style={[
                        styles.ratingButton,
                        currentResponse === rating && styles.ratingButtonSelected
                      ]}
                      compact
                    >
                      {rating}
                    </Button>
                    {label ? (
                      <Text style={styles.ratingLabel}>{label}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {(minLabel || maxLabel) && (
              <View style={styles.ratingLabelsRow}>
                <Text style={styles.ratingScaleLabel}>{minLabel}</Text>
                <Text style={styles.ratingScaleLabel}>{maxLabel}</Text>
              </View>
            )}
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
        
        {/* Recording Indicator and Location (compact) - Separate line */}
        <View style={styles.headerStatusRow}>
          {/* Recording Indicator */}
          {((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && (
            <View style={styles.recordingIndicator}>
              <View style={[
                styles.recordingDotSmall,
                {
                  backgroundColor: audioPermission === false 
                    ? '#ef4444'
                    : isRecording 
                      ? (isAudioPaused ? '#fbbf24' : '#ef4444') 
                      : '#6b7280'
                }
              ]} />
              <Text style={styles.recordingStatusTextSmall}>
                {audioPermission === false 
                  ? 'No Permission'
                  : isRecording 
                    ? (isAudioPaused ? 'Paused' : 'Recording') 
                    : 'Ready'
                }
              </Text>
            </View>
          )}
          
            {/* Location (only for first question) */}
            {currentQuestionIndex === 0 && (
              <>
                {locationLoading ? (
                  <View style={styles.locationIndicator}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.locationTextSmall}>Getting location...</Text>
                  </View>
                ) : locationData && locationData.address ? (
                  <View style={styles.locationIndicator}>
                    <Text style={styles.locationTextSmall} numberOfLines={1}>
                      📍 {locationData.address}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
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
            {/* Show loading/blocking overlay if recording hasn't started */}
            {((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
             !isRecording && audioPermission !== false && (
              <View style={styles.blockingOverlay}>
                <View style={styles.blockingContent}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={styles.blockingText}>Waiting for recording to start...</Text>
                  <Text style={styles.blockingSubtext}>Please wait while we initialize the audio recording</Text>
                </View>
              </View>
            )}
            
            {/* Show permission denied message */}
            {((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
             audioPermission === false && (
              <View style={styles.blockingOverlay}>
                <View style={styles.blockingContent}>
                  <Text style={styles.blockingText}>Audio Permission Required</Text>
                  <Text style={styles.blockingSubtext}>Please grant audio recording permission to continue</Text>
                </View>
              </View>
            )}
            
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
            {currentQuestion.description && (
              <Text style={styles.questionDescription}>{currentQuestion.description}</Text>
            )}
            {currentQuestion.required && (
              <Text style={styles.requiredText}>* Required</Text>
            )}
            
            <View style={[
              styles.questionContent,
              (!isRecording && audioPermission !== false && 
               ((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi'))) && 
              styles.disabledContent
            ]}>
              {renderQuestion(currentQuestion)}
            </View>
            
            {/* Target Audience Validation Error */}
            {targetAudienceErrors.has(currentQuestion.id) && (
              <View style={styles.validationError}>
                <Text style={styles.validationErrorText}>
                  {targetAudienceErrors.get(currentQuestion.id)}
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navigation}>
        <Button
          mode="outlined"
          onPress={goToPreviousQuestion}
          disabled={currentQuestionIndex === 0 || 
                   (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                    !isRecording && audioPermission !== false)}
          style={styles.navButton}
        >
          Previous
        </Button>
        
        {currentQuestionIndex === visibleQuestions.length - 1 ? (
          <Button
            mode="contained"
            onPress={completeInterview}
            style={[
              styles.completeButton,
              (targetAudienceErrors.size > 0 || 
               (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                !isRecording && audioPermission !== false)) && styles.disabledButton
            ]}
            disabled={targetAudienceErrors.size > 0 || 
                     (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                      !isRecording && audioPermission !== false)}
            loading={isLoading}
          >
            Complete Interview
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={goToNextQuestion}
            style={[
              styles.nextButton,
              ((targetAudienceErrors.has(visibleQuestions[currentQuestionIndex]?.id) || 
               (visibleQuestions[currentQuestionIndex]?.required && 
                !responses[visibleQuestions[currentQuestionIndex]?.id])) ||
               (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                !isRecording && audioPermission !== false)) && styles.disabledButton
            ]}
            disabled={targetAudienceErrors.has(visibleQuestions[currentQuestionIndex]?.id) || 
                     (visibleQuestions[currentQuestionIndex]?.required && 
                      !responses[visibleQuestions[currentQuestionIndex]?.id]) ||
                     (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                      !isRecording && audioPermission !== false)}
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
    marginBottom: 8,
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  recordingDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordingStatusTextSmall: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '500',
  },
  locationIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 200,
    gap: 6,
  },
  locationTextSmall: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '500',
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
    position: 'relative',
  },
  blockingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  blockingContent: {
    alignItems: 'center',
    padding: 20,
  },
  blockingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginTop: 16,
    textAlign: 'center',
  },
  blockingSubtext: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
    textAlign: 'center',
  },
  questionContent: {
    position: 'relative',
  },
  disabledContent: {
    opacity: 0.5,
    pointerEvents: 'none',
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
  selectionLimitContainer: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  selectionLimitText: {
    fontSize: 14,
    color: '#1e40af',
    fontWeight: '500',
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
  othersInputContainer: {
    marginLeft: 40,
    marginTop: 8,
    marginBottom: 8,
  },
  othersTextInput: {
    marginTop: 0,
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
    marginTop: 16,
  },
  ratingButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  ratingButtonWrapper: {
    alignItems: 'center',
    marginHorizontal: 4,
    marginVertical: 4,
  },
  ratingButton: {
    minWidth: 50,
  },
  ratingButtonSelected: {
    backgroundColor: '#fbbf24',
  },
  ratingLabel: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 60,
  },
  ratingLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  ratingScaleLabel: {
    fontSize: 12,
    color: '#6b7280',
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
  // Quota and validation styles
  optionContent: {
    flex: 1,
    flexDirection: 'column',
  },
  quotaInfo: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quotaText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  quotaFullText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  validationError: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  validationErrorText: {
    fontSize: 14,
    color: '#dc2626',
    fontWeight: '500',
  },
  disabledButton: {
    backgroundColor: '#9ca3af',
    opacity: 0.6,
  },
});