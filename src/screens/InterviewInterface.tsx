import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
  BackHandler,
  Platform,
  StatusBar as RNStatusBar,
  Modal,
  TouchableOpacity,
  FlatList,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { apiService } from '../services/api';
import { LocationService } from '../utils/location';
import { Survey, SurveyResponse } from '../types';
import { parseTranslation, getMainText } from '../utils/translations';

const { width, height } = Dimensions.get('window');

// Simple audio recorder
// Global recording instance
let globalRecording: Audio.Recording | null = null;
// Lock to prevent concurrent recording starts
let isStartingRecording = false;

export default function InterviewInterface({ navigation, route }: any) {
  const { survey, responseId, isContinuing, isCatiMode: routeIsCatiMode } = route.params;
  
  // Determine if this is CATI mode
  const isCatiMode = routeIsCatiMode !== undefined 
    ? routeIsCatiMode 
    : survey.mode === 'cati' || survey.assignedMode === 'cati';
  
  // Helper function to check if an option is "Other", "Others", or "Others (Specify)"
  const isOthersOption = (optText: string | null | undefined): boolean => {
    if (!optText) return false;
    // Strip translations before checking
    const mainText = getMainText(String(optText));
    const normalized = mainText.toLowerCase().trim();
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
  
  // AC selection state
  const [selectedAC, setSelectedAC] = useState<string | null>(null);
  const [assignedACs, setAssignedACs] = useState<string[]>([]);
  const [requiresACSelection, setRequiresACSelection] = useState(false);
  
  // Polling Station Selection state
  const [selectedPollingStation, setSelectedPollingStation] = useState<any>({
    state: null,
    acName: null,
    acNo: null,
    pcNo: null,
    pcName: null,
    district: null,
    groupName: null,
    stationName: null,
    gpsLocation: null,
    latitude: null,
    longitude: null
  });
  const [availableGroups, setAvailableGroups] = useState<any[]>([]);
  const [availablePollingStations, setAvailablePollingStations] = useState<any[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [geofencingError, setGeofencingError] = useState<string | null>(null);
  const [locationControlBooster, setLocationControlBooster] = useState(false);
  
  // Dropdown states for polling station selection
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [showStationDropdown, setShowStationDropdown] = useState(false);
  
  // Close other dropdown when one opens
  useEffect(() => {
    if (showGroupDropdown) {
      setShowStationDropdown(false);
    }
  }, [showGroupDropdown]);
  
  useEffect(() => {
    if (showStationDropdown) {
      setShowGroupDropdown(false);
    }
  }, [showStationDropdown]);
  
  // Quota management state
  const [genderQuotas, setGenderQuotas] = useState<any>(null);
  const [targetAudienceErrors, setTargetAudienceErrors] = useState<Map<string, string>>(new Map());
  const [othersTextInputs, setOthersTextInputs] = useState<Record<string, string>>({}); // Store "Others" text input values by questionId_optionValue
  const [shuffledOptions, setShuffledOptions] = useState<Record<string, any[]>>({}); // Store shuffled options per questionId to maintain consistent order
  const scrollViewRef = React.useRef<ScrollView>(null); // Ref for ScrollView to scroll to top
  
  // CATI interview state
  const [catiQueueId, setCatiQueueId] = useState<string | null>(null);
  const [catiRespondent, setCatiRespondent] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'failed' | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [abandonReason, setAbandonReason] = useState<string>('');
  const [abandonNotes, setAbandonNotes] = useState<string>('');
  const [callLaterDate, setCallLaterDate] = useState<string>('');

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
      
      // Add Polling Station selection question after AC selection (if AC is selected)
      if (selectedAC) {
        const pollingStationQuestion = {
          id: 'polling-station-selection',
          type: 'polling_station',
          text: 'Select Polling Station',
          description: 'Please select the Group and Polling Station where you are conducting this interview.',
          required: true,
          order: -0.5, // Make it appear after AC selection
          sectionIndex: -1,
          questionIndex: -0.5,
          sectionId: 'polling-station-selection',
          sectionTitle: 'Polling Station Selection',
          isPollingStationSelection: true,
          availableGroups: availableGroups,
          availablePollingStations: availablePollingStations,
          selectedGroup: selectedPollingStation.groupName,
          selectedStation: selectedPollingStation.stationName
        };
        questions.push(pollingStationQuestion);
      }
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
  }, [survey.sections, survey.questions, requiresACSelection, assignedACs, selectedAC, availableGroups, availablePollingStations, selectedPollingStation.groupName, selectedPollingStation.stationName]);

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

      // Find the target question to get its options for proper comparison
      const targetQuestion = allQuestions.find((q: any) => q.id === condition.questionId);
      
      // Helper function to get main text (without translation) for comparison
      const getComparisonValue = (val: any): string => {
        if (val === null || val === undefined) return String(val || '').toLowerCase().trim();
        const strVal = String(val);
        
        // If we have the target question and it has options, try to match the value to an option
        if (targetQuestion && targetQuestion.options && Array.isArray(targetQuestion.options)) {
          // Check if val matches any option.value or option.text (after stripping translations)
          for (const option of targetQuestion.options) {
            const optionValue = typeof option === 'object' ? (option.value || option.text) : option;
            const optionText = typeof option === 'object' ? option.text : option;
            
            // Check if val matches option.value or option.text (with or without translations)
            if (strVal === String(optionValue) || strVal === String(optionText)) {
              // Return the main text of the option (without translation)
              return getMainText(String(optionText)).toLowerCase().trim();
            }
            
            // Also check if main texts match (in case translations differ)
            if (getMainText(strVal).toLowerCase().trim() === getMainText(String(optionText)).toLowerCase().trim()) {
              return getMainText(String(optionText)).toLowerCase().trim();
            }
          }
        }
        
        // Fallback: just strip translations from the value itself
        return getMainText(strVal).toLowerCase().trim();
      };

      // Get comparison values for both response and condition value
      const responseComparison = Array.isArray(response) 
        ? response.map((r: any) => getComparisonValue(r))
        : getComparisonValue(response);
      const conditionComparison = getComparisonValue(condition.value);

      switch (condition.operator) {
        case 'equals':
          if (Array.isArray(responseComparison)) {
            met = responseComparison.some((r: string) => r === conditionComparison);
          } else {
            met = responseComparison === conditionComparison;
          }
          break;
        case 'not_equals':
          if (Array.isArray(responseComparison)) {
            met = !responseComparison.some((r: string) => r === conditionComparison);
          } else {
            met = responseComparison !== conditionComparison;
          }
          break;
        case 'contains':
          const responseStr = Array.isArray(responseComparison) 
            ? responseComparison.join(' ') 
            : String(responseComparison);
          met = responseStr.includes(conditionComparison);
          break;
        case 'not_contains':
          const responseStr2 = Array.isArray(responseComparison) 
            ? responseComparison.join(' ') 
            : String(responseComparison);
          met = !responseStr2.includes(conditionComparison);
          break;
        case 'greater_than':
          met = parseFloat(String(response)) > parseFloat(String(condition.value));
          break;
        case 'less_than':
          met = parseFloat(String(response)) < parseFloat(String(condition.value));
          break;
        case 'is_empty':
          met = !hasResponseContent(response);
          break;
        case 'is_not_empty':
          met = hasResponseContent(response);
          break;
        case 'is_selected':
          if (Array.isArray(responseComparison)) {
            met = responseComparison.some((r: string) => r === conditionComparison);
          } else {
            met = responseComparison === conditionComparison;
          }
          break;
        case 'is_not_selected':
          if (Array.isArray(responseComparison)) {
            met = !responseComparison.some((r: string) => r === conditionComparison);
          } else {
            met = responseComparison !== conditionComparison;
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
        console.log('Checking audio permissions on mount...');
        const permissionResult = await Audio.requestPermissionsAsync();
        console.log('Initial permission result:', permissionResult);
        setAudioPermission(permissionResult.status === 'granted');
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
        // Start timing
        setStartTime(new Date());

        if (isCatiMode) {
          // CATI mode - use CATI-specific endpoint
          console.log('Starting CATI interview...');
          const result = await apiService.startCatiInterview(survey._id);
          
          // First check if the API call was successful
          if (!result.success) {
            // Interview failed to start - show error and navigate back
            const errorMsg = result.message || result.data?.message || 'Failed to start CATI interview';
            Alert.alert(
              'Cannot Start Interview',
              errorMsg,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.goBack();
                  }
                }
              ]
            );
            return; // Exit early - don't start the interview
          }
          
          // If success is true, check if we have valid data with respondent
          if (!result.data) {
            console.error('❌ No data received from server');
            const errorMsg = 'No data received from server. Please try again.';
            Alert.alert(
              'Cannot Start Interview',
              errorMsg,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.goBack();
                  }
                }
              ]
            );
            return; // Exit early - don't start the interview
          }
          
          const data = result.data;
          console.log('📋 Received data from API:', JSON.stringify(data, null, 2));
          console.log('📋 Respondent data:', data.respondent);
          
          // Check if respondent is available (this is the critical check)
          if (!data.respondent) {
            console.error('❌ No respondent object in data');
            const errorMsg = result.message || data.message || 'No respondent available. Please try again later.';
            Alert.alert(
              'No Respondent Available',
              errorMsg,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.goBack();
                  }
                }
              ]
            );
            return; // Exit early - don't start the interview
          }
          
          if (!data.respondent.id) {
            console.error('❌ Respondent object exists but no ID:', data.respondent);
            const errorMsg = result.message || data.message || 'No respondent ID available. Please try again later.';
            Alert.alert(
              'No Respondent Available',
              errorMsg,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.goBack();
                  }
                }
              ]
            );
            return; // Exit early - don't start the interview
          }
          
          // All checks passed - proceed with starting the interview
          console.log('✅ CATI Interview starting with respondent:', data.respondent);
          console.log('✅ Queue ID:', data.respondent.id);
          
          setSessionId(data.sessionId);
          setSessionData(data);
          setCatiQueueId(data.respondent.id); // This is the queue entry ID
          setCatiRespondent(data.respondent);
          setIsInterviewActive(true);
          
          // Check for AC assignment
          const needsACSelection = data.requiresACSelection && 
                                   data.assignedACs && 
                                   data.assignedACs.length > 0;
          
          setRequiresACSelection(needsACSelection);
          setAssignedACs(data.assignedACs || []);
          
          // Auto-make call after a short delay
          // Use the respondent ID directly from data, not from state (to avoid timing issues)
          setTimeout(() => {
            console.log('📞 Attempting to make call with queue ID:', data.respondent.id);
            if (data.respondent && data.respondent.id) {
              // Call the API directly with the queue ID from data
              apiService.makeCallToRespondent(data.respondent.id)
                .then((callResult) => {
                  console.log('📞 Call result:', callResult);
                  if (callResult.success && callResult.data) {
                    setCallId(callResult.data.callId);
                    setCallStatus('connected'); // Set to 'connected' to show "Call Started" instead of loading
                    showSnackbar('Call initiated successfully');
                  } else {
                    setCallStatus('failed');
                    const errorMsg = callResult.message || 'Failed to initiate call';
                    showSnackbar(`Call failed: ${errorMsg}. You can abandon this interview.`);
                  }
                })
                .catch((error: any) => {
                  console.error('📞 Error making call:', error);
                  setCallStatus('failed');
                  const errorMsg = error.response?.data?.message || error.message || 'Failed to make call';
                  showSnackbar(`Call failed: ${errorMsg}. You can abandon this interview.`);
                });
            } else {
              console.error('❌ No respondent ID available for call');
              setCallStatus('failed');
              showSnackbar('No respondent ID available. Cannot make call.');
            }
          }, 1500);
        } else {
          // CAPI mode - get location and start normal interview
          setLocationLoading(true);
          const location = await LocationService.getCurrentLocation();
          setLocationData(location);
          setLocationLoading(false);

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
            const shouldRecordAudio = (survey.mode === 'capi') || 
                                     (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
            
            if (shouldRecordAudio && !isRecording) {
              console.log('Auto-starting audio recording for CAPI mode...');
              setTimeout(() => {
                startAudioRecording();
              }, 2000);
            }
          } else {
            showSnackbar('Failed to start interview');
          }
        }
      } catch (error: any) {
        console.error('Error initializing interview:', error);
        const errorMsg = error.response?.data?.message || error.message || 'Failed to initialize interview';
        showSnackbar(errorMsg);
      } finally {
        setIsLoading(false);
      }
    };

    initializeInterview();
  }, [survey._id, isCatiMode]); // Include isCatiMode in dependencies

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
        setRecording(null);
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

  // Handle Android back button - show abandon confirmation
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Show abandon confirmation instead of going back
      setShowAbandonConfirm(true);
      return true; // Prevent default back behavior
    });

    return () => backHandler.remove();
  }, []);

  // Fetch groups when AC is selected
  useEffect(() => {
    const fetchGroups = async () => {
      if (!selectedAC) {
        setAvailableGroups([]);
        setAvailablePollingStations([]);
        return;
      }
      
      try {
        setLoadingGroups(true);
        // Use survey's acAssignmentState or default to 'West Bengal'
        const state = survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        console.log('Fetching groups for AC:', selectedAC, 'State:', state);
        const response = await apiService.getGroupsByAC(state, selectedAC);
        
        if (response.success) {
          // Backend returns { success: true, data: { groups: [...], ac_name: ..., etc } }
          // API service returns response.data which is { success: true, data: {...} }
          const responseData = response.data || {};
          const groups = responseData.groups || [];
          console.log('Groups fetched successfully:', groups.length, 'groups:', groups);
          setAvailableGroups(groups);
          setSelectedPollingStation((prev: any) => ({
            ...prev,
            state: state,
            acName: selectedAC,
            acNo: responseData.ac_no,
            pcNo: responseData.pc_no,
            pcName: responseData.pc_name,
            district: responseData.district
          }));
          // Clear polling stations when AC changes
          setAvailablePollingStations([]);
        } else {
          console.error('Failed to fetch groups:', response.message);
          setAvailableGroups([]);
        }
      } catch (error) {
        console.error('Error fetching groups:', error);
        setAvailableGroups([]);
        setAvailablePollingStations([]);
      } finally {
        setLoadingGroups(false);
      }
    };
    
    fetchGroups();
  }, [selectedAC, survey?.acAssignmentState, sessionData?.acAssignmentState]);

  // Fetch polling stations when group is selected
  useEffect(() => {
    const fetchPollingStations = async () => {
      if (!selectedPollingStation.groupName || !selectedPollingStation.acName) {
        setAvailablePollingStations([]);
        return;
      }
      
      try {
        setLoadingStations(true);
        // Use state from selectedPollingStation, survey, or default to 'West Bengal'
        const state = selectedPollingStation.state || survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        console.log('Fetching polling stations for Group:', selectedPollingStation.groupName, 'AC:', selectedPollingStation.acName, 'State:', state);
        const response = await apiService.getPollingStationsByGroup(
          state,
          selectedPollingStation.acName,
          selectedPollingStation.groupName
        );
        
        if (response.success) {
          // Backend returns { success: true, data: { stations: [...] } }
          // API service returns response.data which is { success: true, data: {...} }
          const responseData = response.data || {};
          const stations = responseData.stations || [];
          console.log('Polling stations fetched successfully:', stations.length, 'stations:', stations);
          setAvailablePollingStations(stations);
        } else {
          console.error('Failed to fetch polling stations:', response.message);
          setAvailablePollingStations([]);
        }
      } catch (error) {
        console.error('Error fetching polling stations:', error);
        setAvailablePollingStations([]);
      } finally {
        setLoadingStations(false);
      }
    };
    
    fetchPollingStations();
  }, [selectedPollingStation.groupName, selectedPollingStation.acName, selectedPollingStation.state, survey?.acAssignmentState, sessionData?.acAssignmentState]);

  // Update polling station GPS and check geofencing when station is selected
  useEffect(() => {
    const updateStationGPS = async () => {
      if (!selectedPollingStation.stationName || !selectedPollingStation.groupName || !selectedPollingStation.acName) {
        return;
      }
      
      try {
        const state = selectedPollingStation.state || survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        const response = await apiService.getPollingStationGPS(
          state,
          selectedPollingStation.acName,
          selectedPollingStation.groupName,
          selectedPollingStation.stationName
        );
        
        if (response.success) {
          setSelectedPollingStation((prev: any) => ({
            ...prev,
            gpsLocation: response.data.gps_location,
            latitude: response.data.latitude,
            longitude: response.data.longitude
          }));
          
          // Check geofencing if in CAPI mode and locationControlBooster is false
          if ((survey.mode === 'capi' || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && !locationControlBooster && locationData) {
            await checkGeofencing(response.data.latitude, response.data.longitude);
          } else {
            // Clear geofencing error if booster is enabled OR if not in CAPI mode
            setGeofencingError(null);
          }
        }
      } catch (error) {
        console.error('Error fetching polling station GPS:', error);
      }
    };
    
    updateStationGPS();
  }, [selectedPollingStation.stationName, selectedPollingStation.groupName, selectedPollingStation.acName, locationData, locationControlBooster, survey.mode, survey.assignedMode]);

  // Check locationControlBooster on mount
  useEffect(() => {
    const checkLocationControl = async () => {
      try {
        const userResult = await apiService.getCurrentUser();
        if (userResult.success && userResult.user) {
          const boosterEnabled = userResult.user.preferences?.locationControlBooster || false;
          setLocationControlBooster(boosterEnabled);
          // Clear geofencing error if booster is enabled
          if (boosterEnabled) {
            setGeofencingError(null);
          }
        }
      } catch (error) {
        console.error('Error checking location control booster:', error);
      }
    };
    
    checkLocationControl();
  }, []);
  
  // Clear geofencing error whenever booster is enabled
  useEffect(() => {
    if (locationControlBooster) {
      setGeofencingError(null);
    }
  }, [locationControlBooster]);

  // Geofencing check function (5KM radius)
  const checkGeofencing = async (stationLat: number, stationLng: number) => {
    if (!locationData || !locationData.latitude || !locationData.longitude) {
      setGeofencingError('GPS location not available. Please enable location services.');
      return false;
    }
    
    // Calculate distance using Haversine formula
    const R = 6371; // Earth's radius in kilometers
    const dLat = (locationData.latitude - stationLat) * Math.PI / 180;
    const dLng = (locationData.longitude - stationLng) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(stationLat * Math.PI / 180) * Math.cos(locationData.latitude * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in kilometers
    
    if (distance > 5) {
      setGeofencingError(`You are not within the 5KM radius of the Polling station's location. Distance: ${distance.toFixed(2)} KM`);
      return false;
    } else {
      setGeofencingError(null);
      return true;
    }
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  // Simple cleanup function - MUST unload any prepared recording
  const cleanupRecording = async () => {
    try {
      if (globalRecording) {
        console.log('Cleaning up recording...');
        try {
          const status = await globalRecording.getStatusAsync();
          console.log('Cleanup - recording status:', status);
          // ALWAYS try to unload - even if just prepared (not started)
          // This is critical to prevent "Only one Recording object can be prepared" error
          await globalRecording.stopAndUnloadAsync();
        } catch (error) {
          console.log('Error during cleanup:', error);
          // Try to stop anyway if status check failed
          try {
            await globalRecording.stopAndUnloadAsync();
          } catch (stopError) {
            console.log('Error stopping recording during cleanup:', stopError);
          }
        }
        globalRecording = null;
        // Wait longer for native resources to release
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Also reset audio mode to clear any prepared state
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (modeError) {
        console.log('Error resetting audio mode in cleanup:', modeError);
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
    // Prevent interaction if recording hasn't started (for CAPI mode only)
    if (!isCatiMode) {
      const shouldRecordAudio = (survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
      if (shouldRecordAudio && !isRecording && audioPermission !== false) {
        return; // Block interaction until recording starts
      }
    }
    
    setResponses(prev => ({
      ...prev,
      [questionId]: response
    }));
    
    // Handle AC selection specially
    if (questionId === 'ac-selection') {
      setSelectedAC(response);
      console.log('AC selected:', response);
      // Reset polling station selection when AC changes
      const state = survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
      setSelectedPollingStation({
        state: state,
        acName: response,
        acNo: null,
        pcNo: null,
        pcName: null,
        district: null,
        groupName: null,
        stationName: null,
        gpsLocation: null,
        latitude: null,
        longitude: null
      });
      // Clear groups and polling stations - they will be fetched by useEffect
      setAvailableGroups([]);
      setAvailablePollingStations([]);
      setGeofencingError(null);
    }
    
    // Handle polling station group selection
    if (questionId === 'polling-station-group') {
      setSelectedPollingStation((prev: any) => ({
        ...prev,
        groupName: response,
        stationName: null,
        gpsLocation: null,
        latitude: null,
        longitude: null
      }));
      setAvailablePollingStations([]);
      // Clear geofencing error if booster is enabled
      if (locationControlBooster) {
        setGeofencingError(null);
      } else {
        setGeofencingError(null); // Clear when group changes
      }
      // Mark polling station question as answered (group selected)
      setResponses(prev => ({
        ...prev,
        'polling-station-selection': response
      }));
    }
    
    // Handle polling station selection
    if (questionId === 'polling-station-station') {
      setSelectedPollingStation((prev: any) => ({
        ...prev,
        stationName: response
      }));
      // Clear geofencing error if booster is enabled
      if (locationControlBooster) {
        setGeofencingError(null);
      }
      // Mark polling station question as fully answered
      setResponses(prev => ({
        ...prev,
        'polling-station-selection': response
      }));
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
    
    // Check geofencing error for polling station questions (only if booster is not enabled)
    if (geofencingError && (currentQuestion as any)?.isPollingStationSelection && !locationControlBooster) {
      showSnackbar(geofencingError);
      return;
    }
    
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

  // Make call to respondent (CATI mode)
  const makeCallToRespondent = async () => {
    if (!catiQueueId) {
      showSnackbar('No respondent assigned');
      return;
    }

    try {
      setIsLoading(true);
      setCallStatus('calling');
      
      const result = await apiService.makeCallToRespondent(catiQueueId);
      
      if (result.success && result.data) {
        setCallId(result.data.callId);
        setCallStatus('calling');
        showSnackbar('Call initiated. Waiting for connection...');
      } else {
        setCallStatus('failed');
        const errorMsg = result.message || 'Failed to initiate call';
        showSnackbar(`Call failed: ${errorMsg}. You can abandon this interview.`);
      }
    } catch (error: any) {
      console.error('Error making call:', error);
      setCallStatus('failed');
      const errorMsg = error.response?.data?.message || error.message || 'Failed to make call';
      showSnackbar(`Call failed: ${errorMsg}. You can abandon this interview.`);
    } finally {
      setIsLoading(false);
    }
  };

  const abandonInterview = async () => {
    try {
      if (isCatiMode && catiQueueId) {
        // CATI mode - use CATI abandon endpoint
        // Map React Native reason values to backend expected values
        const reasonMap: Record<string, string> = {
          'not_available': 'no_answer',
          'refused': 'rejected',
          'wrong_number': 'does_not_exist',
          'call_later': 'call_later',
          'other': 'other'
        };
        
        const mappedReason = abandonReason ? (reasonMap[abandonReason] || 'other') : undefined;
        
        // Only send non-empty values
        const reasonToSend = mappedReason && mappedReason.trim() ? mappedReason : undefined;
        const notesToSend = abandonNotes && abandonNotes.trim() ? abandonNotes : undefined;
        const dateToSend = (abandonReason === 'call_later' && callLaterDate && callLaterDate.trim()) ? callLaterDate : undefined;
        
        const result = await apiService.abandonCatiInterview(
          catiQueueId,
          reasonToSend,
          notesToSend,
          dateToSend
        );
        
        if (result.success) {
          showSnackbar('Interview abandoned');
          navigation.navigate('Dashboard');
        } else {
          const errorMsg = result.message || 'Failed to abandon interview';
          showSnackbar(errorMsg);
        }
      } else if (sessionId) {
        // CAPI mode - use standard abandon endpoint
        await apiService.abandonInterview(sessionId);
        showSnackbar('Interview abandoned');
        navigation.navigate('Dashboard');
      } else {
        showSnackbar('No active interview to abandon');
        navigation.navigate('Dashboard');
      }
    } catch (err: any) {
      console.error('Error abandoning interview:', err);
      const errorMsg = err.response?.data?.message || err.message || 'Failed to abandon interview';
      showSnackbar(errorMsg);
    }
  };

  const startAudioRecording = async () => {
    // Synchronous check to prevent concurrent calls
    if (isRecording || isStartingRecording) {
      console.log('Already recording or starting, skipping...');
      return;
    }
    
    // Set lock immediately to prevent concurrent execution
    isStartingRecording = true;
    
    try {
      console.log('=== EXPO-AV AUDIO RECORDING START ===');
      
      // Step 1: Clean up any existing recording
      if (globalRecording) {
        try {
          console.log('Cleaning up existing recording...');
          const status = await globalRecording.getStatusAsync();
          if (status.isRecording || status.canRecord) {
            await globalRecording.stopAndUnloadAsync();
          }
        } catch (cleanupError) {
          console.log('Cleanup error (non-fatal):', cleanupError);
        }
        globalRecording = null;
        setRecording(null);
        // Wait for native module to release (matching working version timing)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Step 2: Request permissions first
      console.log('Requesting audio permissions...');
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== 'granted') {
        throw new Error('Audio permission not granted');
      }
      
      // Step 3: Set audio mode for recording (no reset first - like working version)
      console.log('Setting audio mode for recording...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      
      // Wait for audio mode to take effect
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 4: Create recording object
      console.log('Creating new recording object...');
      const recording = new Audio.Recording();
      
      // Step 5: Prepare recording (matching working version settings: mono, 128000 bitrate)
      console.log('Preparing recording...');
      try {
        await recording.prepareToRecordAsync({
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 44100,
            numberOfChannels: 1, // Mono like working version
            bitRate: 128000, // Original bitrate like working version
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
      } catch (prepareError: any) {
        console.error('Prepare error:', prepareError);
        isStartingRecording = false; // Release lock before throwing
        throw new Error(`Failed to prepare recording: ${prepareError.message}`);
      }
      
      // Step 6: Set globalRecording after successful preparation
      globalRecording = recording;
      setRecording(recording);
      
      // Step 7: Wait before starting (Android MediaRecorder needs this)
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 8: Check status before starting
      const statusBeforeStart = await recording.getStatusAsync();
      console.log('Status before start:', statusBeforeStart);
      
      if (!statusBeforeStart.canRecord) {
        globalRecording = null;
        setRecording(null);
        isStartingRecording = false; // Release lock before throwing
        throw new Error('Recording not ready - cannot start');
      }
      
      // Step 9: Start recording
      console.log('Starting recording...');
      try {
        await recording.startAsync();
      } catch (startError: any) {
        console.error('Start error:', startError);
        globalRecording = null;
        setRecording(null);
        isStartingRecording = false; // Release lock before throwing
        throw new Error(`Failed to start recording: ${startError.message}`);
      }
      
      // Step 10: Verify it actually started
      const statusAfterStart = await recording.getStatusAsync();
      console.log('Status after start:', statusAfterStart);
      
      if (!statusAfterStart.isRecording) {
        globalRecording = null;
        setRecording(null);
        isStartingRecording = false; // Release lock before throwing
        throw new Error('Recording did not start - status verification failed');
      }
      
      // Success!
      setIsRecording(true);
      setIsAudioPaused(false);
      setAudioPermission(true);
      isStartingRecording = false; // Release lock on success
      
      console.log('✓ Recording started successfully');
      showSnackbar('Audio recording started');
      
    } catch (error: any) {
      console.error('❌ Error starting recording:', error);
      showSnackbar(`Failed to start recording: ${error.message || 'Unknown error'}`);
      setAudioPermission(false);
      setIsRecording(false);
      setIsAudioPaused(false);
      setRecording(null);
      isStartingRecording = false; // Always release lock on error
      
      // Clean up on error
      if (globalRecording) {
        try {
          const status = await globalRecording.getStatusAsync();
          if (status.isRecording) {
            await globalRecording.stopAndUnloadAsync();
          }
        } catch (cleanupError) {
          console.log('Error during error cleanup:', cleanupError);
        }
        globalRecording = null;
      }
    }
  };

  const stopAudioRecording = async () => {
    try {
      console.log('Stopping audio recording...');
      
      if (!isRecording || !globalRecording) {
        console.log('No active recording to stop');
        return audioUri;
      }
      
      console.log('Attempting to stop and unload...');
      await globalRecording.stopAndUnloadAsync();
      
      const uri = globalRecording.getURI();
      console.log('Recording stopped. URI:', uri);
      
      if (uri) {
        setAudioUri(uri);
      }
      
      setIsRecording(false);
      setIsAudioPaused(false);
      setRecording(null);
      globalRecording = null;
      isStartingRecording = false; // Release lock when stopping
      
      // Reset audio mode after stopping
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
        });
      } catch (modeError) {
        console.log('Error resetting audio mode after stop:', modeError);
      }
      
      showSnackbar('Audio recording completed');
      return uri;
    } catch (error) {
      console.error('Error stopping recording:', error);
      showSnackbar('Failed to stop recording');
      
      // Force cleanup anyway
      globalRecording = null;
      setIsRecording(false);
      setIsAudioPaused(false);
      setRecording(null);
      
      return audioUri;
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
      // Stop audio recording and upload if available (only for CAPI mode)
      let audioUrl = null;
      let audioFileSize = 0;
      
      if (!isCatiMode) {
        // Only process audio for CAPI mode
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
      }
      
      // Prepare final response data for ALL questions (including skipped ones)
      const finalResponses = allQuestions.map((question: any, index: number) => {
        // For multiple_choice with allowMultiple, default to array; otherwise default to empty string
        const defaultResponse = (question.type === 'multiple_choice' && question.settings?.allowMultiple) ? [] : '';
        const response = responses[question.id] !== undefined ? responses[question.id] : defaultResponse;
        
        // Process response to include option codes and handle "Others" text input
        // Ensure processedResponse is an array for multiple_choice with allowMultiple
        let processedResponse: any;
        if (question.type === 'multiple_choice' && question.settings?.allowMultiple) {
          // Ensure it's an array - if it's not, try to convert it
          if (Array.isArray(response)) {
            processedResponse = response;
          } else if (response && response !== '') {
            // If it's a single value, convert to array
            processedResponse = [response];
          } else {
            // Empty array
            processedResponse = [];
          }
        } else {
          processedResponse = response || '';
        }
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

      let result;
      
      if (isCatiMode && catiQueueId) {
        // CATI mode - use CATI complete endpoint
        // Backend expects flat structure, not nested in metadata
        const answeredCount = finalResponses.filter((r: any) => hasResponseContent(r.response)).length;
        const totalCount = allQuestions.length;
        
        result = await apiService.completeCatiInterview(catiQueueId, {
          sessionId: sessionId,
          responses: finalResponses,
          selectedAC: selectedAC || null,
          selectedPollingStation: selectedPollingStation.stationName ? {
            state: selectedPollingStation.state,
            acNo: selectedPollingStation.acNo,
            acName: selectedPollingStation.acName,
            pcNo: selectedPollingStation.pcNo,
            pcName: selectedPollingStation.pcName,
            district: selectedPollingStation.district,
            groupName: selectedPollingStation.groupName,
            stationName: selectedPollingStation.stationName,
            gpsLocation: selectedPollingStation.gpsLocation,
            latitude: selectedPollingStation.latitude,
            longitude: selectedPollingStation.longitude
          } : null,
          totalTimeSpent: duration,
          startTime: sessionData?.startTime || startTime || new Date(),
          endTime: new Date(),
          totalQuestions: totalCount,
          answeredQuestions: answeredCount,
          completionPercentage: totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0
        });
      } else {
        // CAPI mode - use standard complete endpoint
        result = await apiService.completeInterview(sessionId, {
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
            selectedAC: selectedAC,
            selectedPollingStation: selectedPollingStation.stationName ? {
              state: selectedPollingStation.state,
              acNo: selectedPollingStation.acNo,
              acName: selectedPollingStation.acName,
              pcNo: selectedPollingStation.pcNo,
              pcName: selectedPollingStation.pcName,
              district: selectedPollingStation.district,
              groupName: selectedPollingStation.groupName,
              stationName: selectedPollingStation.stationName,
              gpsLocation: selectedPollingStation.gpsLocation,
              latitude: selectedPollingStation.latitude,
              longitude: selectedPollingStation.longitude
            } : null,
            totalQuestions: allQuestions.length,
            answeredQuestions: finalResponses.filter((r: any) => hasResponseContent(r.response)).length,
            skippedQuestions: finalResponses.filter((r: any) => !hasResponseContent(r.response)).length,
            completionPercentage: Math.round((finalResponses.filter((r: any) => hasResponseContent(r.response)).length / allQuestions.length) * 100)
          }
        });
      }

      if (result.success) {
        Alert.alert(
          'Interview Completed',
          'Interview Completed and submitted for Quality Review.',
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

  // Helper function to check if an option should not be shuffled
  const isNonShufflableOption = (option: any): boolean => {
    // Get option text and value, then strip translations
    const rawOptionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
    const rawOptionValue = typeof option === 'object' ? (option.value || option.text || '') : String(option);
    
    // Strip translations before checking
    const optionText = getMainText(rawOptionText).toLowerCase().trim();
    const optionValue = getMainText(rawOptionValue).toLowerCase().trim();
    
    // Check for special options that should not be shuffled
    // 1. None
    if (optionText === 'none' || optionValue === 'none') return true;
    
    // 2. Others (Specify) and variants - check for "other" or "others" (may include "specify")
    if (optionText.includes('other') || optionValue.includes('other')) {
      return true; // Matches "Other", "Others", "Others (specify)", "Others (Specify)", etc.
    }
    
    // 3. NOTA
    if (optionText === 'nota' || optionValue === 'nota') return true;
    
    // 4. Not eligible for voting / Not eligible
    if (optionText.includes('not eligible') || optionValue.includes('not eligible')) return true;
    
    // 5. No response / Refused to answer / Refused
    if (optionText.includes('no response') || optionValue.includes('no response') ||
        optionText.includes('refused') || optionValue.includes('refused')) return true;
    
    // 6. Independent
    if (optionText === 'independent' || optionValue === 'independent') return true;
    
    // 7. Did not vote / Didn't vote
    if (optionText.includes('did not vote') || optionValue.includes('did not vote') ||
        optionText.includes('didn\'t vote') || optionValue.includes('didn\'t vote') ||
        optionText.includes('didnt vote') || optionValue.includes('didnt vote')) return true;
    
    return false;
  };

  // Fisher-Yates shuffle algorithm for randomizing options (only shufflable ones)
  const shuffleArray = (array: any[]): any[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Helper function to compute shuffled options (pure function, no side effects)
  const computeShuffledOptions = useCallback((questionId: string, originalOptions: any[], question?: any): any[] => {
    if (!originalOptions || originalOptions.length === 0) return originalOptions || [];
    
    // Check if shuffling is enabled for this question (default to true if not set for backward compatibility)
    const shouldShuffle = question?.settings?.shuffleOptions !== false;
    
    // If shuffling is disabled, still move "Others" to the end
    if (!shouldShuffle) {
      // Separate "Others" options from regular options
      const othersOptions: any[] = [];
      const regularOptions: any[] = [];
      
      originalOptions.forEach((option) => {
        const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
        if (isOthersOption(optionText)) {
          othersOptions.push(option);
        } else {
          regularOptions.push(option);
        }
      });
      
      // Return with "Others" at the end
      return [...regularOptions, ...othersOptions];
    }
    
    // If already shuffled for this question, return cached (should already have "Others" at end)
    if (shuffledOptions[questionId]) {
      return shuffledOptions[questionId];
    }
    
    // Compute shuffled options but don't call setState here (will be done in useEffect)
    // Separate options: shufflable, non-shufflable (except Others), and Others
    const nonShufflableOptions: Array<{ option: any; originalIndex: number }> = []; // Non-shufflable options except "Others"
    const shufflableOptions: any[] = [];
    const othersOptions: any[] = []; // "Others" options - will be placed at the end
    const originalIndices = new Map<number, any>(); // Track original indices for non-shufflable options (except Others)
    
    originalOptions.forEach((option, index) => {
      const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
      if (isOthersOption(optionText)) {
        // "Others" options - will be placed at the end
        othersOptions.push(option);
      } else if (isNonShufflableOption(option)) {
        // Other non-shufflable options - maintain original position
        nonShufflableOptions.push({ option, originalIndex: index });
        originalIndices.set(index, option);
      } else {
        // Shufflable options
        shufflableOptions.push(option);
      }
    });
    
    // Shuffle only the shufflable options
    const shuffledShufflable = shuffleArray(shufflableOptions);
    
    // Reconstruct the array maintaining original positions of non-shufflable options (except Others)
    const result: any[] = [];
    let shufflableIndex = 0;
    let nonShufflableIndex = 0;
    
    for (let i = 0; i < originalOptions.length; i++) {
      const option = originalOptions[i];
      const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
      
      if (isOthersOption(optionText)) {
        // Skip "Others" options - they'll be added at the end
        continue;
      } else if (originalIndices.has(i)) {
        // Place non-shufflable option in its original position
        result.push(nonShufflableOptions[nonShufflableIndex].option);
        nonShufflableIndex++;
      } else {
        // Place shuffled option
        result.push(shuffledShufflable[shufflableIndex]);
        shufflableIndex++;
      }
    }
    
    // Combine: regular options first, then "Others" options at the end
    const finalResult = [...result, ...othersOptions];
    
    return finalResult;
  }, [shuffledOptions]);

  // Memoize display options for current question to avoid re-computation
  const currentQuestionDisplayOptions = useMemo(() => {
    if (!currentQuestion) return [];
    
    // Skip for polling station selection questions (they don't have options)
    if ((currentQuestion as any)?.isPollingStationSelection) {
      return [];
    }
    
    const questionId = currentQuestion.id;
    const questionOptions = 'options' in currentQuestion ? (currentQuestion as any).options : [];
    let displayOptions = questionOptions || [];
    
    if (currentQuestion.type === 'multiple_choice') {
      // Check if we have cached shuffled options
      if (shuffledOptions[questionId]) {
        displayOptions = shuffledOptions[questionId];
      } else {
        // Compute shuffled options (will be cached in useEffect)
        displayOptions = computeShuffledOptions(questionId, questionOptions || [], currentQuestion);
      }
    } else if (currentQuestion.type === 'single_choice' || currentQuestion.type === 'single_select' || currentQuestion.type === 'dropdown') {
      // Move "Others" to the end for single_choice and dropdown
      const othersOptions: any[] = [];
      const regularOptions: any[] = [];
      (questionOptions || []).forEach((option: any) => {
        const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
        if (isOthersOption(optionText)) {
          othersOptions.push(option);
        } else {
          regularOptions.push(option);
        }
      });
      displayOptions = [...regularOptions, ...othersOptions];
    }
    
    return displayOptions;
  }, [currentQuestion, shuffledOptions, computeShuffledOptions]);

  // Update shuffledOptions state when current question changes (useEffect to avoid render loop)
  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'multiple_choice') return;
    
    // Skip for polling station selection questions (they don't have options)
    if ((currentQuestion as any)?.isPollingStationSelection) return;
    
    const questionId = currentQuestion.id;
    const questionOptions = 'options' in currentQuestion ? (currentQuestion as any).options : [];
    // Only compute and cache if not already cached
    if (!shuffledOptions[questionId] && questionOptions) {
      const computed = computeShuffledOptions(questionId, questionOptions, currentQuestion);
      setShuffledOptions(prev => {
        if (!prev[questionId]) {
          return { ...prev, [questionId]: computed };
        }
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id, currentQuestion?.type]);

  // Scroll to top when question changes
  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: 0, animated: true });
    }
  }, [currentQuestionIndex]);

  // Render question based on type
  const renderQuestion = (question: any) => {
    // For multiple_choice questions with allowMultiple, initialize as array if not set
    const defaultResponse = (question.type === 'multiple_choice' && question.settings?.allowMultiple) ? [] : '';
    const currentResponse = responses[question.id] !== undefined ? responses[question.id] : defaultResponse;
    const questionId = question.id;
    
    // Use memoized display options for current question, or compute for other questions
    let displayOptions = question.options;
    if (question.id === currentQuestion?.id && currentQuestionDisplayOptions.length > 0) {
      displayOptions = currentQuestionDisplayOptions;
    } else if (question.type === 'multiple_choice') {
      if (shuffledOptions[questionId]) {
        displayOptions = shuffledOptions[questionId];
      } else {
        // Compute shuffled options (will be cached in useEffect if this is the current question)
        displayOptions = computeShuffledOptions(questionId, question.options || [], question);
      }
    } else if (question.type === 'single_choice' || question.type === 'single_select' || question.type === 'dropdown') {
      // Move "Others" to the end for single_choice and dropdown
      const othersOptions: any[] = [];
      const regularOptions: any[] = [];
      (question.options || []).forEach((option: any) => {
        const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
        if (isOthersOption(optionText)) {
          othersOptions.push(option);
        } else {
          regularOptions.push(option);
        }
      });
      displayOptions = [...regularOptions, ...othersOptions];
    }

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
        
        // Check if "None" option exists (strip translations before checking)
        const noneOption = shuffledMultipleChoiceOptions.find((opt: any) => {
          const optText = opt.text || '';
          const mainText = getMainText(optText);
          return mainText.toLowerCase().trim() === 'none';
        });
        const noneOptionValue = noneOption ? (noneOption.value || noneOption.text) : null;
        
        // Check if "Others" option exists
        const othersOption = shuffledMultipleChoiceOptions.find((opt: any) => {
          const optText = opt.text || '';
          return isOthersOption(optText);
        });
        const othersOptionValue = othersOption ? (othersOption.value || othersOption.text) : null;
        
        // Helper to normalize option values for comparison (strip translations)
        const normalizeForComparison = (val: any): string => {
          if (!val) return String(val || '');
          return getMainText(String(val)).toLowerCase().trim();
        };
        
        // Check if "Others" is selected (normalize both values before comparing)
        const normalizedOthersValue = othersOptionValue ? normalizeForComparison(othersOptionValue) : null;
        const isOthersSelected = allowMultiple 
          ? (Array.isArray(currentResponse) && currentResponse.some((r: any) => normalizeForComparison(r) === normalizedOthersValue))
          : (normalizeForComparison(currentResponse) === normalizedOthersValue);
        
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
              // Strip translations before checking for "None"
              const mainText = getMainText(String(optionText));
              const isNoneOption = mainText.toLowerCase().trim() === 'none';
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
                          // Deselecting - remove from array while preserving order of remaining items
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
                          // Selecting - add to end to preserve selection order
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
                            // Add to end to preserve selection order (order in which options were first selected)
                            // If option was previously selected and deselected, it goes to the end (newest selection)
                            currentAnswers.push(optionValue);
                          }
                        }
                        // The array order now represents the order in which options were selected
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
                  <Text style={styles.optionText}>{getMainText(optionText)}</Text>
                  {(() => {
                    const parsed = parseTranslation(optionText);
                    return parsed.translation ? (
                      <Text style={[styles.optionText, { fontSize: 14, fontStyle: 'italic', color: '#666' }]}>
                        {parsed.translation}
                      </Text>
                    ) : null;
                  })()}
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
                    <Text style={styles.optionText}>{getMainText(option.text)}</Text>
                    {(() => {
                      const parsed = parseTranslation(option.text);
                      return parsed.translation ? (
                        <Text style={[styles.optionText, { fontSize: 14, fontStyle: 'italic', color: '#666' }]}>
                          {parsed.translation}
                        </Text>
                      ) : null;
                    })()}
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
                  shuffledDropdownOptions.map((option: any) => {
                    const parsed = parseTranslation(option.text);
                    return {
                      text: parsed.translation ? `${parsed.mainText} / ${parsed.translation}` : parsed.mainText,
                      onPress: () => handleResponseChange(question.id, option.value)
                    };
                  })
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
            <View style={styles.ratingButtonsColumn}>
              {ratings.map((rating) => {
                const label = labels[rating - min] || '';
                return (
                  <View key={rating} style={styles.ratingButtonWrapperVertical}>
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
                      <View>
                        <Text style={styles.ratingLabel}>{getMainText(label)}</Text>
                        {(() => {
                          const parsed = parseTranslation(label);
                          return parsed.translation ? (
                            <Text style={[styles.ratingLabel, { fontSize: 10, fontStyle: 'italic', color: '#888' }]}>
                              {parsed.translation}
                            </Text>
                          ) : null;
                        })()}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {(minLabel || maxLabel) && (
              <View style={styles.ratingLabelsRow}>
                <View>
                  <Text style={styles.ratingScaleLabel}>{getMainText(minLabel)}</Text>
                    {(() => {
                      const parsed = parseTranslation(minLabel);
                      return parsed.translation ? (
                        <Text style={[styles.ratingScaleLabel, { fontSize: 10, fontStyle: 'italic', color: '#888' }]}>
                          {parsed.translation}
                        </Text>
                      ) : null;
                    })()}
                </View>
                <View>
                  <Text style={styles.ratingScaleLabel}>{getMainText(maxLabel)}</Text>
                    {(() => {
                      const parsed = parseTranslation(maxLabel);
                      return parsed.translation ? (
                        <Text style={[styles.ratingScaleLabel, { fontSize: 10, fontStyle: 'italic', color: '#888' }]}>
                          {parsed.translation}
                        </Text>
                      ) : null;
                    })()}
                </View>
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

      case 'polling_station':
        return (
          <View style={styles.pollingStationContainer}>
            {/* Group Selection */}
            <View style={[styles.pollingStationSection, showGroupDropdown && { zIndex: 1001 }]}>
              <Text style={styles.pollingStationLabel}>Select Group *</Text>
              {loadingGroups ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : availableGroups.length === 0 ? (
                <Text style={styles.pollingStationError}>No groups available. Please select an AC first.</Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowGroupDropdown(true)}
                  >
                    <Text style={[
                      styles.dropdownButtonText,
                      !selectedPollingStation.groupName && styles.dropdownPlaceholder
                    ]}>
                      {selectedPollingStation.groupName || 'Select a group...'}
                    </Text>
                    <Text style={styles.dropdownArrow}>▼</Text>
                  </TouchableOpacity>
                  
                  {/* Group Selection Modal - Bottom Sheet */}
                  <Modal
                    visible={showGroupDropdown}
                    transparent={true}
                    animationType="slide"
                    onRequestClose={() => setShowGroupDropdown(false)}
                  >
                    <View style={styles.modalBackdrop}>
                      <TouchableOpacity
                        style={styles.modalBackdropTouchable}
                        activeOpacity={1}
                        onPress={() => setShowGroupDropdown(false)}
                      />
                      <View style={styles.bottomSheetContainer}>
                        <View style={styles.bottomSheetHeader}>
                          <Text style={styles.bottomSheetTitle}>Select Group</Text>
                          <TouchableOpacity onPress={() => setShowGroupDropdown(false)}>
                            <Text style={styles.bottomSheetClose}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView 
                          style={styles.bottomSheetContent}
                          contentContainerStyle={styles.bottomSheetContentInner}
                          showsVerticalScrollIndicator={true}
                          keyboardShouldPersistTaps="handled"
                        >
                          {availableGroups.map((item, index) => (
                            <TouchableOpacity
                              key={`group-${index}`}
                              activeOpacity={0.7}
                              style={[
                                styles.bottomSheetItem,
                                selectedPollingStation.groupName === item.name && styles.bottomSheetItemSelected
                              ]}
                              onPress={() => {
                                handleResponseChange('polling-station-group', item.name);
                                setShowGroupDropdown(false);
                              }}
                            >
                              <Text style={[
                                styles.bottomSheetItemText,
                                selectedPollingStation.groupName === item.name && styles.bottomSheetItemTextSelected
                              ]}>
                                {item.name} ({item.polling_station_count} stations)
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                  </Modal>
                </>
              )}
            </View>

            {/* Polling Station Selection - Only show if group is selected */}
            {selectedPollingStation.groupName && (
              <View style={[styles.pollingStationSection, showStationDropdown && { zIndex: 1001 }]}>
                <Text style={styles.pollingStationLabel}>Select Polling Station *</Text>
                {loadingStations ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : availablePollingStations.length === 0 ? (
                  <Text style={styles.pollingStationError}>No polling stations available for this group.</Text>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.dropdownButton}
                      onPress={() => setShowStationDropdown(true)}
                    >
                      <Text style={[
                        styles.dropdownButtonText,
                        !selectedPollingStation.stationName && styles.dropdownPlaceholder
                      ]}>
                        {selectedPollingStation.stationName || 'Select a polling station...'}
                      </Text>
                      <Text style={styles.dropdownArrow}>▼</Text>
                    </TouchableOpacity>
                    
                    {/* Polling Station Selection Modal - Bottom Sheet */}
                    <Modal
                      visible={showStationDropdown}
                      transparent={true}
                      animationType="slide"
                      onRequestClose={() => setShowStationDropdown(false)}
                    >
                      <View style={styles.modalBackdrop}>
                        <TouchableOpacity
                          style={styles.modalBackdropTouchable}
                          activeOpacity={1}
                          onPress={() => setShowStationDropdown(false)}
                        />
                        <View style={styles.bottomSheetContainer}>
                          <View style={styles.bottomSheetHeader}>
                            <Text style={styles.bottomSheetTitle}>Select Polling Station</Text>
                            <TouchableOpacity onPress={() => setShowStationDropdown(false)}>
                              <Text style={styles.bottomSheetClose}>✕</Text>
                            </TouchableOpacity>
                          </View>
                          <ScrollView 
                            style={styles.bottomSheetContent}
                            contentContainerStyle={styles.bottomSheetContentInner}
                            showsVerticalScrollIndicator={true}
                            keyboardShouldPersistTaps="handled"
                          >
                            {availablePollingStations.map((item, index) => (
                              <TouchableOpacity
                                key={`station-${index}`}
                                activeOpacity={0.7}
                                style={[
                                  styles.bottomSheetItem,
                                  selectedPollingStation.stationName === item.name && styles.bottomSheetItemSelected
                                ]}
                                onPress={() => {
                                  handleResponseChange('polling-station-station', item.name);
                                  setShowStationDropdown(false);
                                }}
                              >
                                <Text style={[
                                  styles.bottomSheetItemText,
                                  selectedPollingStation.stationName === item.name && styles.bottomSheetItemTextSelected
                                ]}>
                                  {item.name}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      </View>
                    </Modal>
                  </>
                )}
              </View>
            )}

            {/* Geofencing Error Display - Only show if booster is not enabled */}
            {geofencingError && !locationControlBooster && (
              <View style={styles.geofencingErrorContainer}>
                <Text style={styles.geofencingErrorText}>{geofencingError}</Text>
                <Text style={styles.geofencingErrorHint}>
                  Please abandon the interview or change the Group, AC, and Polling Station.
                </Text>
              </View>
            )}
          </View>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {/* Recording Indicator / Call Status and Abandon button */}
          <View style={styles.headerActions}>
            {/* CATI Call Status */}
            {isCatiMode && (
              <View style={styles.callStatusContainer}>
            {callStatus === 'calling' && (
              <View style={styles.callStatusIndicator}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={styles.callStatusText}>Calling...</Text>
              </View>
            )}
            {callStatus === 'connected' && (
              <View style={styles.callStatusIndicator}>
                <View style={[styles.callStatusDot, { backgroundColor: '#059669' }]} />
                <Text style={styles.callStatusText}>Call Started</Text>
              </View>
            )}
                {callStatus === 'failed' && (
                  <View style={styles.callStatusIndicator}>
                    <View style={[styles.callStatusDot, { backgroundColor: '#ef4444' }]} />
                    <Text style={styles.callStatusText}>Call Failed</Text>
                  </View>
                )}
                {catiRespondent && (
                  <Text style={styles.respondentInfo}>
                    {catiRespondent.name} - {catiRespondent.phone}
                  </Text>
                )}
              </View>
            )}
            
            {/* Recording Indicator - Just the red dot (CAPI only) */}
            {!isCatiMode && ((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && (
              <View style={styles.recordingDotIndicator}>
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
              </View>
            )}
            
            <Button
              mode="contained"
              onPress={() => {
                if (isCatiMode) {
                  setShowAbandonModal(true);
                } else {
                  setShowAbandonConfirm(true);
                }
              }}
              icon="stop"
              style={styles.actionButton}
              buttonColor="#ef4444"
            >
              Abandon
            </Button>
          </View>
        </View>
        
        <View style={styles.headerInfo}>
          <View style={styles.progressAndTimerRow}>
          <Text style={styles.progressText}>
            Question {currentQuestionIndex + 1} of {visibleQuestions.length}
          </Text>
          <Text style={styles.durationText}>{formatTime(duration)}</Text>
          </View>
        </View>
        
        <ProgressBar progress={progress} color="#2563eb" style={styles.progressBar} />
      </View>

      <ScrollView 
        ref={scrollViewRef}
        style={styles.content}
      >
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
            
            <View style={styles.questionHeader}>
              <Text style={styles.questionText}>
                {getMainText(currentQuestion.text)}
                {(() => {
                  const parsed = parseTranslation(currentQuestion.text);
                  return parsed.translation ? (
                    <Text style={{ fontSize: 18, fontStyle: 'italic', color: '#666', marginTop: 4 }}>
                      {parsed.translation}
                    </Text>
                  ) : null;
                })()}
                {currentQuestion.required && <Text style={styles.requiredAsterisk}> *</Text>}
              </Text>
            </View>
            {currentQuestion.description && (
              <Text style={styles.questionDescription}>{currentQuestion.description}</Text>
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
            Submit
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={goToNextQuestion}
            style={[
              styles.nextButton,
              ((targetAudienceErrors.has(visibleQuestions[currentQuestionIndex]?.id) || 
               (visibleQuestions[currentQuestionIndex]?.required && 
                !responses[visibleQuestions[currentQuestionIndex]?.id]) ||
               (geofencingError && (currentQuestion as any)?.isPollingStationSelection && !locationControlBooster)) ||
               (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                !isRecording && audioPermission !== false)) && styles.disabledButton
            ]}
            disabled={targetAudienceErrors.has(visibleQuestions[currentQuestionIndex]?.id) || 
                     (visibleQuestions[currentQuestionIndex]?.required && 
                      !responses[visibleQuestions[currentQuestionIndex]?.id] &&
                      // For polling station question, check if both group and station are selected
                      !((currentQuestion as any)?.isPollingStationSelection && 
                        selectedPollingStation.groupName && selectedPollingStation.stationName)) ||
                     (geofencingError && (currentQuestion as any)?.isPollingStationSelection && !locationControlBooster) ||
                     (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                      !isRecording && audioPermission !== false)}
          >
            Next
          </Button>
        )}
      </View>

      {/* Abandon/Exit Confirmation Modal (CAPI) */}
      {showAbandonConfirm && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Leave Interview</Text>
            <Text style={styles.modalText}>
              Are you sure you want to leave this interview? All progress will be lost.
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
                Leave
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* CATI Abandon Modal */}
      {showAbandonModal && (
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
            <Text style={styles.modalTitle}>Abandon CATI Interview</Text>
            <Text style={styles.modalText}>
              {callStatus === 'failed' 
                ? 'The call failed. You can abandon this interview or provide a reason below.'
                : 'Please provide a reason for abandoning this interview.'}
            </Text>
            
            {callStatus !== 'failed' && (
              <>
                <Text style={styles.modalLabel}>Reason (Required)</Text>
                <View style={styles.radioGroup}>
                  <RadioButton.Group
                    onValueChange={setAbandonReason}
                    value={abandonReason}
                  >
                    <RadioButton.Item label="Respondent Not Available" value="not_available" />
                    <RadioButton.Item label="Respondent Refused" value="refused" />
                    <RadioButton.Item label="Wrong Number" value="wrong_number" />
                    <RadioButton.Item label="Call Later" value="call_later" />
                    <RadioButton.Item label="Other" value="other" />
                  </RadioButton.Group>
                </View>
                
                {abandonReason === 'call_later' && (
                  <View style={styles.datePickerContainer}>
                    <Text style={styles.modalLabel}>Call Later Date</Text>
                    <TextInput
                      mode="outlined"
                      placeholder="YYYY-MM-DD"
                      value={callLaterDate}
                      onChangeText={setCallLaterDate}
                      style={styles.dateInput}
                    />
                  </View>
                )}
              </>
            )}
            
            <Text style={styles.modalLabel}>Notes (Optional)</Text>
            <TextInput
              mode="outlined"
              multiline
              numberOfLines={3}
              placeholder="Add any additional notes..."
              value={abandonNotes}
              onChangeText={setAbandonNotes}
              style={styles.notesInput}
            />
            
            <View style={styles.modalButtons}>
              <Button
                mode="outlined"
                onPress={() => {
                  setShowAbandonModal(false);
                  setAbandonReason('');
                  setAbandonNotes('');
                  setCallLaterDate('');
                }}
                style={styles.modalButton}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() => {
                  if (callStatus !== 'failed' && !abandonReason) {
                    showSnackbar('Please select a reason for abandoning');
                    return;
                  }
                  if (abandonReason === 'call_later' && !callLaterDate) {
                    showSnackbar('Please select a date for calling later');
                    return;
                  }
                  setShowAbandonModal(false);
                  abandonInterview();
                }}
                style={[styles.modalButton, { backgroundColor: '#ef4444' }]}
              >
                Abandon
              </Button>
            </View>
          </ScrollView>
        </View>
      )}

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={3000}
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordingDotIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
    marginBottom: 8,
  },
  progressAndTimerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
  },
  progressText: {
    fontSize: 14,
    color: '#6b7280',
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
  questionHeader: {
    marginBottom: 2,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    lineHeight: 24,
  },
  requiredAsterisk: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ef4444',
  },
  questionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
    lineHeight: 20,
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
    marginTop: 2,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
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
    position: 'relative',
    marginTop: 8,
    zIndex: 1,
  },
  dropdownText: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 8,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  dropdownButtonText: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  dropdownPlaceholder: {
    color: '#9ca3af',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 8,
  },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    height: 300,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    zIndex: 1000,
    overflow: 'hidden',
  },
  dropdownListInner: {
    height: '100%',
    width: '100%',
  },
  dropdownListContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  dropdownItemSelected: {
    backgroundColor: '#eff6ff',
  },
  dropdownItemText: {
    fontSize: 15,
    color: '#111827',
  },
  dropdownItemTextSelected: {
    color: '#2563eb',
    fontWeight: '600',
  },
  ratingContainer: {
    marginTop: 2,
  },
  ratingButtonsColumn: {
    flexDirection: 'column',
    marginBottom: 8,
  },
  ratingButtonWrapperVertical: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
    paddingVertical: 2,
  },
  ratingButton: {
    minWidth: 50,
  },
  ratingButtonSelected: {
    backgroundColor: '#fbbf24',
  },
  ratingLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 12,
    flex: 1,
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
  callStatusContainer: {
    marginRight: 8,
    alignItems: 'flex-end',
  },
  callStatusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  callStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  callStatusText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  respondentInfo: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  modalContentContainer: {
    paddingBottom: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  radioGroup: {
    marginBottom: 8,
  },
  datePickerContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  dateInput: {
    marginTop: 8,
  },
  notesInput: {
    marginTop: 8,
    minHeight: 80,
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
  pollingStationContainer: {
    marginTop: 8,
  },
  pollingStationSection: {
    marginBottom: 16,
  },
  pollingStationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  pollingStationButton: {
    marginTop: 4,
  },
  pollingStationError: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
    marginTop: 8,
  },
  geofencingErrorContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 8,
  },
  geofencingErrorText: {
    fontSize: 14,
    color: '#dc2626',
    fontWeight: '600',
    marginBottom: 4,
  },
  geofencingErrorHint: {
    fontSize: 12,
    color: '#991b1b',
    marginTop: 4,
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
  // Modal styles for polling station selection
  pollingStationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pollingStationModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.8,
    paddingBottom: 20,
  },
  pollingStationModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  pollingStationModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  pollingStationModalList: {
    flex: 1,
  },
  pollingStationModalItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  pollingStationModalItemText: {
    fontSize: 16,
    color: '#111827',
  },
  // Bottom Sheet Modal Styles
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  bottomSheetContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.8,
    height: 450, // Fixed height to show at least 6-7 items comfortably (each item ~56px + header ~70px)
    width: '100%',
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  bottomSheetClose: {
    fontSize: 24,
    color: '#6b7280',
    fontWeight: '300',
  },
  bottomSheetContent: {
    flex: 1,
  },
  bottomSheetContentInner: {
    paddingBottom: 20,
  },
  bottomSheetItem: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  bottomSheetItemSelected: {
    backgroundColor: '#eff6ff',
  },
  bottomSheetItemText: {
    fontSize: 16,
    color: '#111827',
  },
  bottomSheetItemTextSelected: {
    color: '#2563eb',
    fontWeight: '600',
  },
});