import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  Image,
  Pressable,
  Animated,
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
  Switch,
} from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { apiService } from '../services/api';
import { LocationService } from '../utils/location';
import { Survey, SurveyResponse } from '../types';
import { parseTranslation, getMainText, parseMultiTranslation, getLanguageText } from '../utils/translations';
import { isGenderQuestion } from '../utils/genderUtils';
import { offlineStorage, OfflineInterview } from '../services/offlineStorage';
import { offlineDataCache } from '../services/offlineDataCache';

const { width, height } = Dimensions.get('window');

// Helper function to get party logo path based on option text
// Also checks if logos should be shown for the current question
const getPartyLogo = (optionText: string | null | undefined, questionText?: string | null): string | null => {
  if (!optionText) return null;
  
  // Check if this is Question 12 - "In your opinion what could be the reasons for voting for BJP"
  // Don't show logos for this question
  if (questionText) {
    const qText = String(questionText).toLowerCase();
    if (qText.includes('in your opinion what could be the reason') && qText.includes('voting') && qText.includes('bjp') ||
        qText.includes('in your opinion what could be the reasons') && qText.includes('voting') && qText.includes('bjp') ||
        qText.includes('reason for voting bjp') ||
        qText.includes('reasons for voting bjp') ||
        qText.includes('reason for voting for bjp') ||
        qText.includes('reasons for voting for bjp') ||
        (qText.includes('reason for voting') && qText.includes('bjp')) ||
        (qText.includes('reasons for voting') && qText.includes('bjp')) ||
        (qText.includes('বিজেপিকে ভোট') && qText.includes('কারণ'))) {
      return null;
    }
  }
  
  const API_BASE_URL = 'https://convo.convergentview.com';
  const text = String(optionText).toLowerCase();
  const mainText = getMainText(optionText).toLowerCase();
  
  // Check for AITC (Trinamool Congress) - check for "aitc", "trinamool", or "tmc"
  if (text.includes('aitc') || text.includes('trinamool') || text.includes('tmc') ||
      mainText.includes('aitc') || mainText.includes('trinamool') || mainText.includes('tmc')) {
    return `${API_BASE_URL}/api/party-logos/AITC_New_Logo.png`;
  }
  
  // Check for BJP
  if (text.includes('bjp') || mainText.includes('bjp')) {
    return `${API_BASE_URL}/api/party-logos/Logo_of_the_Bharatiya_Janata_Party.svg.webp`;
  }
  
  // Check for INC/Congress - check for "inc" or "congress" but not "princ" or other words containing "inc"
  if ((text.includes('inc') && !text.includes('princ') && !text.includes('since')) || text.includes('congress') || 
      (mainText.includes('inc') && !mainText.includes('princ') && !mainText.includes('since')) || mainText.includes('congress')) {
    return `${API_BASE_URL}/api/party-logos/INC_Logo.png`;
  }
  
  // Check for Left Front
  if (text.includes('left front') || text.includes('left_front') || mainText.includes('left front') || mainText.includes('left_front')) {
    return `${API_BASE_URL}/api/party-logos/CPIMAX_1024x1024.webp`;
  }
  
  return null;
};

// Simple audio recorder
// Global recording instance
let globalRecording: Audio.Recording | null = null;
// Lock to prevent concurrent recording starts
let isStartingRecording = false;
// Pre-initialized recording object (for faster startup)
let preInitializedRecording: Audio.Recording | null = null;
let isPreInitializing = false;

/**
 * Proactively cache polling groups and stations for ACs
 * This ensures data is available even if internet is lost during interview
 * Accepts both string array (AC names) and object array (AC objects with acName/acCode)
 */
async function cachePollingDataForACs(acs: any[], state: string): Promise<void> {
  if (!acs || acs.length === 0) {
    console.log('📥 No ACs to cache polling data for');
    return;
  }
  
  console.log(`📥 Starting proactive cache for ${acs.length} AC(s) in state: ${state}`);
  const startTime = Date.now();
  let groupsCached = 0;
  let stationsCached = 0;
  let errorsSkipped = 0;
  
  try {
    // Check if online - only cache if online
    const isOnline = await apiService.isOnline();
    if (!isOnline) {
      console.log('📴 Offline - skipping proactive cache (will use existing cache)');
      return;
    }
    
    // Cache polling groups and stations for each AC
    for (let i = 0; i < acs.length; i++) {
      const acItem = acs[i];
      if (!acItem) continue;
      
      // Extract AC identifier - handle both string and object formats
      let acIdentifier: string | null = null;
      if (typeof acItem === 'string') {
        acIdentifier = acItem.trim();
      } else if (acItem && typeof acItem === 'object') {
        // Try acName first (most common), then acCode, then displayText
        acIdentifier = acItem.acName || acItem.acCode || acItem.name || acItem.displayText || null;
        if (acIdentifier) {
          acIdentifier = String(acIdentifier).trim();
        }
      }
      
      if (!acIdentifier || acIdentifier.length === 0) {
        console.warn(`⚠️ Skipping invalid AC item at index ${i}:`, acItem);
        continue;
      }
      
      try {
        // Fetch and cache polling groups for this AC
        console.log(`📥 [${i + 1}/${acs.length}] Caching groups for AC: ${acIdentifier}`);
        const groupsResult = await apiService.getGroupsByAC(state, acIdentifier);
        
        if (groupsResult.success && groupsResult.data) {
          groupsCached++;
          const groups = groupsResult.data.groups || [];
          console.log(`✅ Cached groups for ${acIdentifier}: ${groups.length} group(s)`);
          
          // Cache polling stations for each group
          for (let j = 0; j < groups.length; j++) {
            const groupItem = groups[j];
            let groupName: string | null = null;
            
            // Handle both string and object formats
            if (typeof groupItem === 'string') {
              groupName = groupItem.trim();
            } else if (groupItem && typeof groupItem === 'object') {
              groupName = (groupItem.name || groupItem.groupName || groupItem.group || groupItem.value || '').toString().trim();
            }
            
            if (!groupName || groupName.length === 0) {
              continue;
            }
            
            try {
              // Fetch and cache polling stations for this group
              const stationsResult = await apiService.getPollingStationsByGroup(state, acIdentifier, groupName);
              if (stationsResult.success && stationsResult.data) {
                stationsCached++;
                const stationCount = stationsResult.data.stations?.length || 0;
                console.log(`✅ Cached stations for ${acIdentifier} - ${groupName}: ${stationCount} station(s)`);
              }
            } catch (stationError) {
              console.warn(`⚠️ Failed to cache stations for ${acIdentifier} - ${groupName}:`, stationError);
              // Continue with next group
            }
          }
        } else {
          // If AC not found (404), skip it - don't retry
          if (groupsResult.message && groupsResult.message.includes('not found')) {
            console.log(`⏭️ Skipping AC ${acIdentifier} (not found in polling station data)`);
            errorsSkipped++;
          } else {
            console.warn(`⚠️ Failed to cache groups for ${acIdentifier}:`, groupsResult.message);
          }
        }
      } catch (error: any) {
        // Skip 404 errors (AC not found) - don't log as error
        if (error.response?.status === 404 || (error.message && error.message.includes('not found'))) {
          console.log(`⏭️ Skipping AC ${acIdentifier} (not found)`);
          errorsSkipped++;
        } else {
          console.error(`❌ Error caching data for AC ${acIdentifier}:`, error.message || error);
        }
        // Continue with next AC
      }
      
      // Add small delay to prevent overwhelming the API
      if (i < acs.length - 1 && (i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay every 10 ACs
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Proactive cache complete: ${groupsCached} AC groups, ${stationsCached} group stations cached, ${errorsSkipped} skipped in ${duration}ms`);
  } catch (error) {
    console.error('❌ Error in proactive cache:', error);
    // Don't throw - this is a background operation
  }
}

export default function InterviewInterface({ navigation, route }: any) {
  const { survey: routeSurvey, responseId, isContinuing, isCatiMode: routeIsCatiMode } = route.params;
  
  // OPTIMIZATION: Use state for survey so we can update it with full data when fetched
  const [survey, setSurvey] = useState<any>(routeSurvey);
  
  // Get safe area insets for bottom navigation bar
  const insets = useSafeAreaInsets();
  
  // Determine if this is CATI mode
  const isCatiMode = routeIsCatiMode !== undefined 
    ? routeIsCatiMode 
    : survey.mode === 'cati' || survey.assignedMode === 'cati';
  
  // Helper function to get display text based on selected language
  const getDisplayText = (text: string | null | undefined): string => {
    try {
    if (!text) return '';
      
      // Ensure selectedLanguageIndex is valid
      const safeLanguageIndex = selectedLanguageIndex >= 0 ? selectedLanguageIndex : 0;
    
    // Handle multi-line descriptions with multiple translation blocks
    // Split by \n\n to handle paragraphs, then parse each paragraph separately
      if (typeof text === 'string' && text.includes('\n\n')) {
      const paragraphs = text.split('\n\n');
      return paragraphs.map((paragraph, index) => {
          const displayText = getLanguageText(paragraph.trim(), safeLanguageIndex);
          return (index > 0 ? '\n\n' : '') + (displayText || '');
      }).join('');
    }
    
      // Single line or no line breaks - get selected language
      return getLanguageText(text, safeLanguageIndex);
    } catch (error) {
      console.warn('Error in getDisplayText:', error);
      return text || '';
    }
  };

  // Handle closing language dropdown with animation
  const handleCloseLanguageDropdown = () => {
    Animated.parallel([
      Animated.timing(languageDropdownAnimation, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(languageDropdownOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setLanguageMenuVisible(false);
    });
  };

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingAnimation] = useState(new Animated.Value(0));
  const [pulseAnimation] = useState(new Animated.Value(1));
  const [rotationAnimation] = useState(new Animated.Value(0));
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [locationData, setLocationData] = useState<any>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [duration, setDuration] = useState(0);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [response, setResponse] = useState<SurveyResponse | null>(null);
  const [selectedLanguageIndex, setSelectedLanguageIndex] = useState(0);
  const [languageMenuVisible, setLanguageMenuVisible] = useState(false);
  const languageDropdownRef = useRef<View>(null);
  const [languageDropdownAnimation] = useState(new Animated.Value(0));
  const [languageDropdownOpacity] = useState(new Animated.Value(0));
  const [interviewerFirstName, setInterviewerFirstName] = useState<string>('');
  
  // MP/MLA names for survey "692fe24faf8e2f42139f5a49"
  const [mpName, setMpName] = useState<string | null>(null);
  const [mlaName, setMlaName] = useState<string | null>(null);
  const [isLoadingMPMLA, setIsLoadingMPMLA] = useState(false);
  
  // Interview session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  
  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingReady, setIsRecordingReady] = useState(false); // NEW: Tracks when recording is fully started and confirmed
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [recording, setRecording] = useState<any>(null);
  const [audioPermission, setAudioPermission] = useState<boolean | null>(null);
  
  // AC selection state
  const [selectedAC, setSelectedAC] = useState<string | null>(null);
  const [hasByeElection, setHasByeElection] = useState<boolean>(false); // Track if selected AC has bye-election
  const [assignedACs, setAssignedACs] = useState<string[]>([]);
  const [requiresACSelection, setRequiresACSelection] = useState(false);
  const [allACs, setAllACs] = useState<any[]>([]); // Store all ACs when interviewer has no assigned ACs
  const [loadingAllACs, setLoadingAllACs] = useState(false);
  const [showACDropdown, setShowACDropdown] = useState(false);
  const [acSearchTerm, setACSearchTerm] = useState('');
  
  // Polling Station Selection state
  const [selectedPollingStation, setSelectedPollingStation] = useState<any>({
    state: null,
    acName: null,
    acNo: null,
    pcNo: null,
    pcName: null,
    district: null,
    roundNumber: null,
    groupName: null,
    stationName: null,
    gpsLocation: null,
    latitude: null,
    longitude: null
  });
  const [availableRoundNumbers, setAvailableRoundNumbers] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<any[]>([]);
  const [availablePollingStations, setAvailablePollingStations] = useState<any[]>([]);
  const [loadingRoundNumbers, setLoadingRoundNumbers] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [geofencingError, setGeofencingError] = useState<string | null>(null);
  const [locationControlBooster, setLocationControlBooster] = useState(false);
  
  // Dropdown states for polling station selection
  const [showRoundDropdown, setShowRoundDropdown] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [showStationDropdown, setShowStationDropdown] = useState(false);
  
  // Quota management state
  const [genderQuotas, setGenderQuotas] = useState<any>(null);
  const [targetAudienceErrors, setTargetAudienceErrors] = useState<Map<string, string>>(new Map());
  const [othersTextInputs, setOthersTextInputs] = useState<Record<string, string>>({}); // Store "Others" text input values by questionId_optionValue
  const [shuffledOptions, setShuffledOptions] = useState<Record<string, any[]>>({}); // Store shuffled options per questionId to maintain consistent order
  const scrollViewRef = React.useRef<ScrollView>(null); // Ref for ScrollView to scroll to top
  const lastFetchedACRef = useRef<string | null>(null); // Track last AC we fetched MP/MLA for
  
  // CATI interview state
  const [catiQueueId, setCatiQueueId] = useState<string | null>(null);
  const [catiRespondent, setCatiRespondent] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'failed' | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [abandonReason, setAbandonReason] = useState<string>('');
  const [abandonNotes, setAbandonNotes] = useState<string>('');
  const [callLaterDate, setCallLaterDate] = useState<string>('');
  
  // State to track which Set is being shown in this interview
  const [selectedSetNumber, setSelectedSetNumber] = useState<number | null>(null);
  
  // Close other dropdowns when one opens
  useEffect(() => {
    if (showRoundDropdown) {
      setShowGroupDropdown(false);
      setShowStationDropdown(false);
    }
  }, [showRoundDropdown]);
  
  useEffect(() => {
    if (showGroupDropdown) {
      setShowRoundDropdown(false);
      setShowStationDropdown(false);
    }
  }, [showGroupDropdown]);
  
  useEffect(() => {
    if (showStationDropdown) {
      setShowRoundDropdown(false);
      setShowGroupDropdown(false);
    }
  }, [showStationDropdown]);

  // Get all questions from all sections
  // CRITICAL: For CATI, this depends on selectedSetNumber to filter questions correctly
  const allQuestions = useMemo(() => {
    const questions: any[] = [];
    
    // Early return if survey is not available
    if (!survey) {
      return questions;
    }
    
    // For CATI, log the set number being used for filtering
    if (isCatiMode) {
      console.log('🔵 CATI Interview - selectedSetNumber:', selectedSetNumber);
      console.log('🔵 CATI Interview - survey._id:', survey._id);
    }
    
    // Removed excessive logging - survey data debug
    
    // Add Call Status question as the very first question for CATI interviews
    if (isCatiMode) {
      const callStatusQuestion = {
        id: 'call-status',
        type: 'single_choice',
        text: 'Call Status {কলের অবস্থা}',
        description: 'Please select the status of the call attempt.',
        required: true,
        order: -4, // Make it appear first (before interviewer ID and consent form)
        options: [
          {
            id: 'call-connected',
            text: 'Call Connected {কল সংযুক্ত হয়েছে}',
            value: 'call_connected',
            code: 'call_connected'
          },
          {
            id: 'busy',
            text: 'Busy {ব্যস্ত}',
            value: 'busy',
            code: 'busy'
          },
          {
            id: 'switched-off',
            text: 'Switched Off {সুইচ অফ}',
            value: 'switched_off',
            code: 'switched_off'
          },
          {
            id: 'not-reachable',
            text: 'Not Reachable {পৌঁছানো যায়নি}',
            value: 'not_reachable',
            code: 'not_reachable'
          },
          {
            id: 'did-not-pick-up',
            text: 'Did Not Pick Up {উত্তর দেননি}',
            value: 'did_not_pick_up',
            code: 'did_not_pick_up'
          },
          {
            id: 'number-does-not-exist',
            text: 'Number Does Not Exist {নম্বর বিদ্যমান নেই}',
            value: 'number_does_not_exist',
            code: 'number_does_not_exist'
          },
          {
            id: 'didnt-get-call',
            text: "Didn't Get Call {কল পাননি}",
            value: 'didnt_get_call',
            code: 'didnt_get_call'
          }
        ],
        sectionIndex: -4, // Special section for call status
        questionIndex: -4,
        sectionId: 'call-status',
        sectionTitle: 'Call Status {কলের অবস্থা}',
        isCallStatus: true // Flag to identify this special question
      };
      questions.push(callStatusQuestion);
    }
    
    // Check if this is the target survey for Supervisor ID question
    const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
    
    // Add "Enter Supervisor ID" question before Consent Form (only for target survey, CAPI only)
    // SKIP Interviewer ID question for both CATI and CAPI
    // SKIP Supervisor ID question for CATI (only show for CAPI)
    if (isTargetSurvey && !isCatiMode) {
      const supervisorIdQuestion = {
        id: 'supervisor-id',
        type: 'numeric',
        text: 'Enter Supervisor ID {সুপারভাইজার আইডি লিখুন}',
        description: '',
        required: false, // Optional question
        order: -3, // Make it appear before Consent Form
        sectionIndex: -3, // Special section for supervisor ID
        questionIndex: -3,
        sectionId: 'supervisor-id',
        sectionTitle: 'Supervisor ID',
        isSupervisorId: true, // Flag to identify this special question
        validation: {
          maxValue: 99999, // Max 5 digits
          minValue: 0
        }
      };
      questions.push(supervisorIdQuestion);
    }
    
    // Add Consent Form question as the very first question (before AC/Polling Station)
    const consentFormMessage = isCatiMode 
      ? `Namaste, my name is ${interviewerFirstName || 'Interviewer'}. We are calling from Convergent, an independent research organization. We are conducting a survey on social and political issues in West Bengal, interviewing thousands of people. I will ask you a few questions about government performance and your preferences. Your responses will remain strictly confidential and will only be analysed in combination with others. No personal details will ever be shared. The survey will take about 5–10 minutes, and your honest opinions will greatly help us. {নমস্কার, আমার নাম ${interviewerFirstName || 'Interviewer'}। আমরা কনভারজেন্ট থেকে বলছি, এটি একটি স্বাধীন গবেষণা সংস্থা। আমরা পশ্চিমবঙ্গে সামাজিক ও রাজনৈতিক বিষয় নিয়ে একটি সমীক্ষা করছি, যেখানে হাজার হাজার মানুষের সঙ্গে কথা বলা হচ্ছে। সরকার কতটা ভালো কাজ করছে এবং আপনার পছন্দ-অপছন্দ সম্পর্কে কিছু প্রশ্ন করব। আপনার সব উত্তর একদম গোপন রাখা হবে এবং শুধুমাত্র অন্যদের সঙ্গে মিলিয়ে বিশ্লেষণ করা হবে। কোন ব্যক্তিগত তথ্য কখনোই শেয়ার করা হবে না। এই সার্ভেটা প্রায় ৫–১০ মিনিট লাগবে, এবং আপনার সৎ মতামত আমাদের জন্য খুবই মূল্যবান।}\n\nShould I Continue? {আমি কি চালিয়ে যেতে পারি?}`
      : `Namaste, my name is ${interviewerFirstName || 'Interviewer'}. We are from Convergent, an independent research organization. We are conducting a survey on social and political issues in West Bengal, interviewing thousands of people. I will ask you a few questions about government performance and your preferences. {নমস্কার, আমার নাম ${interviewerFirstName || 'Interviewer'}। আমরা কনভার্জেন্ট থেকে কথা বলছি, এটা একটা স্বাধীন গবেষণা সংস্থা। আমরা পশ্চিমবঙ্গের সামাজিক ও রাজনৈতিক বিষয় নিয়ে একটা সার্ভে করছি, যেখানে হাজার হাজার মানুষের মতামত নেওয়া হচ্ছে। আমি আপনাকে সরকারী কাজকর্ম আর আপনার পছন্দ-অপছন্দ নিয়ে কয়েকটা প্রশ্ন করব।}\n\nYour responses will remain strictly confidential and will only be analysed in combination with others. No personal details will ever be shared. The survey will take about 5–10 minutes, and your honest opinions will greatly help us. {আপনার দেওয়া তথ্য পুরোপুরি গোপন রাখা হবে এবং শুধু অন্যদের সঙ্গে মিলিয়ে বিশ্লেষণ করা হবে—কোনো ব্যক্তিগত তথ্য কখনোই শেয়ার করা হবে না। সার্ভেটা প্রায় ৫–১০ মিনিট লাগবে, আর আপনার সৎ মতামত আমাদের জন্য খুবই গুরুত্বপূর্ণ।}\n\nShould I Continue? {আমি কি চালিয়ে যেতে পারি?}`;
    
    const consentFormQuestion = {
      id: 'consent-form',
      type: 'single_choice',
      text: 'Consent Form {সম্মতিপত্র}',
      description: consentFormMessage,
      required: true,
      order: -2, // Make it appear first (before AC selection)
      options: [
        {
          id: 'consent-agree',
          text: 'Yes {হ্যাঁ}',
          value: '1',
          code: '1'
        },
        {
          id: 'consent-disagree',
          text: 'No {না}',
          value: '2',
          code: '2'
        }
      ],
      sectionIndex: -2, // Special section for consent form
      questionIndex: -2,
      sectionId: 'consent-form',
      sectionTitle: 'Consent Form {সম্মতিপত্র}',
      isConsentForm: true // Flag to identify this special question
    };
    questions.push(consentFormQuestion);
    
    // Check if AC selection is required
    // For CATI interviews, AC is auto-populated from respondent info, so we skip AC selection
    // For CAPI: Show AC selection if:
    //   1. Interviewer has assigned ACs (assignedACs.length > 0) - show only assigned ACs
    //   2. Interviewer has NO assigned ACs (assignedACs.length === 0) - show ALL ACs in searchable dropdown
    //   3. Only for survey "68fd1915d41841da463f0d46"
    // Note: isTargetSurvey is already declared above (line 337), reusing it here
    const hasAssignedACs = assignedACs && assignedACs.length > 0;
    
    // CRITICAL LOGGING: Log AC selection logic
    console.log('🔍 ========== AC SELECTION RENDER DEBUG ==========');
    console.log('🔍 assignedACs:', assignedACs);
    console.log('🔍 assignedACs.length:', assignedACs?.length || 0);
    console.log('🔍 hasAssignedACs:', hasAssignedACs);
    console.log('🔍 requiresACSelection:', requiresACSelection);
    console.log('🔍 isTargetSurvey:', isTargetSurvey);
    console.log('🔍 allACs.length:', allACs?.length || 0);
    console.log('🔍 ================================================');
    
    // Show AC selection if requiresACSelection is true (even if allACs is empty - we'll show loading)
    // Only for target survey when interviewer has no assigned ACs
    const needsACSelection = !isCatiMode && requiresACSelection && isTargetSurvey && (hasAssignedACs || (!hasAssignedACs && requiresACSelection));
    
    // Add AC selection question as first question if required (NOT for CATI)
    if (needsACSelection) {
      // Determine which ACs to show: assigned ACs if available, otherwise all ACs
      const acsToShow = hasAssignedACs ? assignedACs : allACs.map(ac => ac.acName);
      
      // CRITICAL: Force ac_searchable_dropdown type when no assigned ACs, regardless of allACs length
      // This ensures dropdown is always shown (not checkboxes) when user has no assigned ACs
      const questionType = hasAssignedACs ? 'single_choice' : 'ac_searchable_dropdown';
      
      console.log('🔍 Creating AC question - hasAssignedACs:', hasAssignedACs, 'questionType:', questionType, 'allACs.length:', allACs.length);
      
      const acQuestion = {
        id: 'ac-selection',
        type: questionType, // Use searchable dropdown if no assigned ACs
        text: 'Select Assembly Constituency',
        description: 'Please select the Assembly Constituency where you are conducting this interview.',
        required: true,
        order: -1, // Make it appear first
        options: hasAssignedACs 
          ? assignedACs.map(ac => ({
              id: `ac-${ac}`,
              text: ac,
              value: ac
            }))
          : (allACs.length > 0 ? allACs.map(ac => ({
              id: `ac-${ac.acCode}`,
              text: ac.acName,
              value: ac.acName,
              acCode: ac.acCode,
              displayText: ac.displayText,
              searchText: ac.searchText
            })) : []), // Empty array if allACs not loaded yet
        sectionIndex: -1, // Special section for AC selection
        questionIndex: -1,
        sectionId: 'ac-selection',
        sectionTitle: 'Assembly Constituency Selection',
        isACSelection: true, // Flag to identify this special question
        isSearchable: !hasAssignedACs, // Mark as searchable if no assigned ACs
        allACs: !hasAssignedACs ? allACs : [] // Include all ACs data for searchable dropdown
      };
      
      console.log('🔍 AC Question created - type:', acQuestion.type, 'options.length:', acQuestion.options.length, 'allACs.length:', acQuestion.allACs.length);
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

    // Helper function to determine which Set to show for this interview
    const determineSetNumber = (sessionId: string | null, survey: any): number | null => {
      if (!sessionId || !survey) return null;
      
      // Find all unique set numbers in the survey
      const setNumbers = new Set<number>();
      survey.sections?.forEach((section: any) => {
        section.questions?.forEach((question: any) => {
          if (question.setsForThisQuestion && question.setNumber !== null && question.setNumber !== undefined) {
            setNumbers.add(question.setNumber);
          }
        });
      });
      
      if (setNumbers.size === 0) return null;
      
      // Use sessionId as seed to deterministically select a Set
      const seed = parseInt(sessionId.slice(-8), 16) || 0;
      const setArray = Array.from(setNumbers).sort((a, b) => a - b);
      const selectedIndex = seed % setArray.length;
      return setArray[selectedIndex];
    };

    // Helper function to check if question should be shown based on interview mode and sets logic
    const shouldShowQuestion = (question: any, interviewMode: string, currentSetNumber: number | null): boolean => {
      // Check CAPI/CATI visibility
      if (interviewMode === 'capi' && question.enabledForCAPI === false) {
        return false;
      }
      if (interviewMode === 'cati') {
        // Hide questions explicitly disabled for CATI
        if (question.enabledForCATI === false) {
        return false;
        }
        // Also hide questions that are CAPI-only (enabledForCAPI is true but enabledForCATI is not true)
        // This catches cases where Survey Builder sets "show only in CAPI" but doesn't explicitly set enabledForCATI to false
        if (question.enabledForCAPI === true && question.enabledForCATI !== true) {
          return false;
        }
      }
      
      // Sets logic ONLY applies to CATI interviews, NOT CAPI
      // For CAPI, show all questions regardless of sets
      if (interviewMode === 'capi') {
        // For CAPI, always show questions (sets don't apply)
        return true;
      }
      
      // For CATI, apply sets logic
      if (interviewMode === 'cati' && question.setsForThisQuestion) {
        // If question has a set number, only show if it matches the selected set
        if (question.setNumber !== null && question.setNumber !== undefined) {
          // If no set is selected yet, we'll determine it
          if (currentSetNumber === null) {
            return false; // Don't show until set is determined
          }
          // Only show questions from the selected set
          return question.setNumber === currentSetNumber;
        }
        // If setsForThisQuestion is true but no setNumber, treat as always show (backward compatibility)
        return true;
      }
      
      // Questions without Sets appear in all surveys
      return true;
    };

    // Determine current interview mode
    const interviewMode = isCatiMode ? 'cati' : 'capi';
    
    // Determine which Set to show for this interview (if sets are used)
    // Note: Sets only apply to CATI, not CAPI
    let currentSetNumber = selectedSetNumber;
    // For CAPI, always set to null (no sets - show all questions from both sets)
    if (interviewMode === 'capi') {
      currentSetNumber = null;
    }
    // For CATI, use the selectedSetNumber (fetched via useEffect)
    
    // Add regular survey questions from sections (filtered by CAPI/CATI and sets logic)
    // SPECIAL: For target survey in CATI mode, include Q17 and Q7 even if they're conditionally hidden or in a different set
    // This ensures they can be reordered correctly even if they're not initially visible
    const TARGET_SURVEY_ID = '68fd1915d41841da463f0d46';
    const isTargetSurveyCATI = isCatiMode && survey && (survey._id === TARGET_SURVEY_ID || survey.id === TARGET_SURVEY_ID);
    
    if (survey?.sections && Array.isArray(survey.sections) && survey.sections.length > 0) {
      survey.sections.forEach((section: any, sectionIndex: number) => {
        if (section && section.questions && Array.isArray(section.questions) && section.questions.length > 0) {
          section.questions.forEach((question: any, questionIndex: number) => {
            if (!question) return; // Skip null/undefined questions
            // Check if question should be shown
            const shouldShow = shouldShowQuestion(question, interviewMode, currentSetNumber);
            const isQ17 = question.questionNumber === '17' || (question.questionNumber && String(question.questionNumber).toLowerCase() === '17');
            const isQ7 = question.questionNumber === '7' || (question.questionNumber && String(question.questionNumber).toLowerCase() === '7');
            
            // For Q17 and Q7 in target survey CATI mode, include them even if filtered out by set logic (for reordering purposes)
            // But still respect CATI visibility settings (enabledForCATI !== false)
            if (shouldShow || (isTargetSurveyCATI && (isQ17 || isQ7) && question.enabledForCATI !== false)) {
              questions.push({
                ...question,
                sectionIndex,
                questionIndex,
                sectionId: section?.id || `section-${sectionIndex}`,
                sectionTitle: section?.title || 'Survey Section'
              });
              // Debug logging for Q7 when included
              if (isQ7) {
                console.log(`✅ Q7 Included in allQuestions: questionNumber=${question.questionNumber}, shouldShow=${shouldShow}, enabledForCATI=${question.enabledForCATI}, setNumber=${question.setNumber}, currentSetNumber=${currentSetNumber}`);
              }
            }
          });
        }
      });
    }
    
    // Add direct survey questions (not in sections)
    if (survey?.questions && Array.isArray(survey.questions) && survey.questions.length > 0) {
      survey.questions.forEach((question: any, questionIndex: number) => {
        if (!question) return; // Skip null/undefined questions
        questions.push({
          ...question,
          sectionIndex: 0, // Default section for direct questions
          questionIndex,
          sectionId: 'direct-questions',
          sectionTitle: 'Survey Questions'
        });
      });
    }
    
    // Removed excessive logging
    // console.log('🔍 Total questions processed:', questions.length);
    // console.log('🔍 Questions array:', questions.map(q => ({ id: q.id, text: q.text, type: q.type })));
    
    // For CATI, log which questions are being included based on set number
    if (isCatiMode && selectedSetNumber !== null) {
      const setQuestions = questions.filter((q: any) => q.setsForThisQuestion && q.setNumber === selectedSetNumber);
      const nonSetQuestions = questions.filter((q: any) => !q.setsForThisQuestion);
      console.log(`🔵 CATI Questions filtered - Set ${selectedSetNumber} questions: ${setQuestions.length}, Non-set questions: ${nonSetQuestions.length}, Total: ${questions.length}`);
    }
    
    // Special handling for survey 68fd1915d41841da463f0d46: Dynamic question reordering for CATI mode
    if (isCatiMode && survey && (survey._id === TARGET_SURVEY_ID || survey.id === TARGET_SURVEY_ID)) {
      // Helper function to identify questions by questionNumber ONLY (no text patterns)
      // Simple and reliable: match by questionNumber only
      const identifyQuestion = (question: any, targetNumber: string, subQuestion: string | null = null): boolean => {
        const qNum = String(question.questionNumber || '').trim().toLowerCase();
        const targetNumLower = String(targetNumber).toLowerCase();
        
        // For sub-questions (like 16.a, 16.b), check questionNumber pattern
        if (subQuestion) {
          // Check if questionNumber matches the pattern (e.g., "16.a", "16a", "16.A")
          const patternLower = `${targetNumber}.${subQuestion.toLowerCase()}`;
          const patternLowerNoDot = `${targetNumber}${subQuestion.toLowerCase()}`;
          const patternUpper = `${targetNumber}.${subQuestion.toUpperCase()}`;
          const patternUpperNoDot = `${targetNumber}${subQuestion.toUpperCase()}`;
          
          if (qNum === patternLower || qNum === patternLowerNoDot || 
              qNum === patternUpper || qNum === patternUpperNoDot ||
              question.questionNumber === patternLower || question.questionNumber === patternUpper) {
            return true;
          }
          return false;
        }
        
        // For non-sub-questions, check by questionNumber (exact match)
        const questionNumberMatches = qNum === targetNumLower || 
                                     question.questionNumber === targetNumber || 
                                     question.questionNumber === String(targetNumber);
        
        return questionNumberMatches;
      };

      // Define the desired order with question identifiers for CATI
      // Format: { number: '2', patterns: ['text patterns'], subQuestion: 'A' or 'B' for sub-questions }
      // IMPORTANT: Order matters - questions will be reordered in this exact sequence
      const desiredOrder = [
        { number: '2' },
        { number: '1' },
        { number: '13' },
        { number: '14' },
        { number: '16', subQuestion: 'A' },
        { number: '16', subQuestion: 'B' },
        { number: '5' },
        { number: '6' },
        { number: '7' },
        { number: '8' },
        { number: '9' },
        { number: '10' },
        { number: '17' },
        { number: '19' },
        { number: '28' },
        { number: '20' },
        { number: '21' },
        { number: '22' },
        { number: '26' },
        { number: '27' },
        { number: '3' },
        { number: '23' },
        { number: '24' },
        { number: '25' },
      ];

      // Find where Q1 starts (questions before Q1 should remain unchanged)
      // Q1 is typically the first question after system questions (call-status, interviewer-id, consent-form, etc.)
      let q1StartIndex = -1;
      questions.forEach((q: any, idx: number) => {
        if (identifyQuestion(q, '1')) {
          q1StartIndex = idx;
        }
      });

      // If Q1 not found, check for first question with questionNumber >= 1
      if (q1StartIndex === -1) {
        questions.forEach((q: any, idx: number) => {
          const qNum = parseInt(q.questionNumber);
          if (!isNaN(qNum) && qNum >= 1 && q1StartIndex === -1) {
            q1StartIndex = idx;
          }
        });
      }

      // If still not found, assume all questions after system questions are survey questions
      // System questions typically have negative order or specific IDs
      if (q1StartIndex === -1) {
        questions.forEach((q: any, idx: number) => {
          if (q.order && q.order < 0) {
            // This is a system question, Q1 should be after this
            q1StartIndex = Math.max(q1StartIndex, idx + 1);
          }
        });
      }

      // Default: if still not found, start from index 0 (reorder all)
      if (q1StartIndex === -1) {
        q1StartIndex = 0;
      }

      // Split questions: before Q1 and from Q1 onwards
      const questionsBeforeQ1 = questions.slice(0, q1StartIndex);
      const questionsFromQ1 = questions.slice(q1StartIndex);

      // Find and extract questions in desired order
      const reorderedQuestions: any[] = [];
      const usedIndices = new Set<number>();

      desiredOrder.forEach(({ number, subQuestion }, orderIndex) => {
        const foundIndex = questionsFromQ1.findIndex((q: any, idx: number) => {
          if (usedIndices.has(idx)) return false;
          const matches = identifyQuestion(q, number, subQuestion || null);
          if (matches) {
            console.log(`✅ Found Q${number}${subQuestion ? '.' + subQuestion : ''} at index ${idx} (questionNumber: ${q.questionNumber}, id: ${q.id}) for order position ${orderIndex + 1}`);
          }
          return matches;
        });

        if (foundIndex !== -1) {
          reorderedQuestions.push(questionsFromQ1[foundIndex]);
          usedIndices.add(foundIndex);
        } else {
          console.warn(`⚠️ Could not find Q${number}${subQuestion ? '.' + subQuestion : ''} for order position ${orderIndex + 1}. Available questions: ${questionsFromQ1.map((q: any, i: number) => `[${i}]Q${q.questionNumber || '?'}`).join(', ')}`);
        }
      });
      
      // Add remaining questions (not in desired order) at the end
      const remainingQuestions = questionsFromQ1.filter((_: any, idx: number) => !usedIndices.has(idx));

      // Combine: questions before Q1 + reordered questions + remaining questions
      const finalQuestions = [...questionsBeforeQ1, ...reorderedQuestions, ...remainingQuestions];

      // CRITICAL: Re-filter to ensure no CAPI-only questions slip through
      // This is a safety check to ensure questions with enabledForCATI === false are removed
      // BUT: Don't filter out Q7 and Q17 for target survey in CATI mode (they're needed for reordering)
      const filteredFinalQuestions = finalQuestions.filter((q: any) => {
        const isQ7 = q.questionNumber === '7' || (q.questionNumber && String(q.questionNumber).toLowerCase() === '7');
        const isQ17 = q.questionNumber === '17' || (q.questionNumber && String(q.questionNumber).toLowerCase() === '17');
        
        // For Q7 and Q17 in target survey CATI mode, always include them (they'll be filtered by conditions later)
        if (isTargetSurveyCATI && (isQ7 || isQ17)) {
          if (isQ7) {
            console.log(`✅ Q7 Passing final filter: enabledForCATI=${q.enabledForCATI}, enabledForCAPI=${q.enabledForCAPI}`);
          }
          return true; // Always include Q7/Q17 for reordering
        }
        
        // Re-check visibility for CATI mode
        if (q.enabledForCATI === false) {
          return false; // Hide questions explicitly disabled for CATI
        }
        // Also hide questions that are CAPI-only (enabledForCAPI is true but enabledForCATI is not true)
        if (q.enabledForCAPI === true && q.enabledForCATI !== true) {
          return false;
        }
        return true;
      });

      console.log(`✅ Reordered ${reorderedQuestions.length} questions for CATI interview (Survey: ${TARGET_SURVEY_ID})`);
      console.log(`📋 Order: ${reorderedQuestions.map((q: any) => `Q${q.questionNumber || '?'}`).join(', ')}`);
      if (finalQuestions.length !== filteredFinalQuestions.length) {
        console.log(`⚠️ Filtered out ${finalQuestions.length - filteredFinalQuestions.length} CAPI-only questions from CATI interview`);
      }

      // Return reordered and filtered questions array
      return filteredFinalQuestions;
    }
    
    return questions;
  }, [survey?.sections, survey?.questions, requiresACSelection, assignedACs, allACs, selectedAC, availableGroups, availablePollingStations, selectedPollingStation.groupName, selectedPollingStation.stationName, interviewerFirstName, isCatiMode, selectedSetNumber]);
  
  // Check consent form response
  const consentResponse = responses['consent-form'];
  // Check for various possible values: '2', 2, 'consent-disagree', or the option ID
  const isConsentDisagreed = consentResponse === '2' || 
                             consentResponse === 2 || 
                             consentResponse === 'consent-disagree' ||
                             String(consentResponse).toLowerCase().includes('disagree') ||
                             String(consentResponse).toLowerCase() === 'no';
  // If consent is "No" AND we're on the consent form question, show Abandon button (similar to call status)
  // Show Abandon button whenever consent is disagreed (similar to how call status works)
  const shouldShowAbandonForConsent = isConsentDisagreed && currentQuestion?.id === 'consent-form';
  
  // REMOVED: Registered voter question abandon logic
  // The condition logic on the backend will handle "No" responses appropriately
  // Users can proceed to next question normally, and backend conditions will skip/handle questions as needed
  const shouldShowAbandonForVoter = false;
  
  // Debug logging
  console.log('🔍 Consent check:', {
    consentResponse,
    currentQuestionId: currentQuestion?.id,
    isConsentDisagreed,
    shouldShowAbandonForConsent,
    responsesKeys: Object.keys(responses)
  });
  
  // Check call status for CATI interviews
  const callStatusResponse = responses['call-status'];
  const isCallConnected = callStatusResponse === 'call_connected';
  const hasCallStatusResponse = callStatusResponse !== null && callStatusResponse !== undefined && callStatusResponse !== '';
  const shouldShowSubmitForCallStatus = isCatiMode && hasCallStatusResponse && !isCallConnected;

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
        if (targetQuestion && 'options' in targetQuestion && targetQuestion.options && Array.isArray(targetQuestion.options)) {
          // Check if val matches any option.value or option.text (after stripping translations)
          const options = (targetQuestion as any).options;
          for (const option of options) {
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
          // Convert response to string first, then parse to handle various formats
          // Handle both direct numeric values and values from options
          let responseValue: any = response;
          // If response is an array, take the first element
          if (Array.isArray(response)) {
            responseValue = response[0];
          }
          // If response is an object, try to extract numeric value
          if (typeof responseValue === 'object' && responseValue !== null) {
            responseValue = (responseValue as any).value || (responseValue as any).text || responseValue;
          }
          const responseStrNum = String(responseValue || '').trim();
          const conditionStrNum = String(condition.value || '').trim();
          const responseNum = parseFloat(responseStrNum);
          const conditionNum = parseFloat(conditionStrNum);
          met = !isNaN(responseNum) && !isNaN(conditionNum) && responseNum > conditionNum;
          if (question.questionNumber === '7') {
            console.log(`🔍 Q7 Condition Debug: questionId=${condition.questionId}, response="${response}" (extracted: "${responseValue}", as string: "${responseStrNum}", parsed: ${responseNum}), condition.value="${condition.value}" (as string: "${conditionStrNum}", parsed: ${conditionNum}), met=${met}`);
          }
          break;
        case 'less_than':
          const responseNum2 = parseFloat(String(response));
          const conditionNum2 = parseFloat(String(condition.value));
          met = !isNaN(responseNum2) && !isNaN(conditionNum2) && responseNum2 < conditionNum2;
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
    if (!allQuestions || allQuestions.length === 0) {
      return [];
    }
    const visible = allQuestions.filter((question: any) => {
      if (!question) return false;
      
      // Check conditional logic first
      if (!evaluateConditions(question)) {
        return false;
      }
      
      // For survey "68fd1915d41841da463f0d46": Hide Question 7 (Bye-Election Party Choice) 
      // if selected AC does not have bye-election
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      if (isTargetSurvey) {
        const questionNum = String(question.questionNumber || '').toLowerCase();
        // Q7 is the bye-election question
        const isQ7 = questionNum === '7' || questionNum === '7.0';
        
        if (isQ7) {
          // Only show Q7 if selected AC has bye-election
          // For CATI, check if AC is available from session data
          const acToCheck = selectedAC || acFromSessionData;
          if (!acToCheck || !hasByeElection) {
            console.log(`🔍 Q7 Filtered by bye-election check: acToCheck=${acToCheck}, hasByeElection=${hasByeElection}`);
            return false;
          }
        }
      }
      
      return true;
    });
    
    // CRITICAL: For CATI mode in target survey, allQuestions is already reordered in getAllQuestions()
    // We just need to maintain that order here - no need to reorder again
    // The visible array already maintains the order from allQuestions
    return visible;
  }, [allQuestions, evaluateConditions, selectedAC, hasByeElection, survey, acFromSessionData, isCatiMode]); // Added isCatiMode to dependencies

  // Calculate maximum possible questions from current state
  // This considers all questions that could potentially be shown based on all possible conditional paths
  const maxPossibleQuestions = useMemo(() => {
    if (!allQuestions || allQuestions.length === 0) {
      return 0;
    }
    
    let maxCount = 0;
    
    for (const question of allQuestions) {
      if (!question) continue;
      
      // Check if question has conditions
      const hasConditions = question.conditions && question.conditions.length > 0;
      
      if (!hasConditions) {
        // Questions without conditions are always shown
        maxCount++;
      } else {
        // For questions with conditions, check if they could potentially be shown
        // A question could be shown if:
        // 1. Its conditions are already met (it's currently visible), OR
        // 2. It has conditions that reference questions that haven't been answered yet (could potentially be met)
        
        // Check if conditions are already met (question is currently visible)
        const isCurrentlyVisible = evaluateConditions(question);
        
        // Check if conditions reference questions that haven't been answered yet
        const hasUnansweredDependencies = question.conditions.some((cond: any) => {
          const response = responses[cond.questionId];
          return response === undefined || response === null || response === '';
        });
        
        // Special handling for Q7 in target survey - only count if AC has bye-election
        const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
        let shouldCountQ7 = true;
        if (isTargetSurvey) {
          const questionNum = String(question.questionNumber || '').toLowerCase();
          const isQ7 = questionNum === '7' || questionNum === '7.0';
          
          if (isQ7) {
            const acToCheck = selectedAC || acFromSessionData;
            shouldCountQ7 = acToCheck && hasByeElection;
          }
        }
        
        // Count if currently visible OR could potentially be shown (has unanswered dependencies)
        if (shouldCountQ7 && (isCurrentlyVisible || hasUnansweredDependencies)) {
          maxCount++;
        }
      }
    }
    
    return maxCount;
  }, [allQuestions, responses, evaluateConditions, selectedAC, hasByeElection, survey, acFromSessionData]);

  const currentQuestion = visibleQuestions && visibleQuestions.length > 0 && currentQuestionIndex < visibleQuestions.length 
    ? visibleQuestions[currentQuestionIndex] 
    : null;
  const progress = (maxPossibleQuestions || (visibleQuestions && visibleQuestions.length > 0))
    ? (currentQuestionIndex + 1) / (maxPossibleQuestions || visibleQuestions.length)
    : 0;

  // OPTIMIZATION: Load ACs when AC selection question becomes visible
  useEffect(() => {
    const isACSelectionQuestion = currentQuestion && (
      currentQuestion.id === 'ac-selection' || 
      (currentQuestion as any)?.isACSelection
    );
    
    if (isACSelectionQuestion && allACs.length === 0 && !loadingAllACs && !isCatiMode) {
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      if (isTargetSurvey && requiresACSelection && assignedACs.length === 0) {
        const state = survey?.acAssignmentState || 'West Bengal';
        console.log('🔍 AC selection question visible - loading ACs on-demand...');
        loadACsOnDemand(state).catch((err) => {
          console.error('⚠️ Error loading ACs when question became visible:', err);
        });
      }
    }
  }, [currentQuestion?.id, allACs.length, loadingAllACs, isCatiMode, requiresACSelection, assignedACs.length, survey]);

  // Detect available languages from current question and its options
  const detectAvailableLanguages = useMemo(() => {
    if (!currentQuestion) return ['Language 1'];
    
    const languageCounts = new Set<number>();
    
    try {
      // Check question text
      if (currentQuestion.text) {
        const languages = parseMultiTranslation(String(currentQuestion.text));
        if (languages && Array.isArray(languages)) {
          languages.forEach((_, index) => languageCounts.add(index));
        }
      }
      
      // Check question description
      if (currentQuestion.description) {
        const languages = parseMultiTranslation(String(currentQuestion.description));
        if (languages && Array.isArray(languages)) {
          languages.forEach((_, index) => languageCounts.add(index));
        }
      }
      
      // Check options
      if (currentQuestion.options && Array.isArray(currentQuestion.options)) {
        currentQuestion.options.forEach((option: any) => {
          try {
            const optionText = typeof option === 'object' ? (option.text || option.value) : option;
            if (optionText) {
              const languages = parseMultiTranslation(String(optionText));
              if (languages && Array.isArray(languages)) {
                languages.forEach((_, index) => languageCounts.add(index));
              }
            }
          } catch (error) {
            console.warn('Error parsing option text:', error);
          }
        });
      }
    } catch (error) {
      console.warn('Error detecting languages:', error);
      return ['Language 1'];
    }
    
    const maxLanguages = Math.max(...Array.from(languageCounts), 0) + 1;
    
    // For survey "68fd1915d41841da463f0d46", use specific language labels
    const surveyId = survey?._id || survey?.id;
    if (surveyId === '68fd1915d41841da463f0d46') {
      const languageLabels = ['English', 'Bengali', 'Hindi'];
      return Array.from({ length: maxLanguages }, (_, i) => languageLabels[i] || `Language ${i + 1}`);
    }
    
    return Array.from({ length: maxLanguages }, (_, i) => `Language ${i + 1}`);
  }, [currentQuestion, survey]);

  // Fetch interviewer's first name for consent form
  useEffect(() => {
    const fetchInterviewerName = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const userDataStr = await AsyncStorage.getItem('userData');
        if (userDataStr) {
          const userData = JSON.parse(userDataStr);
          if (userData && userData.firstName) {
            setInterviewerFirstName(userData.firstName);
          } else {
            setInterviewerFirstName('Interviewer');
          }
        } else {
          setInterviewerFirstName('Interviewer');
        }
      } catch (error) {
        console.error('Error fetching interviewer name:', error);
        setInterviewerFirstName('Interviewer');
      }
    };
    
    fetchInterviewerName();
  }, []);

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

  // Fetch set number for CATI interviews (to alternate sets)
  // OPTIMIZATION: Use default Set 1 immediately, then fetch actual set number in background
  useEffect(() => {
    const fetchSetNumber = async () => {
      // Only fetch for CATI interviews
      if (!isCatiMode || !survey?._id || selectedSetNumber !== null) {
          return;
        }
        
        // Helper function to get default set (Set 1)
        const getDefaultSet = (): number | null => {
          const setNumbers = new Set<number>();
          survey?.sections?.forEach((section: any) => {
            section.questions?.forEach((question: any) => {
              if (question.setsForThisQuestion && question.setNumber !== null && question.setNumber !== undefined) {
                setNumbers.add(question.setNumber);
              }
            });
          });
          const setArray = Array.from(setNumbers).sort((a, b) => a - b);
          return setArray.length > 0 ? setArray[0] : null; // First set (usually Set 1)
        };
        
      // OPTIMIZATION: Set default Set 1 immediately (don't block interview start)
      const defaultSet = getDefaultSet();
      if (defaultSet !== null && selectedSetNumber === null) {
        console.log('✅ Setting default Set number:', defaultSet, '(will update from API if different)');
        setSelectedSetNumber(defaultSet);
      }
      
      // OPTIMIZATION: Fetch actual set number in background (non-blocking)
      // This allows interview to start immediately with default Set 1
      if (!survey?._id) {
        console.warn('No survey ID available, skipping set number fetch');
        return;
      }
      
      // Fetch in background - don't await, let it update when ready
      apiService.getLastCatiSetNumber(survey._id)
        .then((response) => {
        if (response && response.success && response.data) {
          const nextSetNumber = response.data.nextSetNumber;
            if (nextSetNumber !== null && nextSetNumber !== undefined && nextSetNumber !== defaultSet) {
              console.log('🔄 Updating Set number from API:', nextSetNumber, '(was:', defaultSet, ')');
            setSelectedSetNumber(nextSetNumber);
            }
          }
        })
        .catch((error: any) => {
          // Silently handle errors - default Set 1 is already set
          console.log('⚠️ Set number API call failed, using default Set 1');
        });
    };

    fetchSetNumber();
  }, [isCatiMode, survey?._id, selectedSetNumber, survey?.sections]);

  // Memoize AC from sessionData to avoid unnecessary re-renders
  const acFromSessionData = useMemo(() => {
    if (!isCatiMode || !sessionData) return null;
    // Check respondentContact first (if it exists)
    if ((sessionData as any).respondentContact) {
      const contact = (sessionData as any).respondentContact;
      return contact.assemblyConstituency || contact.ac || contact.assemblyConstituencyName || contact.acName;
    }
    // Fallback to respondent.ac (which is how CATI response is structured)
    if ((sessionData as any).respondent && (sessionData as any).respondent.ac) {
      return (sessionData as any).respondent.ac;
    }
    return null;
  }, [isCatiMode, (sessionData as any)?.respondentContact?.assemblyConstituency, (sessionData as any)?.respondentContact?.ac, (sessionData as any)?.respondentContact?.assemblyConstituencyName, (sessionData as any)?.respondentContact?.acName, (sessionData as any)?.respondent?.ac]);

  // Fetch MP/MLA names when AC is selected (for any survey with questions 16.a and 16.b)
  useEffect(() => {
    const fetchMPMLANames = async () => {
      // Get selected AC from state or memoized session data AC
      let acToUse = selectedAC || acFromSessionData;
      
      if (!acToUse) {
        // Clear data if AC is removed
        if (lastFetchedACRef.current !== null) {
          setMpName(null);
          setMlaName(null);
          lastFetchedACRef.current = null;
        }
        return;
      }
      
      // Prevent duplicate fetches for the same AC
      if (lastFetchedACRef.current === acToUse) {
        return;
      }
      
      // Prevent fetching if already loading
      if (isLoadingMPMLA) {
        return;
      }
      
      lastFetchedACRef.current = acToUse; // Mark as fetching/fetched
      
      try {
        setIsLoadingMPMLA(true);
        const result = await apiService.getACData(acToUse);
        if (result.success && result.data) {
          setMpName(result.data.mpName);
          setMlaName(result.data.mlaName);
        } else {
          setMpName(null);
          setMlaName(null);
        }
      } catch (error) {
        console.error('Error fetching MP/MLA names:', error);
        setMpName(null);
        setMlaName(null);
      } finally {
        setIsLoadingMPMLA(false);
      }
    };
    
    fetchMPMLANames();
  }, [selectedAC, acFromSessionData]); // Only fetch when AC actually changes

  // Fetch bye-election status when AC is available (for both CAPI and CATI)
  useEffect(() => {
    const fetchByeElectionStatus = async () => {
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      if (!isTargetSurvey) {
        setHasByeElection(false);
        return;
      }
      
      // Get AC from selectedAC or sessionData (for CATI)
      const acToCheck = selectedAC || acFromSessionData;
      if (!acToCheck) {
        setHasByeElection(false);
        return;
      }
      
      try {
        const result = await apiService.getACData(acToCheck);
        if (result.success && result.data) {
          setHasByeElection(result.data.hasByeElection || false);
        } else {
          setHasByeElection(false);
        }
      } catch (error) {
        console.error('Error fetching AC bye-election status:', error);
        setHasByeElection(false);
      }
    };
    
    fetchByeElectionStatus();
  }, [selectedAC, acFromSessionData, survey]);

  // Also fetch MP/MLA names when reaching questions 16.a or 16.b if not already available
  useEffect(() => {
    const fetchIfNeeded = async () => {
      // Get current question from visibleQuestions
      const currentQ = visibleQuestions && visibleQuestions.length > 0 && currentQuestionIndex < visibleQuestions.length
        ? visibleQuestions[currentQuestionIndex]
        : null;
      
      if (!currentQ || (mpName && mlaName)) return;
      
      const questionText = (currentQ.text || '').toLowerCase();
      const questionNumber = 'questionNumber' in currentQ ? (currentQ as any).questionNumber : '';
      const isQuestion16a = questionNumber.includes('16.a') || 
                           questionNumber.includes('16a') ||
                           questionText.includes('satisfaction with mp') ||
                           (questionText.includes('mp') && questionText.includes('satisfaction'));
      const isQuestion16b = questionNumber.includes('16.b') || 
                           questionNumber.includes('16b') ||
                           questionText.includes('satisfaction with mla') ||
                           (questionText.includes('mla') && questionText.includes('satisfaction'));
      
      if (isQuestion16a || isQuestion16b) {
        // Get selected AC from state or memoized session data AC
        let acToUse = selectedAC || acFromSessionData;
        
        // Only fetch if:
        // 1. We have an AC
        // 2. We don't already have MP/MLA names
        // 3. We're not already loading
        // 4. We haven't already fetched for this AC
        if (acToUse && !mpName && !mlaName && !isLoadingMPMLA && lastFetchedACRef.current !== acToUse) {
          lastFetchedACRef.current = acToUse; // Mark as fetching
          try {
            setIsLoadingMPMLA(true);
            const result = await apiService.getACData(acToUse);
            if (result.success && result.data) {
              setMpName(result.data.mpName);
              setMlaName(result.data.mlaName);
            }
          } catch (error) {
            console.error('Error fetching MP/MLA on question display:', error);
          } finally {
            setIsLoadingMPMLA(false);
          }
        }
      }
    };
    
    fetchIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex, visibleQuestions, selectedAC, acFromSessionData]); // Only re-run when question changes or AC changes

  // Load ACs from cache immediately when component mounts (for offline support)
  // OPTIMIZATION: Lazy load ACs from cache (fast, non-blocking)
  // This function checks cache first and uses cached ACs immediately
  // Then fetches fresh data in background if online
  const loadACsFromCacheLazy = async (state: string): Promise<void> => {
    try {
      // Step 1: Check cache first (fast, < 100ms)
      const cachedACs = await offlineDataCache.getAllACsForState(state);
      
      if (cachedACs && cachedACs.length > 0) {
        // Use cached ACs immediately (don't validate - just use them)
        console.log('✅ Loaded', cachedACs.length, 'ACs from cache immediately (using cached data)');
        setAllACs(cachedACs);
        
        // Step 2: Fetch fresh data in background (non-blocking)
        const isOnline = await apiService.isOnline();
        if (isOnline) {
          console.log('🔄 Fetching fresh AC data in background...');
          // Don't await - let it run in background
          apiService.getAllACsForState(state)
            .then((allACsResponse) => {
              if (allACsResponse.success && allACsResponse.data) {
                let fetchedACs: any[] = [];
                
                if (Array.isArray(allACsResponse.data)) {
                  fetchedACs = allACsResponse.data;
                } else if (allACsResponse.data.acs && Array.isArray(allACsResponse.data.acs)) {
                  fetchedACs = allACsResponse.data.acs;
                } else {
                  fetchedACs = allACsResponse.data.acs || allACsResponse.data || [];
                }
                
                if (fetchedACs.length > 0) {
                  console.log('✅ Fresh AC data fetched:', fetchedACs.length, 'ACs (updating...)');
                  setAllACs(fetchedACs);
                }
              }
            })
            .catch((error) => {
              console.log('⚠️ Background AC fetch failed (using cached data):', error.message);
              // Don't show error - cached data is already being used
            });
        }
      } else {
        console.log('📴 No ACs found in cache - will fetch when dropdown opens');
      }
    } catch (error: any) {
      console.error('❌ Error loading ACs from cache:', error);
      // Don't block - ACs will be fetched when dropdown opens
    }
  };

  // OPTIMIZATION: Load ACs on-demand when needed
  // This function fetches ACs when user opens dropdown or when AC question becomes visible
  const loadACsOnDemand = async (state: string): Promise<void> => {
    // If ACs are already loaded, don't fetch again
    if (allACs.length > 0) {
      console.log('✅ ACs already loaded:', allACs.length, 'ACs');
      return;
    }

    setLoadingAllACs(true);
    try {
      // Step 1: Check cache first (fast)
      const cachedACs = await offlineDataCache.getAllACsForState(state);
      
      if (cachedACs && cachedACs.length > 0) {
        // Use cached ACs immediately
        console.log('✅ Using cached ACs immediately:', cachedACs.length, 'ACs');
        setAllACs(cachedACs);
        setLoadingAllACs(false);
        
        // Step 2: Fetch fresh data in background
        const isOnline = await apiService.isOnline();
        if (isOnline) {
          apiService.getAllACsForState(state)
            .then((allACsResponse) => {
              if (allACsResponse.success && allACsResponse.data) {
                let fetchedACs: any[] = [];
                
                if (Array.isArray(allACsResponse.data)) {
                  fetchedACs = allACsResponse.data;
                } else if (allACsResponse.data.acs && Array.isArray(allACsResponse.data.acs)) {
                  fetchedACs = allACsResponse.data.acs;
                } else {
                  fetchedACs = allACsResponse.data.acs || allACsResponse.data || [];
                }
                
                if (fetchedACs.length > cachedACs.length) {
                  console.log('✅ Fresh AC data fetched:', fetchedACs.length, 'ACs (updating...)');
                  setAllACs(fetchedACs);
                }
              }
            })
            .catch((error) => {
              console.log('⚠️ Background AC fetch failed (using cached data):', error.message);
            });
        }
        return;
      }

      // Step 3: Fetch from API if no cache or cache is empty
      console.log('🔄 Fetching ACs from API...');
      const allACsResponse = await apiService.getAllACsForState(state);
      
      if (allACsResponse.success && allACsResponse.data) {
        let fetchedACs: any[] = [];
        let acCount = 0;
        
        if (Array.isArray(allACsResponse.data)) {
          fetchedACs = allACsResponse.data;
          acCount = fetchedACs.length;
        } else if (allACsResponse.data.acs && Array.isArray(allACsResponse.data.acs)) {
          fetchedACs = allACsResponse.data.acs;
          acCount = allACsResponse.data.count || fetchedACs.length;
        } else {
          fetchedACs = allACsResponse.data.acs || allACsResponse.data || [];
          acCount = allACsResponse.data.count || fetchedACs.length;
        }
        
        if (acCount > 0) {
          console.log('✅ Fetched all ACs:', acCount, 'ACs');
          setAllACs(fetchedACs);
        } else {
          console.warn('⚠️ No ACs returned from API');
          setAllACs([]);
        }
      } else if (allACsResponse.error === 'OFFLINE_NO_CACHE' || allACsResponse.error === 'OFFLINE_INCOMPLETE_CACHE') {
        // Try cache as fallback
        const fallbackACs = await offlineDataCache.getAllACsForState(state);
        if (fallbackACs && fallbackACs.length > 0) {
          console.log('📦 Using cached ACs as fallback:', fallbackACs.length, 'ACs');
          setAllACs(fallbackACs);
        } else {
          console.log('📴 No ACs available offline');
          setAllACs([]);
        }
      } else {
        console.error('Failed to fetch all ACs:', allACsResponse);
        setAllACs([]);
      }
    } catch (error: any) {
      console.error('Error fetching ACs:', error);
      // Try cache as final fallback
      try {
        const fallbackACs = await offlineDataCache.getAllACsForState(state);
        if (fallbackACs && fallbackACs.length > 0) {
          console.log('📦 Using cached ACs as final fallback:', fallbackACs.length, 'ACs');
          setAllACs(fallbackACs);
        } else {
          setAllACs([]);
        }
      } catch (cacheError) {
        console.error('❌ Error loading from cache fallback:', cacheError);
        setAllACs([]);
      }
    } finally {
      setLoadingAllACs(false);
    }
  };

  useEffect(() => {
    const loadACsFromCache = async () => {
      // Check if this is the target survey
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      
      // Only load if user has no assigned ACs and needs AC selection
      if (!isCatiMode && requiresACSelection && isTargetSurvey) {
        try {
          const isOnline = await apiService.isOnline();
          if (!isOnline) {
            // Offline - try to load from cache immediately
            console.log('📴 Offline detected - loading ACs from cache immediately...');
            const state = survey?.acAssignmentState || 'West Bengal';
            
            // Use static import instead of dynamic import to avoid bundle loading errors when offline
            try {
              const cachedACs = await offlineDataCache.getAllACsForState(state);
              
              if (cachedACs && cachedACs.length > 0) {
                const minExpectedACs = state === 'West Bengal' ? 200 : 50;
                if (cachedACs.length >= minExpectedACs) {
                  console.log('✅ Loaded', cachedACs.length, 'ACs from cache immediately (offline mode)');
                  setAllACs(cachedACs);
                } else {
                  console.warn('⚠️ Cached ACs incomplete:', cachedACs.length, 'ACs (expected at least', minExpectedACs, ')');
                  // Still set it so dropdown can show, but with warning
                  setAllACs(cachedACs);
                }
              } else {
                console.log('📴 No ACs found in cache');
              }
            } catch (cacheError: any) {
              console.error('❌ Error accessing offlineDataCache:', cacheError);
              console.error('❌ Cache error details:', {
                message: cacheError?.message,
                name: cacheError?.name
              });
            }
          }
        } catch (error: any) {
          console.error('❌ Error loading ACs from cache:', error);
          console.error('❌ Error details:', {
            message: error?.message,
            name: error?.name,
            stack: error?.stack
          });
        }
      }
    };
    
    loadACsFromCache();
  }, [isCatiMode, requiresACSelection, survey, survey?.acAssignmentState]);

  // Animation effects for loading screen
  useEffect(() => {
    if (isLoading) {
      // Start pulsing animation
      const pulseAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnimation, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnimation, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );

      // Start rotation animation
      const rotateAnim = Animated.loop(
        Animated.timing(rotationAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      );

      // Start loading bar animation
      const loadingBarAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(loadingAnimation, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: false,
          }),
          Animated.timing(loadingAnimation, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ])
      );

      // Rotate loading text
      const textRotateInterval = setInterval(() => {
        setLoadingTextIndex((prev) => (prev + 1) % 4);
      }, 2000);

      pulseAnim.start();
      rotateAnim.start();
      loadingBarAnim.start();

      return () => {
        pulseAnim.stop();
        rotateAnim.stop();
        loadingBarAnim.stop();
        clearInterval(textRotateInterval);
      };
    }
  }, [isLoading]);

  // Initialize interview
  useEffect(() => {
    const initializeInterview = async () => {
      setIsLoading(true);
      try {
        // Start timing
        setStartTime(new Date());

        // OPTIMIZATION: Check if survey has full data (sections/questions) from route params
        // If not, fetch full survey data in parallel with startInterview
        const hasFullSurveyData = survey?.sections && survey?.sections.length > 0;
        let fullSurveyData = survey; // Use cached survey if available

        if (isCatiMode) {
          // CATI mode - use CATI-specific endpoint
          // OPTIMIZATION: Start interview and fetch full survey data in parallel
          let result;
          let fullSurveyPromise: Promise<any> | null = null;
          
          // If survey doesn't have full data, fetch it in parallel
          if (!hasFullSurveyData) {
            console.log('📥 Survey missing full data, fetching in parallel...');
            fullSurveyPromise = apiService.getSurveyFull(survey._id);
          }
          
          try {
            // Start interview and fetch full survey in parallel
            const [interviewResult, surveyResult] = await Promise.all([
              apiService.startCatiInterview(survey._id),
              fullSurveyPromise || Promise.resolve({ success: false }) // Resolve immediately if not needed
            ]);
            
            result = interviewResult;
            
            // If we fetched full survey data, update it
            if (surveyResult && surveyResult.success && surveyResult.survey) {
              fullSurveyData = surveyResult.survey;
              console.log('✅ Fetched full survey data in parallel');
            }
          } catch (error: any) {
            console.error('❌ Error starting CATI interview:', error);
            const errorMsg = error?.response?.data?.message || error?.message || 'Failed to start CATI interview. Please check your internet connection.';
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
            setIsLoading(false);
            return; // Exit early - don't start the interview
          }
          
          // First check if the API call was successful
          if (!result || !result.success) {
            // Interview failed to start - show error and navigate back
            const errorMsg = result?.message || result?.data?.message || 'Failed to start CATI interview';
            console.error('❌ CATI interview failed to start:', errorMsg);
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
            setIsLoading(false);
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
            setIsLoading(false);
            return; // Exit early - don't start the interview
          }
          
          const data = result.data;
          // Removed excessive logging
          // console.log('📋 Received data from API:', JSON.stringify(data, null, 2));
          // console.log('📋 Respondent data:', data.respondent);
          
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
            setIsLoading(false);
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
            setIsLoading(false);
            return; // Exit early - don't start the interview
          }
          
          // All checks passed - proceed with starting the interview
          
          setSessionId(data.sessionId);
          setSessionData(data);
          setCatiQueueId(data.respondent.id); // This is the queue entry ID
          setCatiRespondent(data.respondent);
          
          // Update survey with full data if fetched
          if (fullSurveyData && fullSurveyData.sections) {
            // Update survey state with full data
            setSurvey((prevSurvey: any) => ({
              ...prevSurvey,
              sections: fullSurveyData.sections,
              questions: fullSurveyData.questions
            }));
          }
          
          // Auto-populate AC and PC from respondent info for CATI interviews
          if (data.respondent && data.respondent.ac) {
            setSelectedAC(data.respondent.ac);
            // Also set it in responses for consistency
            setResponses(prev => ({
              ...prev,
              'ac-selection': data.respondent.ac
            }));
          }
          
          setIsInterviewActive(true);
          
          // Check for AC assignment - For CATI, we don't require AC selection as it's auto-populated
          const needsACSelection = false; // Always false for CATI - AC is auto-populated from respondent
          
          setRequiresACSelection(needsACSelection);
          setAssignedACs([]);
          
          // OPTIMIZATION: Defer set number fetch - can run after interview starts
          // Set number fetch will happen in its own useEffect (already implemented)
          
          // Auto-make call after a short delay
          // Use the respondent ID directly from data, not from state (to avoid timing issues)
          setTimeout(() => {
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
          // CAPI mode - OPTIMIZATION: Run location fetch and startInterview in parallel
          setLocationLoading(true);
          
          // OPTIMIZATION: Start location fetch and interview start in parallel
          const locationPromise = (async () => {
          try {
            const isOnline = await apiService.isOnline();
            console.log('📡 Online status for location:', isOnline);
            const location = await LocationService.getCurrentLocation(!isOnline);
              return location;
          } catch (locationError) {
            console.error('Error getting location:', locationError);
              return null;
            }
          })();
          
          // OPTIMIZATION: Fetch full survey data in parallel if needed
          let fullSurveyPromise: Promise<any> | null = null;
          if (!hasFullSurveyData) {
            console.log('📥 Survey missing full data, fetching in parallel...');
            fullSurveyPromise = apiService.getSurveyFull(survey._id);
          }
          
          // Start interview, location fetch, and full survey fetch in parallel
          const [interviewResult, location, surveyResult] = await Promise.all([
            apiService.startInterview(survey._id),
            locationPromise,
            fullSurveyPromise || Promise.resolve({ success: false })
          ]);
          
          setLocationData(location);
          setLocationLoading(false);
          
          // Update survey with full data if fetched
          if (surveyResult && surveyResult.success && surveyResult.survey) {
            fullSurveyData = surveyResult.survey;
            // Update survey state with full data
            setSurvey((prevSurvey: any) => ({
              ...prevSurvey,
              sections: fullSurveyData.sections,
              questions: fullSurveyData.questions
            }));
            console.log('✅ Fetched full survey data in parallel');
          }

          // Start interview session (works offline for CAPI)
          const result = interviewResult;
          if (result.success && result.response) {
            setSessionId(result.response.sessionId);
            setSessionData(result.response);
            setIsInterviewActive(true);
            
            // Check for AC assignment
            // For CAPI: Show AC selection if requiresACSelection is true (regardless of assignedACs length)
            // If assignedACs.length === 0, we'll fetch all ACs for the state
            // Only for survey "68fd1915d41841da463f0d46"
            const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
            const needsACSelection = result.response.requiresACSelection;
            
            // CRITICAL LOGGING: Log all AC selection related data
            console.log('🔍 ========== AC SELECTION DEBUG (OFFLINE) ==========');
            console.log('🔍 Survey ID:', survey._id || survey.id);
            console.log('🔍 Is Target Survey:', isTargetSurvey);
            console.log('🔍 requiresACSelection from response:', result.response.requiresACSelection);
            console.log('🔍 assignedACs from response:', result.response.assignedACs);
            console.log('🔍 assignedACs length:', result.response.assignedACs?.length || 0);
            console.log('🔍 needsACSelection:', needsACSelection);
            console.log('🔍 Survey assignACs:', survey.assignACs);
            console.log('🔍 ================================================');
            
            setRequiresACSelection(needsACSelection);
            const assignedACsArray = result.response.assignedACs || [];
            console.log('🔍 Setting assignedACs to:', assignedACsArray, '(length:', assignedACsArray.length, ')');
            setAssignedACs(assignedACsArray);
            
            // OPTIMIZATION: Don't fetch all ACs during initialization - defer to when user opens dropdown
            // This significantly speeds up CAPI interview start time
            if (isTargetSurvey && needsACSelection && assignedACsArray.length === 0) {
              console.log('🔍 ✅ Condition met: isTargetSurvey && needsACSelection && no assignedACs - ACs will be loaded on-demand when dropdown opens');
              // Try to load from cache immediately (fast, non-blocking)
              // This allows interview to start immediately with cached ACs if available
              const state = survey?.acAssignmentState || result.response.acAssignmentState || 'West Bengal';
              loadACsFromCacheLazy(state).catch((err) => {
                console.error('⚠️ Error loading ACs from cache:', err);
                // Don't block - ACs will be fetched when dropdown opens
              });
            } else {
              setAllACs([]);
              
              // CRITICAL: Proactively cache polling groups and stations for assigned ACs
              // This ensures data is available even if internet is lost during interview
              const assignedACsList = result.response.assignedACs || [];
              if (assignedACsList.length > 0 && needsACSelection) {
                const state = survey?.acAssignmentState || result.response.acAssignmentState || 'West Bengal';
                console.log('📥 Proactively caching polling data for', assignedACsList.length, 'assigned AC(s)...');
                cachePollingDataForACs(assignedACsList, state).catch((err) => {
                  console.error('⚠️ Error proactively caching polling data:', err);
                  // Don't block interview - continue even if caching fails
                });
              }
            }
            
            // Show message if offline
            if (result.response.isOffline) {
              showSnackbar('Offline mode: Interview started locally. Will sync when online.');
            }
            
            // CRITICAL: Start audio recording FIRST (before allowing interview interaction)
            // This ensures all questions are captured in the audio recording
            const shouldRecordAudio = (survey.mode === 'capi') || 
                                     (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
            
            if (shouldRecordAudio) {
              console.log('🎙️ Starting audio recording FIRST (before interview interaction)...');
              // Start recording immediately and wait for it to be ready
              const recordingStarted = await startAudioRecording();
              
              if (!recordingStarted) {
                // Recording failed - show error and prevent interview from starting
                console.error('❌ Audio recording failed - cannot start interview');
                Alert.alert(
                  'Audio Recording Required',
                  'Failed to start audio recording. The interview cannot proceed without audio recording. Please check your permissions and try again.',
                  [
                    {
                      text: 'OK',
                      onPress: () => {
                        navigation.goBack();
                      }
                    }
                  ]
                );
                setIsLoading(false);
                return; // Exit - don't proceed with interview
              }
              
              console.log('✅ Audio recording confirmed - interview can now proceed');
            }
          } else {
            // Show detailed error message
            const errorMsg = result.message || 'Failed to start interview. Please check your connection and try again.';
            console.error('❌ Failed to start interview:', errorMsg);
            console.error('❌ Result object:', result);
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
          }
        }
      } catch (error: any) {
        console.error('Error initializing interview:', error);
        console.error('Error details:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          stack: error.stack
        });
        const errorMsg = error.response?.data?.message || error.message || 'Failed to initialize interview';
        Alert.alert(
          'Error Starting Interview',
          errorMsg || 'An error occurred while starting the interview. Please try again.',
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.goBack();
              }
            }
          ]
        );
      } finally {
        setIsLoading(false);
      }
    };

    initializeInterview();
  }, [survey._id, isCatiMode]); // Include isCatiMode in dependencies

  // Update duration
  // For CATI interviews, only start timer after call status question is passed (call_connected selected)
  useEffect(() => {
    if (!startTime || isPaused) return;
    
    // For CATI, check if call status is connected before starting timer
    if (isCatiMode) {
      const callStatusResponse = responses['call-status'];
      const isCallConnected = callStatusResponse === 'call_connected';
      if (!isCallConnected) {
        // Don't start timer if call is not connected
        return;
      }
    }

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
      setDuration(diff);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isPaused, isCatiMode, responses]);

  // Cleanup any existing recording on component mount - ensure clean state
  // This is critical for APK builds where native resources may persist
  useEffect(() => {
    const cleanupOnMount = async () => {
      // Always ensure globalRecording is null on mount
      if (globalRecording) {
        try {
          console.log('Cleaning up existing recording on mount...');
          const status = await globalRecording.getStatusAsync();
          console.log('Mount cleanup - recording status:', status);
          
          // ALWAYS try to unload, regardless of status
          // This is critical - even if just prepared (not started), we must unload
          try {
            if (status.isRecording || status.canRecord || status.isDoneRecording) {
              await globalRecording.stopAndUnloadAsync();
            } else {
              // Even if status is unknown, try to unload
              await globalRecording.stopAndUnloadAsync();
            }
          } catch (unloadError) {
            console.log('Unload error on mount (will retry):', unloadError);
            // Try one more time
            try {
              await globalRecording.stopAndUnloadAsync();
            } catch (retryError) {
              console.log('Retry unload on mount also failed:', retryError);
            }
          }
        } catch (error) {
          console.log('Cleanup on mount error (non-fatal):', error);
        }
        globalRecording = null;
        setRecording(null);
        
        // Reset audio mode to clear any prepared state
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: false,
            shouldDuckAndroid: false,
          });
          // Wait for native resources to release - longer for APK builds
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (modeError) {
          console.log('Error resetting audio mode on mount:', modeError);
        }
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

  // Fetch round numbers when AC is selected
  useEffect(() => {
    const fetchRoundNumbers = async () => {
      if (!selectedAC) {
        setAvailableRoundNumbers([]);
        setSelectedPollingStation((prev: any) => ({ ...prev, roundNumber: null }));
        return;
      }
      
      try {
        setLoadingRoundNumbers(true);
        const state = survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        // CRITICAL FIX: Use AC code (acNo) instead of AC name
        const acIdentifier = selectedPollingStation.acNo || selectedAC;
        if (!acIdentifier) {
          console.warn('⚠️ No AC identifier available for fetching round numbers');
          setAvailableRoundNumbers([]);
          return;
        }
        console.log(`🔍 Fetching round numbers for AC Code: ${acIdentifier} (name: ${selectedAC}) in state: ${state}`);
        const response = await apiService.getRoundNumbersByAC(state, acIdentifier);
        
        if (response.success && response.data?.rounds) {
          const rounds = response.data.rounds || [];
          console.log('✅ Successfully fetched round numbers:', rounds);
          setAvailableRoundNumbers(rounds);
          // Auto-select first round if available and none selected
          if (rounds.length > 0 && !selectedPollingStation.roundNumber) {
            setSelectedPollingStation((prev: any) => ({ ...prev, roundNumber: rounds[0] }));
          }
        }
      } catch (error: any) {
        console.error('❌ Error fetching round numbers:', error);
        setAvailableRoundNumbers([]);
      } finally {
        setLoadingRoundNumbers(false);
      }
    };
    
    fetchRoundNumbers();
  }, [selectedAC, survey?.acAssignmentState, sessionData?.acAssignmentState]);

  // Fetch groups when AC and Round Number are selected
  useEffect(() => {
    const fetchGroups = async () => {
      if (!selectedAC || !selectedPollingStation.roundNumber) {
        setAvailableGroups([]);
        setAvailablePollingStations([]);
        return;
      }
      
      try {
        setLoadingGroups(true);
        // Use survey's acAssignmentState or default to 'West Bengal'
        const state = survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        // CRITICAL FIX: Use AC code (acNo) if available, otherwise extract from selectedAC
        let acIdentifier: string = selectedAC;
        if (selectedPollingStation.acNo) {
          acIdentifier = selectedPollingStation.acNo; // Use numeric AC code
          console.log(`🔍 Fetching groups for AC Code: ${acIdentifier} (name: ${selectedAC}) Round: ${selectedPollingStation.roundNumber} in state: ${state}`);
        } else {
          console.warn(`⚠️ AC code not found, using AC name: ${selectedAC} (may cause conflicts!)`);
          console.log(`🔍 Fetching groups for AC Name: ${selectedAC} Round: ${selectedPollingStation.roundNumber} in state: ${state}`);
        }
        const response = await apiService.getGroupsByAC(state, acIdentifier, selectedPollingStation.roundNumber);
        
        if (response.success) {
          // Backend returns { success: true, data: { groups: [...], ac_name: ..., etc } }
          // API service returns response.data which is { success: true, data: {...} }
          const responseData = response.data || {};
          const groups = responseData.groups || [];
          console.log('✅ Successfully fetched', groups.length, 'groups for AC:', selectedAC, 'Round:', selectedPollingStation.roundNumber);
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
          // Clear polling stations when AC or round changes
          setAvailablePollingStations([]);
        } else {
          console.error('❌ Failed to fetch groups:', response.message);
          console.error('❌ Response:', response);
          
          // Check if we're offline - if so, try to use cached data more aggressively
          const isOnline = await apiService.isOnline();
          if (!isOnline) {
            console.log('📴 Offline - checking cache for groups...');
            
            // Try to load from cache directly - check multiple AC name variations
            try {
              const { offlineDataCache } = await import('../services/offlineDataCache');
              
              // Try multiple variations of AC name (normalized, original, case variations)
              const acVariations = [
                selectedAC,
                selectedAC.toUpperCase(),
                selectedAC.toLowerCase(),
                selectedAC.trim()
              ];
              
              // Also try normalized version if apiService has the method
              try {
                const normalizedAC = (apiService as any).normalizeACName?.(selectedAC) || selectedAC;
                if (normalizedAC !== selectedAC) {
                  acVariations.unshift(normalizedAC); // Try normalized first
                }
              } catch (e) {
                // normalizeACName might not be accessible, continue
              }
              
              let cachedGroups = null;
              for (const acVar of acVariations) {
                cachedGroups = await offlineDataCache.getPollingGroups(state, acVar);
                if (cachedGroups) {
                  console.log(`📦 Found cached groups for AC variation: ${acVar}`);
                  break;
                }
              }
              
              if (cachedGroups && cachedGroups.groups && Array.isArray(cachedGroups.groups) && cachedGroups.groups.length > 0) {
                console.log('📦 Found cached groups for AC:', selectedAC, cachedGroups.groups.length, 'groups');
                setAvailableGroups(cachedGroups.groups || []);
                setSelectedPollingStation((prev: any) => ({
                  ...prev,
                  state: state,
                  acName: selectedAC,
                  acNo: cachedGroups.ac_no,
                  pcNo: cachedGroups.pc_no,
                  pcName: cachedGroups.pc_name,
                  district: cachedGroups.district
                }));
                // Clear polling stations when AC changes
                setAvailablePollingStations([]);
                return; // Successfully loaded from cache
              } else {
                console.log('📴 No cached groups found for AC:', selectedAC, '(tried variations:', acVariations.join(', '), ')');
                Alert.alert(
                  'Offline Mode',
                  `Groups for "${selectedAC}" are not available offline. Please sync survey data from the dashboard when online to cache polling data for all ACs.`,
                  [{ text: 'OK' }]
                );
              }
            } catch (cacheError) {
              console.error('❌ Error loading cached groups:', cacheError);
              Alert.alert(
                'Offline Mode',
                'Groups are not available offline. Please sync survey data from the dashboard when online, or ensure you have internet connection when starting an interview.',
                [{ text: 'OK' }]
              );
            }
          } else {
            // Online but failed - show error
            Alert.alert(
              'Failed to Load Groups',
              response.message || 'Unable to load groups for the selected AC. Please check your internet connection or try syncing from the dashboard.',
              [{ text: 'OK' }]
            );
          }
          setAvailableGroups([]);
        }
      } catch (error: any) {
        console.error('❌ Error fetching groups:', error);
        console.error('❌ Error details:', error.message, error.stack);
        // Show user-friendly error message
        Alert.alert(
          'Error Loading Groups',
          'An error occurred while loading groups. Please check your internet connection or try syncing from the dashboard.',
          [{ text: 'OK' }]
        );
        setAvailableGroups([]);
        setAvailablePollingStations([]);
      } finally {
        setLoadingGroups(false);
      }
    };
    
    fetchGroups();
  }, [selectedAC, selectedPollingStation.roundNumber, survey?.acAssignmentState, sessionData?.acAssignmentState]);

  // Fetch polling stations when group and round number are selected
  useEffect(() => {
    const fetchPollingStations = async () => {
      if (!selectedPollingStation.groupName || !selectedPollingStation.acName || !selectedPollingStation.roundNumber) {
        setAvailablePollingStations([]);
        return;
      }
      
      try {
        setLoadingStations(true);
        // Use state from selectedPollingStation, survey, or default to 'West Bengal'
        const state = selectedPollingStation.state || survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
        // CRITICAL FIX: Use ONLY AC code (acNo) - NEVER use AC name to prevent conflicts
        // (e.g., "Para" vs "Hariharpara", "Kashipur" vs "Kashipur-Belgachhia")
        if (!selectedPollingStation.acNo) {
          console.error('❌ ERROR: AC code (acNo) is missing! Cannot fetch polling stations without AC code.');
          Alert.alert('Error', 'AC code is missing. Please reselect the Assembly Constituency.');
          setAvailablePollingStations([]);
          return;
        }
        const acIdentifier = selectedPollingStation.acNo; // Use ONLY numeric AC code
        const response = await apiService.getPollingStationsByGroup(
          state,
          acIdentifier,
          selectedPollingStation.groupName,
          selectedPollingStation.roundNumber
        );
        
        if (response.success) {
          // Backend returns { success: true, data: { stations: [...] } }
          // API service returns response.data which is { success: true, data: {...} }
          const responseData = response.data || {};
          const stations = responseData.stations || [];
          setAvailablePollingStations(stations);
        } else {
          console.error('Failed to fetch polling stations:', response.message);
          
          // Check if we're offline - if so, try to use cached data more aggressively
          const isOnline = await apiService.isOnline();
          if (!isOnline) {
            console.log('📴 Offline - checking cache for polling stations...');
            
            // Try to load from cache directly - check multiple AC name variations
            try {
              const { offlineDataCache } = await import('../services/offlineDataCache');
              
              // Try multiple variations of AC name
              const acName = selectedPollingStation.acName;
              const acVariations = [
                acName,
                acName?.toUpperCase(),
                acName?.toLowerCase(),
                acName?.trim()
              ].filter(Boolean) as string[];
              
              let cachedStations = null;
              for (const acVar of acVariations) {
                cachedStations = await offlineDataCache.getPollingStations(
                  state,
                  acVar,
                  selectedPollingStation.groupName
                );
                if (cachedStations) {
                  console.log(`📦 Found cached polling stations for AC variation: ${acVar}`);
                  break;
                }
              }
              
              if (cachedStations && cachedStations.stations && Array.isArray(cachedStations.stations) && cachedStations.stations.length > 0) {
                console.log('📦 Found cached polling stations:', cachedStations.stations.length, 'stations');
                setAvailablePollingStations(cachedStations.stations || []);
                return; // Successfully loaded from cache
              } else {
                console.log('📴 No cached polling stations found');
                Alert.alert(
                  'Offline Mode',
                  `Polling stations for "${selectedPollingStation.acName} - ${selectedPollingStation.groupName}" are not available offline. Please sync survey data from the dashboard when online to cache polling data.`,
                  [{ text: 'OK' }]
                );
              }
            } catch (cacheError) {
              console.error('❌ Error loading cached polling stations:', cacheError);
              Alert.alert(
                'Offline Mode',
                'Polling stations are not available offline. Please sync survey data from the dashboard when online, or ensure you have internet connection when starting an interview.',
                [{ text: 'OK' }]
              );
            }
          }
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
  }, [selectedPollingStation.groupName, selectedPollingStation.acName, selectedPollingStation.roundNumber, selectedPollingStation.state, survey?.acAssignmentState, sessionData?.acAssignmentState]);

  // Update polling station GPS and check geofencing when station is selected
  useEffect(() => {
    const updateStationGPS = async () => {
      if (!selectedPollingStation.stationName || !selectedPollingStation.groupName || !selectedPollingStation.acName) {
        return;
      }
      
        const state = selectedPollingStation.state || survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
      let stationLat: number | null = null;
      let stationLng: number | null = null;
      let gpsLocation: string | null = null;
      
      // First, try to get GPS from the selected station in availablePollingStations (if already loaded)
      // Backend returns: { name, gps_location, latitude, longitude }
      const selectedStation = availablePollingStations.find(
        (s: any) => (s.stationName || s.name) === selectedPollingStation.stationName
      );
      if (selectedStation) {
        // Check for latitude/longitude in various possible field names
        const lat = selectedStation.latitude || selectedStation.lat;
        const lng = selectedStation.longitude || selectedStation.lng || selectedStation.lon;
        if (lat && lng) {
          console.log('📍 Using GPS from station list:', lat, lng);
          stationLat = typeof lat === 'number' ? lat : parseFloat(lat);
          stationLng = typeof lng === 'number' ? lng : parseFloat(lng);
          gpsLocation = selectedStation.gps_location || selectedStation.gpsLocation || null;
        }
      }
      
      // If not found in station list, try to fetch from API/cache
      if (!stationLat || !stationLng) {
        try {
        // CRITICAL FIX: Use AC code (acNo) instead of AC name to prevent name conflicts
        const acIdentifier = selectedPollingStation.acNo || selectedPollingStation.acName;
        const response = await apiService.getPollingStationGPS(
          state,
          acIdentifier,
          selectedPollingStation.groupName,
          selectedPollingStation.stationName
        );
        
          if (response.success && response.data) {
            console.log('📍 Using GPS from API/cache:', response.data.latitude, response.data.longitude);
            stationLat = response.data.latitude;
            stationLng = response.data.longitude;
            gpsLocation = response.data.gps_location || null;
          }
        } catch (error) {
          console.error('Error fetching polling station GPS:', error);
          // Continue - we'll try to use GPS from station list if available
        }
      }
      
      // Update polling station state with GPS if we found it
      // Validate that coordinates are valid numbers
      if (stationLat != null && stationLng != null && !isNaN(stationLat) && !isNaN(stationLng)) {
          setSelectedPollingStation((prev: any) => ({
            ...prev,
          gpsLocation: gpsLocation,
          latitude: stationLat,
          longitude: stationLng
          }));
          
        // Check geofencing if in CAPI mode and locationControlBooster is DISABLED (OFF)
        // When locationControlBooster is ON (true), geofencing is BYPASSED (not enforced)
        const isCapiMode = survey.mode === 'capi' || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
        const shouldCheckGeofencing = isCapiMode && !locationControlBooster && locationData;
        
        console.log('🔍 Geo-fencing check decision:', {
          isCapiMode,
          locationControlBooster,
          hasLocationData: !!locationData,
          shouldCheckGeofencing
        });
        
        if (shouldCheckGeofencing) {
          console.log('🔒 Checking geofencing (booster is OFF) - Current:', locationData.latitude, locationData.longitude, 'Station:', stationLat, stationLng);
          await checkGeofencing(stationLat, stationLng);
        } else {
          // Clear geofencing error if booster is enabled (geofencing bypassed) OR if not in CAPI mode
          if (locationControlBooster) {
            console.log('✅ Geofencing BYPASSED - locationControlBooster is enabled (true)');
          } else if (!isCapiMode) {
            console.log('ℹ️ Geo-fencing not applicable - not in CAPI mode');
          }
          setGeofencingError(null);
        }
      } else {
        console.warn('⚠️ Could not get valid GPS coordinates for polling station - geofencing cannot be checked');
        // If booster is DISABLED and we can't get GPS, show a warning (geofencing is enforced when booster is OFF)
        if ((survey.mode === 'capi' || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && !locationControlBooster) {
          setGeofencingError('GPS coordinates for polling station not available. Please sync survey details or connect to internet.');
        } else {
          // If booster is enabled, geofencing is bypassed, so no error needed
          setGeofencingError(null);
        }
      }
    };
    
    updateStationGPS();
  }, [selectedPollingStation.stationName, selectedPollingStation.groupName, selectedPollingStation.acName, locationData, locationControlBooster, survey.mode, survey.assignedMode, availablePollingStations]);

  // Function to refresh locationControlBooster from server
  const refreshLocationControlBooster = useCallback(async () => {
    try {
      // Force refresh from server when online to get latest locationControlBooster value
      const userResult = await apiService.getCurrentUser(true); // forceRefresh = true
      if (userResult.success && userResult.user) {
        // Ensure proper boolean conversion (handle string "true"/"false" or boolean)
        const boosterValue = userResult.user.preferences?.locationControlBooster;
        const boosterEnabled = boosterValue === true || boosterValue === 'true' || boosterValue === 1;
        console.log('🔍 Location Control Booster check (fresh from server):', {
          rawValue: boosterValue,
          type: typeof boosterValue,
          converted: boosterEnabled,
          memberId: userResult.user.memberId || userResult.user._id
        });
        setLocationControlBooster(boosterEnabled);
        // Note: Geofencing will be checked when polling station is selected if booster is DISABLED (false)
        return boosterEnabled;
      } else {
        console.log('⚠️ Could not fetch user data, defaulting locationControlBooster to false');
        setLocationControlBooster(false);
        return false;
      }
    } catch (error) {
      console.error('Error checking location control booster:', error);
      // Default to false (geo-fencing enabled) if error
      setLocationControlBooster(false);
      return false;
    }
  }, []);

  // Check locationControlBooster on mount and when survey changes
  // Always fetch fresh data from server when online to ensure locationControlBooster is up-to-date
  useEffect(() => {
    refreshLocationControlBooster();
  }, [survey?._id, survey?.id, refreshLocationControlBooster]); // Re-check when survey changes (e.g., when syncing survey details)

  // Refresh locationControlBooster when screen comes into focus (e.g., after syncing survey details)
  useFocusEffect(
    useCallback(() => {
      // Refresh user data when screen comes into focus to get latest locationControlBooster
      refreshLocationControlBooster();
    }, [refreshLocationControlBooster])
  );
  
  // Note: Geofencing will be checked when polling station is selected if booster is enabled
  // No need to clear error here - let the geofencing check handle it

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
    
    // Add a small buffer (0.1km) to account for GPS accuracy issues
    const buffer = 0.1;
    if (distance > (5 + buffer)) {
      setGeofencingError(`You are not within the 5KM radius of the Polling station's location. Distance: ${distance.toFixed(2)} KM`);
      console.log('🔒 Geofencing check failed:', {
        currentLocation: { lat: locationData.latitude, lng: locationData.longitude },
        stationLocation: { lat: stationLat, lng: stationLng },
        distance: distance.toFixed(2) + ' km',
        threshold: '5.1 km (5km + 0.1km buffer)'
      });
      return false;
    } else {
      setGeofencingError(null);
      console.log('✅ Geofencing check passed:', {
        currentLocation: { lat: locationData.latitude, lng: locationData.longitude },
        stationLocation: { lat: stationLat, lng: stationLng },
        distance: distance.toFixed(2) + ' km',
        threshold: '5.1 km (5km + 0.1km buffer)'
      });
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
          // Try one more time with force
          try {
            await globalRecording.stopAndUnloadAsync();
          } catch (retryError) {
            console.log('Retry cleanup also failed:', retryError);
          }
        }
      }
      globalRecording = null;
      setRecording(null);
      // Wait longer for native resources to release - critical for APK builds
      // APK builds need more time than Expo Go
      await new Promise(resolve => setTimeout(resolve, 1500));
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

  const handleResponseChange = (questionId: string, response: any, acObject?: any) => {
    // Prevent interaction if recording hasn't started and confirmed (for CAPI mode only)
    if (!isCatiMode) {
      const shouldRecordAudio = (survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi');
      if (shouldRecordAudio && !isRecordingReady) {
        // Block interaction until recording is confirmed ready
        console.log('⚠️ Blocking interaction - recording not ready yet');
        return;
      }
    }
    
    setResponses(prev => ({
      ...prev,
      [questionId]: response
    }));
    
    // For survey "68fd1915d41841da463f0d46": When Q8 ("2025 Preference") changes, 
    // we don't clear Q9 cache - we'll filter the cached options when displaying
    // This maintains the shuffled order while removing the excluded option
    
    // Handle AC selection specially
    if (questionId === 'ac-selection') {
      setSelectedAC(response);
      
      // CRITICAL FIX: Extract AC code from the selected AC object
      // Priority: 1. acObject parameter (from dropdown), 2. Find from assignedACs/allACs arrays
      const state = survey?.acAssignmentState || sessionData?.acAssignmentState || 'West Bengal';
      let selectedACCode: string | null = null;
      let selectedACName: string = response;
      
      // First priority: Use acObject if provided (from dropdown selection)
      if (acObject && typeof acObject === 'object' && acObject.acCode) {
        selectedACCode = acObject.acCode;
        selectedACName = acObject.acName || response;
        console.log(`✅ AC code extracted from dropdown object: ${selectedACCode}`);
      } else {
        // Fallback: Find AC object from assignedACs first
        if (assignedACs && assignedACs.length > 0) {
          const acObj = assignedACs.find((ac: any) => {
            if (typeof ac === 'string') return ac === response;
            return ac.acName === response || ac.name === response || ac.displayText === response;
          });
          if (acObj && typeof acObj === 'object' && acObj.acCode) {
            selectedACCode = acObj.acCode;
            selectedACName = acObj.acName || response;
            console.log(`✅ AC code found from assignedACs: ${selectedACCode}`);
          }
        }
        
        // If not found, try allACs
        if (!selectedACCode && allACs && allACs.length > 0) {
          const acObj = allACs.find((ac: any) => ac.acName === response || ac.name === response || ac.displayText === response);
          if (acObj && acObj.acCode) {
            selectedACCode = acObj.acCode;
            selectedACName = acObj.acName || response;
            console.log(`✅ AC code found from allACs: ${selectedACCode}`);
          }
        }
      }
      
      // Extract numeric AC code (e.g., "WB245" -> "245", "WB012" -> "12")
      let numericACCode: string | null = null;
      if (selectedACCode) {
        // Remove state prefix (e.g., "WB" from "WB245")
        const stateCodeMatch = selectedACCode.match(/^([A-Z]{2})(\d+)$/);
        if (stateCodeMatch) {
          const numericPart = stateCodeMatch[2];
          // Remove leading zeros (e.g., "012" -> "12", "001" -> "1")
          numericACCode = numericPart.replace(/^0+/, '') || numericPart;
        } else {
          // If no prefix, try to extract numeric part directly
          const numericMatch = selectedACCode.match(/\d+/);
          if (numericMatch) {
            numericACCode = numericMatch[0].replace(/^0+/, '') || numericMatch[0];
          }
        }
      }
      
      console.log(`🔍 AC Selected: "${selectedACName}" → Code: ${selectedACCode} → Numeric: ${numericACCode}`);
      
      // Update selectedPollingStation with AC name AND code
      setSelectedPollingStation((prev: any) => ({
        ...prev,
        acName: selectedACName,
        acNo: numericACCode, // CRITICAL: Store numeric AC code for direct lookup
        acCode: selectedACCode, // Store full AC code for reference
        state: state
      }));
      
      // Fetch AC data to check for bye-election status (for survey "68fd1915d41841da463f0d46")
      const isByeElectionSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      if (isByeElectionSurvey && response) {
        apiService.getACData(response).then(result => {
          if (result.success && result.data) {
            setHasByeElection(result.data.hasByeElection || false);
          } else {
            setHasByeElection(false);
          }
        }).catch(err => {
          console.error('Error fetching AC bye-election status:', err);
          setHasByeElection(false);
        });
      } else {
        setHasByeElection(false);
      }
      
      // Fetch MP/MLA names immediately when AC is selected (for survey "692fe24faf8e2f42139f5a49")
      const isTargetSurvey = survey && (survey._id === '692fe24faf8e2f42139f5a49' || survey.id === '692fe24faf8e2f42139f5a49');
      if (isTargetSurvey && response) {
        apiService.getACData(response).then(result => {
          if (result.success && result.data) {
            setMpName(result.data.mpName);
            setMlaName(result.data.mlaName);
          }
        }).catch(err => {
          console.error('Error fetching MP/MLA on AC selection:', err);
        });
      }
      // Note: selectedPollingStation is already updated above (lines 2987-2993) with AC code extraction
      // No need to reset here - the state, acName, and acNo are already set correctly
      // Clear groups and polling stations - they will be fetched by useEffect
      setAvailableRoundNumbers([]);
      setAvailableGroups([]);
      setAvailablePollingStations([]);
      setGeofencingError(null);
    }
    
    // Handle polling station round number selection
    if (questionId === 'polling-station-round') {
      setSelectedPollingStation((prev: any) => ({
        ...prev,
        roundNumber: response,
        groupName: null, // Reset group when round changes
        stationName: null, // Reset station when round changes
        gpsLocation: null,
        latitude: null,
        longitude: null
      }));
      setAvailableGroups([]);
      setAvailablePollingStations([]);
      setGeofencingError(null);
      // Clear polling station selection responses when round changes
      setResponses(prev => ({
        ...prev,
        'polling-station-group': null,
        'polling-station-station': null,
        'polling-station-selection': null
      }));
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
      // Clear geofencing error when group changes (will be re-checked when station is selected)
        setGeofencingError(null);
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
      // Geofencing will be checked automatically via useEffect when station is selected
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

  // Phone number validation function
  const validatePhoneNumber = (phoneNumber: string | null | undefined): { valid: boolean; message: string | null } => {
    // Convert to string if it's not already, handle null/undefined
    const phoneStr = phoneNumber != null ? String(phoneNumber) : '';
    
    if (!phoneStr || phoneStr.trim() === '') {
      return { valid: true, message: null }; // Empty is allowed (optional field)
    }
    
    // Remove any non-digit characters
    const digitsOnly = phoneStr.replace(/\D/g, '');
    
    // Check if exactly 10 digits (required)
    if (digitsOnly.length !== 10) {
      return { valid: false, message: 'Phone number must be exactly 10 digits.' };
    }
    
    // Check for invalid patterns (repeating digits like 1111111111, 22222222, 987654321, etc.)
    // Check for all same digits
    if (/^(\d)\1{4,}$/.test(digitsOnly)) {
      return { valid: false, message: 'Please enter a valid phone number.' };
    }
    
    // Check for sequential patterns like 987654321, 123456789
    const isSequential = (str: string): boolean => {
      const nums = str.split('').map(Number);
      let ascending = true;
      let descending = true;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] !== nums[i-1] + 1) ascending = false;
        if (nums[i] !== nums[i-1] - 1) descending = false;
      }
      return ascending || descending;
    };
    
    if (digitsOnly.length >= 7 && isSequential(digitsOnly)) {
      return { valid: false, message: 'Please enter a valid phone number.' };
    }
    
    // Check for common invalid patterns
    const invalidPatterns = [
      /^1111111111$/,
      /^2222222222$/,
      /^3333333333$/,
      /^4444444444$/,
      /^5555555555$/,
      /^6666666666$/,
      /^7777777777$/,
      /^8888888888$/,
      /^9999999999$/,
      /^0000000000$/,
      /^9876543210$/,
      /^1234567890$/,
      /^987654321$/,
      /^123456789$/
    ];
    
    for (const pattern of invalidPatterns) {
      if (pattern.test(digitsOnly)) {
        return { valid: false, message: 'Please enter a valid phone number.' };
      }
    }
    
    return { valid: true, message: null };
  };

  const goToNextQuestion = () => {
    const currentQuestion = visibleQuestions[currentQuestionIndex];
    
    // For CATI interviews, check call status question
    if (isCatiMode && currentQuestion && currentQuestion.id === 'call-status') {
      const callStatusResponse = responses['call-status'];
      if (!callStatusResponse) {
        showSnackbar('Please select a call status before proceeding.');
        return;
      }
      
      // If call is not connected, don't allow moving to next question
      // User should submit instead
      if (callStatusResponse !== 'call_connected') {
        showSnackbar('Please submit the interview with the selected call status.');
        return;
      }
      
      // Call is connected, reset timer to 0 and set startTime to now
      // Timer will start automatically via useEffect after this
      setDuration(0);
      setStartTime(new Date());
    }
    
    // Check consent form question - if "No" is selected, don't allow moving forward
    if (currentQuestion && currentQuestion.id === 'consent-form') {
      const consentResponse = responses['consent-form'];
      const isConsentDisagreed = consentResponse === '2' || 
                                 consentResponse === 2 || 
                                 consentResponse === 'consent-disagree' ||
                                 String(consentResponse).toLowerCase().includes('disagree') ||
                                 String(consentResponse).toLowerCase() === 'no';
      
      if (isConsentDisagreed) {
        showSnackbar('Please abandon the interview using the Abandon button.');
        return;
      }
    }
    
    // REMOVED: Registered voter question blocking logic
    // Users can proceed to next question normally - backend condition logic will handle "No" responses appropriately
    
    // Check geofencing error for polling station questions (only if booster is DISABLED - geofencing enforced when booster is OFF)
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
    
    // For CAPI interviews, check if AC and polling station are selected before allowing navigation
    if (!isCatiMode && currentQuestion) {
      // Check if current question is AC selection - check by ID, type, or flag
      const isACSelectionQuestion = currentQuestion.id === 'ac-selection' ||
                                    (currentQuestion as any)?.isACSelection ||
                                    (currentQuestion.text && currentQuestion.text.toLowerCase().includes('select assembly constituency'));
      
      if (isACSelectionQuestion) {
        if (!selectedAC) {
          showSnackbar('Please select an Assembly Constituency before proceeding.');
          return;
        }
      }
      
      // Check if current question is polling station selection - check by ID, type, or flag
      const isPollingStationQuestion = currentQuestion.id === 'polling-station-selection' ||
                                      currentQuestion.type === 'polling_station' ||
                                      (currentQuestion as any)?.isPollingStationSelection ||
                                      (currentQuestion.text && currentQuestion.text.toLowerCase().includes('select polling station'));
      
      if (isPollingStationQuestion) {
        if (!selectedPollingStation.groupName || !selectedPollingStation.stationName) {
          showSnackbar('Please select both Group and Polling Station before proceeding.');
          return;
        }
      }
      
      // Check for phone number validation (only in CAPI mode)
      const questionText = currentQuestion.text || '';
      const isPhoneQuestion = questionText.toLowerCase().includes('share your mobile') || 
                              questionText.toLowerCase().includes('mobile number') ||
                              questionText.toLowerCase().includes('phone number');
      
      if (isPhoneQuestion) {
        const phoneResponse = responses[currentQuestion.id];
        
        // Check if "refused to share phone number" is selected (stored as 0 or '0')
        const didNotAnswer = phoneResponse === 0 || phoneResponse === '0' || phoneResponse === null || phoneResponse === undefined;
        
        // Only validate if "refused to share phone number" is NOT selected
        if (!didNotAnswer) {
          const validation = validatePhoneNumber(phoneResponse as string);
          if (!validation.valid) {
            showSnackbar(validation.message || 'Please enter a valid phone number.');
            return;
          }
        }
        // If "refused to share phone number" is selected, allow proceeding without validation
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

  const abandonInterview = async (reasonOverride: string | null = null) => {
    try {
      // If reasonOverride is provided (e.g., 'consent_refused', 'not_voter'), skip modal and use it directly
      // This handles cases where we know the reason and don't need user input
      const shouldSkipModal = reasonOverride === 'consent_refused' || reasonOverride === 'not_voter';
      
      // STEP 1: ALWAYS save offline FIRST (before any API calls)
      console.log('💾 STEP 1: Saving abandonment to offline storage FIRST...');
      
      // Build final responses for offline save
      const finalResponsesForOffline = buildFinalResponsesForOffline();
      
      // Use reasonOverride if provided, otherwise use abandonReason state
      const finalAbandonReason = reasonOverride || (abandonReason === 'other' ? abandonNotes.trim() : abandonReason);
      const finalAbandonNotes = reasonOverride === 'not_voter' ? 'Not a registered voter in this assembly constituency' :
                               reasonOverride === 'consent_refused' ? 'Consent form: No' :
                               (abandonReason === 'other' ? abandonNotes : undefined);
      
      // Save to offline storage FIRST
      const interviewId = await saveInterviewOffline({
        responses,
        finalResponses: finalResponsesForOffline,
        isCompleted: false,
        abandonReason: finalAbandonReason,
        abandonNotes: finalAbandonNotes,
      });
      
      console.log('✅ Abandonment saved offline:', interviewId);
      
      // STEP 2: Close abandon modal and show brief success message
      setShowAbandonConfirm(false);
      setAbandonReason('');
      setAbandonNotes('');
      showSnackbar('✅ Abandonment saved! Syncing in background...', 'success');
      
      // Navigate back smoothly without full reset
      setTimeout(() => {
        navigation.goBack();
      }, 500); // Small delay to show the success message
      
      // STEP 3: Abandonment is saved offline - sync service will handle submission
      // CRITICAL: Do NOT attempt background submission here
      // The sync service will handle ALL submissions to prevent race conditions
      // This ensures proper coordination and prevents duplicate submissions
      console.log('✅ Abandonment saved offline - sync service will handle submission');
      console.log('✅ No background submission - sync service is the single source of truth');
      
      return; // Exit early - sync service will handle submission
      
    } catch (error: any) {
      console.error('❌ Error abandoning interview:', error);
      showSnackbar('Error saving abandonment. Please try again.');
    }
  };

  // Background abandonment function for CATI interviews
  const attemptCatiAbandonmentInBackground = async (
    interviewId: string,
    catiQueueId: string,
    reasonOverride: string | null,
    finalAbandonReason: string,
    finalAbandonNotes: string | undefined
  ): Promise<void> => {
    try {
      console.log(`🔄 Background CATI abandonment for interview: ${interviewId}`);
      
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - abandonment saved, will sync when online');
        return;
      }

      const interview = await offlineStorage.getOfflineInterviewById(interviewId);
      if (!interview) {
        throw new Error('Interview not found in offline storage');
      }

      await offlineStorage.updateInterviewStatus(interviewId, 'syncing');

      const consentResponse = interview.responses['consent-form'];
      const isConsentRefused = consentResponse === '2' || consentResponse === 2 || reasonOverride === 'consent_refused';
      
      const reasonToSend = reasonOverride || (isConsentRefused ? 'consent_refused' : finalAbandonReason);
      const notesToSend = reasonOverride === 'consent_refused' ? 'Consent form: No' : 
                         reasonOverride === 'not_voter' ? 'Not a registered voter in this assembly constituency' :
                         (finalAbandonNotes || undefined);
      const dateToSend = (finalAbandonReason === 'call_later' && interview.metadata?.callLaterDate) ? interview.metadata.callLaterDate : undefined;
      
      const callStatusResponse = interview.responses['call-status'];
      const callStatusForStats = isConsentRefused ? null : callStatusResponse;

      const result = await apiService.abandonCatiInterview(
        catiQueueId,
        reasonToSend || undefined,
        notesToSend || undefined,
        dateToSend || undefined,
        callStatusForStats || undefined
      );

      // CRITICAL: Verify API response before considering it successful
      if (!result || !result.success) {
        throw new Error(result?.message || 'CATI abandonment failed');
      }
      
      // CRITICAL: Do NOT mark as synced or delete here
      // Let the sync service handle status updates and cleanup after proper verification
      console.log('✅ Background CATI abandonment completed - sync service will verify and cleanup:', interviewId);
      
      // Update status back to pending so sync service can handle it properly
      await offlineStorage.updateInterviewStatus(interviewId, 'pending');
    } catch (error: any) {
      console.error('❌ Background CATI abandonment error:', error);
      await offlineStorage.updateInterviewStatus(interviewId, 'failed', error.message);
    }
  };

  // Background abandonment function for CAPI interviews
  const attemptCapiAbandonmentInBackground = async (
    interviewId: string,
    sessionId: string,
    finalResponses: any[],
    finalAbandonReason: string,
    finalAbandonNotes: string | undefined
  ): Promise<void> => {
    try {
      console.log(`🔄 Background CAPI abandonment for interview: ${interviewId}`);
      
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - abandonment saved, will sync when online');
        return;
      }

      const interview = await offlineStorage.getOfflineInterviewById(interviewId);
      if (!interview) {
        throw new Error('Interview not found in offline storage');
      }

      await offlineStorage.updateInterviewStatus(interviewId, 'syncing');

      const metadata = {
        selectedAC: interview.selectedAC || null,
        selectedPollingStation: interview.selectedPollingStation || null,
        location: interview.locationData || null,
        qualityMetrics: {
          averageResponseTime: 0,
          backNavigationCount: 0,
          dataQualityScore: 0,
          totalPauseTime: 0,
          totalPauses: 0
        },
        setNumber: interview.selectedSetNumber || null,
        abandonedReason: finalAbandonReason,
        abandonmentNotes: finalAbandonNotes || undefined
      };

      const result = await apiService.abandonInterview(sessionId, finalResponses, metadata);

      // CRITICAL: Verify API response before considering it successful
      if (!result || !result.success) {
        throw new Error(result?.message || 'CAPI abandonment failed');
      }
      
      // CRITICAL: Verify that the abandonment was actually recorded on the server
      const responseId = result.response?._id || 
                         result.response?.id || 
                         result.response?.mongoId || 
                         result.response?.responseId;
      
      if (!result.response || !responseId) {
        throw new Error('Abandonment returned success but no response ID - may have failed');
      }
      
      // CRITICAL: Do NOT mark as synced or delete here
      // Let the sync service handle status updates and cleanup after proper verification
      console.log('✅ Background CAPI abandonment completed - sync service will verify and cleanup:', interviewId);
      console.log('✅ Response ID:', responseId);
      
      // Update status back to pending so sync service can handle it properly
      await offlineStorage.updateInterviewStatus(interviewId, 'pending');
    } catch (error: any) {
      console.error('❌ Background CAPI abandonment error:', error);
      await offlineStorage.updateInterviewStatus(interviewId, 'failed', error.message);
    }
  };

  // Get recording configuration based on retry attempt
  // Progressive fallback: best settings first, then simpler ones for old devices
  const getRecordingConfig = (retryCount: number): any => {
    const configs = [
      // Configuration 0: Best quality (for modern devices)
      {
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
      },
      // Configuration 1: Medium quality (for average devices)
      {
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 22050, // Lower sample rate for better compatibility
          numberOfChannels: 1,
          bitRate: 64000, // Lower bitrate
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 22050,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 64000,
        },
      },
      // Configuration 2: Low quality (for old devices)
      {
        android: {
          extension: '.3gp', // Use 3GP format for maximum compatibility
          outputFormat: Audio.AndroidOutputFormat.THREE_GPP,
          audioEncoder: Audio.AndroidAudioEncoder.AMR_NB, // AMR for old devices
          sampleRate: 8000, // Very low sample rate
          numberOfChannels: 1,
          bitRate: 12200, // Very low bitrate
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.LOW,
          sampleRate: 8000,
          numberOfChannels: 1,
          bitRate: 12200,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 12200,
        },
      },
      // Configuration 3: Minimum quality (last resort)
      {
        android: {
          extension: '.3gp',
          outputFormat: Audio.AndroidOutputFormat.THREE_GPP,
          audioEncoder: Audio.AndroidAudioEncoder.AMR_NB,
          sampleRate: 8000,
          numberOfChannels: 1,
          bitRate: 8000, // Minimum bitrate
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.LOW,
          sampleRate: 8000,
          numberOfChannels: 1,
          bitRate: 8000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 8000,
        },
      },
    ];
    
    // Return configuration based on retry count (clamp to available configs)
    return configs[Math.min(retryCount, configs.length - 1)];
  };

  // Internal function to attempt recording start with specific configuration
  const attemptRecordingStart = async (retryCount: number): Promise<void> => {
    // Step 1: Quick cleanup of any existing recording (only if needed)
    if (globalRecording) {
      try {
        const status = await globalRecording.getStatusAsync();
        if (status.isRecording || status.canRecord || status.isDoneRecording) {
          await globalRecording.stopAndUnloadAsync();
        }
      } catch (cleanupError) {
        console.log('Cleanup error (non-fatal):', cleanupError);
      }
      globalRecording = null;
      setRecording(null);
      // Minimal wait for native module cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Step 2: Request permissions first
    console.log('Requesting audio permissions...');
    const { status: permStatus } = await Audio.requestPermissionsAsync();
    if (permStatus !== 'granted') {
      setAudioPermission(false);
      throw new Error('Audio permission not granted');
    }
    setAudioPermission(true);
    
    // Step 3: Set audio mode for recording
    console.log('Setting audio mode for recording...');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    
    // Wait for audio mode (longer on first attempt, shorter on retries)
    await new Promise(resolve => setTimeout(resolve, retryCount === 0 ? 150 : 50));
    
    // Step 4: Get recording configuration based on retry count
    // Progressive fallback: try best settings first, then simpler ones for old devices
    const config = getRecordingConfig(retryCount);
    console.log(`Using configuration ${retryCount + 1}:`, config);
    
    // Step 5: Create and prepare recording object
    console.log('Creating and preparing recording...');
    const recording = new Audio.Recording();
    
    try {
      await recording.prepareToRecordAsync(config);
    } catch (prepareError: any) {
      console.error('Prepare error:', prepareError);
      try {
        const status = await recording.getStatusAsync();
        if (status.canRecord || status.isDoneRecording) {
          await recording.stopAndUnloadAsync();
        }
      } catch (cleanupErr) {
        console.log('Error cleaning up failed prepare:', cleanupErr);
      }
      throw new Error(`Failed to prepare recording: ${prepareError.message}`);
    }
    
    // Step 6: Set globalRecording after successful preparation
    globalRecording = recording;
    setRecording(recording);
    
    // Step 7: Wait before starting (shorter wait on retries)
    await new Promise(resolve => setTimeout(resolve, retryCount === 0 ? 150 : 50));
    
    // Step 8: Start recording
    console.log('Starting recording...');
    try {
      await recording.startAsync();
      
      // Get URI immediately after starting
      try {
        const uri = recording.getURI();
        if (uri) {
          setAudioUri(uri);
          console.log('✅ Audio URI set after start:', uri);
        }
      } catch (uriError) {
        // URI might not be available until stop - this is normal
        console.log('⚠️ URI not available immediately (normal)');
      }
    } catch (startError: any) {
      console.error('Start error:', startError);
      try {
        await recording.stopAndUnloadAsync();
      } catch (cleanupErr) {
        console.log('Error cleaning up failed start:', cleanupErr);
      }
      globalRecording = null;
      setRecording(null);
      throw new Error(`Failed to start recording: ${startError.message}`);
    }
    
    // Step 9: Verify it actually started (CRITICAL - this ensures recording is really recording)
    const statusAfterStart = await recording.getStatusAsync();
    console.log('Status after start:', statusAfterStart);
    
    if (!statusAfterStart.isRecording) {
      // Clean up if start failed
      try {
        await recording.stopAndUnloadAsync();
      } catch (cleanupErr) {
        console.log('Error cleaning up failed start:', cleanupErr);
      }
      globalRecording = null;
      setRecording(null);
      throw new Error('Recording did not start - status verification failed');
    }
    
    // Step 10: Double verification - check again after brief moment (ensures it's stable)
    await new Promise(resolve => setTimeout(resolve, 150));
    const finalStatus = await recording.getStatusAsync();
    if (!finalStatus.isRecording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch (cleanupErr) {
        console.log('Error cleaning up unstable recording:', cleanupErr);
      }
      globalRecording = null;
      setRecording(null);
      throw new Error('Recording stopped immediately after start');
    }
  };

  // Professional-grade audio recording with retry and fallback configurations
  // This ensures 100% reliability even on old Android devices
  const startAudioRecording = async (retryCount: number = 0): Promise<boolean> => {
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10000; // 10 second timeout per attempt
    
    // Synchronous check to prevent concurrent calls
    if (isRecording || isStartingRecording) {
      console.log('Already recording or starting, skipping...');
      return isRecording && isRecordingReady;
    }
    
    // Set lock immediately to prevent concurrent execution
    isStartingRecording = true;
    setIsRecordingReady(false); // Reset ready state
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Recording start timeout - taking too long')), TIMEOUT_MS);
    });
    
    try {
      console.log(`=== EXPO-AV AUDIO RECORDING START (Attempt ${retryCount + 1}/${MAX_RETRIES + 1}) ===`);
      
      // Race against timeout
      await Promise.race([
        attemptRecordingStart(retryCount),
        timeoutPromise
      ]);
      
      // SUCCESS - Recording is confirmed and stable!
      setIsRecording(true);
      setIsAudioPaused(false);
      setIsRecordingReady(true); // CRITICAL: Mark as ready - interview can now proceed
      isStartingRecording = false;
      
      console.log('✅ Recording started and verified successfully');
      showSnackbar('Audio recording started');
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error starting recording (attempt ${retryCount + 1}):`, error);
      
      // Retry with different configuration if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        console.log(`🔄 Retrying with fallback configuration (${retryCount + 1}/${MAX_RETRIES})...`);
        isStartingRecording = false; // Release lock for retry
        
        // Wait a bit before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 300 * (retryCount + 1)));
        
        // Retry with next configuration
        return startAudioRecording(retryCount + 1);
      }
      
      // All retries failed
      showSnackbar(`Failed to start recording after ${MAX_RETRIES + 1} attempts. Please restart the app.`);
      setAudioPermission(false);
      setIsRecording(false);
      setIsRecordingReady(false);
      setIsAudioPaused(false);
      setRecording(null);
      isStartingRecording = false;
      
      // Clean up on error
      if (globalRecording) {
        try {
          const status = await globalRecording.getStatusAsync();
          if (status.isRecording || status.canRecord || status.isDoneRecording) {
            await globalRecording.stopAndUnloadAsync();
          }
        } catch (cleanupError) {
          console.log('Error during error cleanup:', cleanupError);
        }
        globalRecording = null;
      }
      
      return false;
    }
  };

  const stopAudioRecording = async () => {
    try {
      console.log('🛑 Stopping audio recording...');
      console.log('   Current isRecording:', isRecording);
      console.log('   Current globalRecording:', !!globalRecording);
      console.log('   Current audioUri state:', audioUri);
      
      if (!isRecording || !globalRecording) {
        console.log('⚠️ Not recording or no globalRecording, returning existing audioUri:', audioUri);
        return audioUri;
      }
      
      // Get URI BEFORE stopping (some platforms require this)
      let uri: string | null = null;
      try {
        uri = globalRecording.getURI();
        console.log('📹 URI before stop:', uri);
      } catch (uriError) {
        console.warn('⚠️ Could not get URI before stop:', uriError);
      }
      
      // Stop and unload the recording
      await globalRecording.stopAndUnloadAsync();
      console.log('✅ Recording stopped and unloaded');
      
      // Try to get URI again after stopping (some platforms set it after stop)
      if (!uri) {
        try {
          uri = globalRecording.getURI();
          console.log('📹 URI after stop:', uri);
        } catch (uriError) {
          console.warn('⚠️ Could not get URI after stop:', uriError);
        }
      }
      
      // If still no URI, try to get it from the recording object's internal state
      if (!uri && globalRecording) {
        try {
          // Some platforms store URI differently - try accessing it directly
          const status = await globalRecording.getStatusAsync();
          console.log('📊 Final recording status:', status);
          // Note: getURI() should work, but if it doesn't, we'll use the existing audioUri
        } catch (statusError) {
          console.warn('⚠️ Could not get status after stop:', statusError);
        }
      }
      
      // Use the retrieved URI or fall back to existing
      const finalUri = uri || audioUri;
      console.log('✅ Final audio URI:', finalUri);
      
      if (finalUri) {
        setAudioUri(finalUri);
        console.log('✅ Audio URI saved to state');
      } else {
        console.error('❌ No audio URI available after stopping recording!');
      }
      
      setIsRecording(false);
      setIsRecordingReady(false); // Reset ready state when stopping
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
      return finalUri;
    } catch (error: any) {
      console.error('❌ Error stopping recording:', error);
      showSnackbar('Failed to stop recording');
      
      // Try to get URI even if stop failed
      let fallbackUri = audioUri;
      if (globalRecording) {
        try {
          const uri = globalRecording.getURI();
          if (uri) {
            fallbackUri = uri;
            console.log('✅ Retrieved URI from failed recording:', fallbackUri);
          }
        } catch (uriError) {
          console.warn('⚠️ Could not get URI from failed recording:', uriError);
        }
      }
      
      // Force cleanup anyway
      globalRecording = null;
      setIsRecording(false);
      setIsRecordingReady(false); // Reset ready state on error
      setIsAudioPaused(false);
      setRecording(null);
      
      if (fallbackUri) {
        setAudioUri(fallbackUri);
      }
      
      return fallbackUri;
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
    
    // For CATI interviews, if call status is not connected, skip consent form validation
    const callStatusResponse = responses['call-status'];
    const isCallConnected = callStatusResponse === 'call_connected';
    const shouldSkipConsentCheck = isCatiMode && callStatusResponse && !isCallConnected;
    
    // Check all visible questions (questions that were actually shown to the user)
    visibleQuestions.forEach((question, index) => {
      if (question.required) {
        // Skip consent form validation if call is not connected
        if (shouldSkipConsentCheck && question.id === 'consent-form') {
          return; // Skip this question
        }
        
        // Special handling for AC selection question
        if (question.id === 'ac-selection' || (question as any)?.isACSelection) {
          if (!selectedAC) {
            unansweredRequiredQuestions.push({
              question: question,
              index: index
            });
            return;
          }
        }
        
        // Special handling for polling station selection question
        if (question.id === 'polling-station-selection' || question.type === 'polling_station' || (question as any)?.isPollingStationSelection) {
          if (!selectedPollingStation.groupName || !selectedPollingStation.stationName) {
            unansweredRequiredQuestions.push({
              question: question,
              index: index
            });
            return;
          }
        }
        
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

  // Helper function to save interview offline (CAPI only)
  const saveInterviewOffline = async (
    interviewData: {
      responses: Record<string, any>;
      finalResponses?: any[];
      isCompleted: boolean;
      abandonReason?: string;
      abandonNotes?: string;
      audioUri?: string | null; // Optional: pass audio URI directly
    }
  ): Promise<string> => {
    // CATI interviews can now be saved offline as backup
    // They will still require internet for final sync, but can be saved for safety
    
    try {
      const interviewId = offlineStorage.generateInterviewId();
      const endTime = new Date();
      
      // Calculate actual duration from start and end time
      // Use the current duration state as fallback, but prefer calculated from timestamps
      let actualDuration = duration; // Use current duration state as default
      if (startTime) {
        try {
          // startTime is a Date object, so we can use it directly
          const start = startTime instanceof Date ? startTime : new Date(startTime);
          const end = endTime;
          const calculatedDuration = Math.floor((end.getTime() - start.getTime()) / 1000);
          // Use calculated duration if it's valid and positive
          if (calculatedDuration > 0) {
            actualDuration = calculatedDuration;
            console.log('✅ Calculated duration from timestamps:', actualDuration, 'seconds');
          } else {
            console.log('⚠️ Calculated duration is invalid, using state duration:', duration);
          }
        } catch (durationError) {
          console.error('Error calculating duration:', durationError);
          console.log('Using state duration as fallback:', duration);
        }
      } else {
        console.log('⚠️ No startTime available, using state duration:', duration);
      }
      
      console.log('📊 Saving interview with duration:', actualDuration, 'seconds');
      
      // Get audio URI - CRITICAL: Use the audio from THIS interview session
      // Priority: 1) interviewData.audioUri (explicitly passed), 2) Currently recording audio, 3) State audioUri (but verify it's recent)
      let finalAudioUri = interviewData.audioUri || null;
      
      // If currently recording, we MUST stop and get the current recording
      // Ensure audio is stopped and saved - CRITICAL for offline mode (only for CAPI)
      if (!isCatiMode && isRecording) {
        console.log('🔄 Stopping audio recording before saving offline...');
        console.log('   Current isRecording:', isRecording);
        console.log('   Interview startTime:', startTime);
        try {
          const stoppedUri = await stopAudioRecording();
          if (stoppedUri) {
            finalAudioUri = stoppedUri;
            setAudioUri(stoppedUri); // Update state
            console.log('✅ Audio stopped and URI retrieved:', finalAudioUri);
            
            // Verify the audio file was created during this interview session
            try {
              const audioFileInfo = await FileSystem.getInfoAsync(stoppedUri);
              if (audioFileInfo.exists && startTime) {
                const audioModTime = audioFileInfo.modificationTime || audioFileInfo.birthtime || 0;
                const interviewStartTime = startTime.getTime() / 1000; // Convert to seconds
                const timeDiff = Math.abs(audioModTime - interviewStartTime);
                
                // Audio should be created within 5 minutes of interview start (allowing for slight delays)
                if (timeDiff > 300) {
                  console.warn(`⚠️ Audio file modification time (${audioModTime}) is far from interview start (${interviewStartTime}), diff: ${timeDiff}s`);
                  console.warn('⚠️ This audio file might not belong to this interview!');
                } else {
                  console.log('✅ Audio file time matches interview timeframe');
                }
              }
            } catch (verifyError) {
              console.warn('⚠️ Could not verify audio file timestamp:', verifyError);
            }
          } else {
            console.warn('⚠️ stopAudioRecording returned null/undefined');
          }
        } catch (audioError) {
          console.error('❌ Error stopping audio before saving offline:', audioError);
        }
      } else if (!isCatiMode && !finalAudioUri && audioUri) {
        // Not currently recording, but we have an audioUri in state
        // CRITICAL: Verify this audio URI is from THIS interview, not a previous one
        console.log('⚠️ Using state audioUri - verifying it belongs to this interview...');
        try {
          const audioFileInfo = await FileSystem.getInfoAsync(audioUri);
          if (audioFileInfo.exists && startTime) {
            const audioModTime = audioFileInfo.modificationTime || audioFileInfo.birthtime || 0;
            const interviewStartTime = startTime.getTime() / 1000;
            const timeDiff = Math.abs(audioModTime - interviewStartTime);
            
            // Audio should be created within 5 minutes of interview start
            if (timeDiff <= 300) {
              finalAudioUri = audioUri;
              console.log('✅ State audioUri verified - belongs to this interview (time diff:', timeDiff, 's)');
            } else {
              console.error(`❌ AUDIO MISMATCH: State audioUri is from ${Math.round(timeDiff / 60)} minutes ${timeDiff > interviewStartTime ? 'after' : 'before'} interview start!`);
              console.error('❌ This audio file does NOT belong to this interview - NOT using it');
              finalAudioUri = null;
            }
          } else {
            console.warn('⚠️ Could not verify audio file - using with caution');
            finalAudioUri = audioUri; // Use it but log warning
          }
        } catch (verifyError) {
          console.error('⚠️ Error verifying audio file timestamp:', verifyError);
          console.warn('⚠️ Not using potentially incorrect audioUri from state');
          finalAudioUri = null;
        }
      }
      
      if (!finalAudioUri && !isCatiMode) {
        console.warn('⚠️ No valid audio URI available for this interview');
      }
      
      // Copy audio file to offline storage (only for CAPI, CATI doesn't have audio)
      let audioOfflinePath: string | null = null;
      if (!isCatiMode && finalAudioUri) {
        try {
          // Verify audio file exists
          const fileInfo = await FileSystem.getInfoAsync(finalAudioUri);
          if (fileInfo.exists && fileInfo.size > 0) {
            console.log('✅ Audio file exists at path:', finalAudioUri, 'Size:', fileInfo.size, 'bytes');
            
            // Copy to offline storage
            try {
              audioOfflinePath = await offlineStorage.copyAudioFileToOfflineStorage(finalAudioUri, interviewId);
              console.log('✅ Audio file copied to offline storage:', audioOfflinePath);
            } catch (copyError: any) {
              console.error('❌ Error copying audio file to offline storage:', copyError);
              // Continue anyway - interview will be saved without offline audio copy
              // Original URI will still be stored
            }
          } else {
            console.error('❌ Audio file does NOT exist or is empty at path:', finalAudioUri);
            console.warn('⚠️ Saving interview without audio file');
            finalAudioUri = null; // Don't save invalid URI
          }
        } catch (fileCheckError) {
          console.error('❌ Error checking audio file:', fileCheckError);
          // Continue anyway - file might exist but check failed
        }
      } else if (isCatiMode) {
        console.log('ℹ️ CATI interview - no audio recording');
      } else {
        console.warn('⚠️ No audio URI to save for offline interview');
      }
      
      const offlineInterview: OfflineInterview = {
        id: interviewId,
        surveyId: survey._id,
        survey: null, // Don't store full survey - will be fetched from cache during sync using surveyId
        surveyName: survey.surveyName, // Store survey name for display
        sessionId: sessionId || undefined,
        catiQueueId: isCatiMode ? (catiQueueId || undefined) : undefined,
        callId: isCatiMode ? (callId || undefined) : undefined,
        isCatiMode: isCatiMode, // Support both CAPI and CATI
        responses: interviewData.responses,
        locationData: locationData, // Includes GPS coordinates, address, city, state, etc.
        selectedAC: selectedAC || null,
        selectedPollingStation: selectedPollingStation.stationName ? {
          ...selectedPollingStation,
          // Ensure all polling station data is included (Lok Sabha, District, etc.)
          state: selectedPollingStation.state || survey?.acAssignmentState || 'West Bengal',
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
        selectedSetNumber: selectedSetNumber || null,
        startTime: startTime ? startTime.toISOString() : new Date().toISOString(),
        endTime: endTime.toISOString(),
        duration: actualDuration, // Use calculated duration
        audioUri: finalAudioUri || null, // Original URI (for reference)
        audioOfflinePath: audioOfflinePath || null, // Copied file path (safe storage)
        audioUploadStatus: audioOfflinePath ? 'pending' : undefined, // Set status if audio exists
        audioUploadError: null,
        metadata: {
          qualityMetrics: {
            averageResponseTime: 0,
            backNavigationCount: 0,
            dataQualityScore: 100,
            totalPauseTime: 0,
            totalPauses: 0,
          },
          callStatus: isCatiMode ? (responses['call-status'] || 'call_connected') : undefined,
          supervisorID: responses['supervisor-id'] || undefined,
          finalResponses: interviewData.finalResponses,
          isCompleted: interviewData.isCompleted,
          abandonReason: interviewData.abandonReason,
          abandonNotes: interviewData.abandonNotes,
          locationControlBooster: locationControlBooster, // Save booster status (when true, geofencing is bypassed)
          geofencingError: geofencingError || null, // Save geofencing status
        },
        status: 'pending',
        syncAttempts: 0,
      };

      await offlineStorage.saveOfflineInterview(offlineInterview);
      console.log('✅ Interview saved offline:', interviewId);
      return interviewId;
    } catch (error: any) {
      console.error('❌ Error saving interview offline:', error);
      throw error;
    }
  };

  // Helper function: Build final responses array (used by both save and submit)
  const buildFinalResponsesForSubmission = (): any[] => {
    return allQuestions.map((question: any, index: number) => {
      const defaultResponse = (question.type === 'multiple_choice' && question.settings?.allowMultiple) ? [] : '';
      const response = responses[question.id] !== undefined ? responses[question.id] : defaultResponse;
      
      let processedResponse: any;
      if (question.type === 'multiple_choice' && question.settings?.allowMultiple) {
        if (Array.isArray(response)) {
          processedResponse = response;
        } else if (response && response !== '') {
          processedResponse = [response];
        } else {
          processedResponse = [];
        }
      } else {
        processedResponse = response || '';
      }
      
      let responseCodes: string | string[] | null = null;
      let responseWithCodes: any = null;
      
      const othersOption = question.options?.find((opt: any) => {
        const optText = opt.text || '';
        return isOthersOption(optText);
      });
      const othersOptionValue = othersOption ? (othersOption.value || othersOption.text) : null;
      
      if (question.type === 'multiple_choice' && question.options) {
        if (Array.isArray(processedResponse)) {
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
                const othersText = othersTextInputs[`${question.id}_${respValue}`] || '';
                if (othersText) {
                  (responseCodes as string[]).push(optCode || respValue);
                  (responseWithCodes as any[]).push({
                    code: optCode || respValue,
                    answer: othersText,
                    optionText: optText
                  });
                } else {
                  (responseCodes as string[]).push(optCode || respValue);
                  (responseWithCodes as any[]).push({
                    code: optCode || respValue,
                    answer: optText,
                    optionText: optText
                  });
                }
              } else {
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
          const selectedOption = question.options.find((opt: any) => {
            const optValue = opt.value || opt.text;
            return optValue === processedResponse;
          });
          if (selectedOption) {
            const optText = selectedOption.text || '';
            const optCode = selectedOption.code || null;
            const isOthers = isOthersOption(optText);
            if (isOthers) {
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
      
      let finalResponse = processedResponse;
      if (question.type === 'multiple_choice' && responseWithCodes) {
        if (Array.isArray(responseWithCodes)) {
          const othersResponse = responseWithCodes.find((r: any) => r.optionText && isOthersOption(r.optionText) && r.answer !== r.optionText);
          if (othersResponse) {
            finalResponse = (processedResponse as string[]).map((val: string) => {
              if (val === othersResponse.code || val === othersOptionValue) {
                return `Others: ${othersResponse.answer}`;
              }
              return val;
            });
          }
        } else if (responseWithCodes.optionText && isOthersOption(responseWithCodes.optionText) && responseWithCodes.answer !== responseWithCodes.optionText) {
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
        response: finalResponse,
        responseCodes: responseCodes,
        responseWithCodes: responseWithCodes,
        responseTime: 0,
        isRequired: question.required,
        isSkipped: !response
      };
    });
  };

  // Helper function: Build final responses for offline save (simpler format)
  const buildFinalResponsesForOffline = (): any[] => {
    return allQuestions.map((question: any, index: number) => {
      const defaultResponse = (question.type === 'multiple_choice' && question.settings?.allowMultiple) ? [] : '';
      const response = responses[question.id] !== undefined ? responses[question.id] : defaultResponse;
      
      let processedResponse: any;
      if (question.type === 'multiple_choice' && question.settings?.allowMultiple) {
        if (Array.isArray(response)) {
          processedResponse = response;
        } else if (response && response !== '') {
          processedResponse = [response];
        } else {
          processedResponse = [];
        }
      } else {
        processedResponse = response || '';
      }
      
      const othersOption = question.options?.find((opt: any) => {
        const optText = opt.text || '';
        return isOthersOption(optText);
      });
      const othersOptionValue = othersOption ? (othersOption.value || othersOption.text) : null;
      
      let finalResponse = processedResponse;
      if (othersOptionValue && (processedResponse === othersOptionValue || 
          (Array.isArray(processedResponse) && processedResponse.includes(othersOptionValue)))) {
        const othersText = othersTextInputs[`${question.id}_${othersOptionValue}`] || '';
        if (othersText) {
          if (Array.isArray(processedResponse)) {
            finalResponse = processedResponse.map((r: any) => 
              r === othersOptionValue ? `Others: ${othersText}` : r
            );
          } else {
            finalResponse = `Others: ${othersText}`;
          }
        }
      }
      
      return {
        sectionIndex: question.sectionIndex || 0,
        questionIndex: question.questionIndex !== undefined ? question.questionIndex : index,
        questionId: question.id,
        questionType: question.type,
        questionText: question.text,
        questionDescription: question.description,
        questionOptions: question.options?.map((opt: any) => (typeof opt === 'object' ? opt.text : opt)) || [],
        response: finalResponse,
        responseTime: 0,
        isRequired: question.required || false,
        isSkipped: !response || (Array.isArray(response) && response.length === 0)
      };
    });
  };

  // Background submission function for CAPI interviews
  const attemptCapiOnlineSubmission = async (
    interviewId: string,
    finalResponses: any[],
    audioUri: string | null,
    audioOfflinePath: string | null
  ): Promise<void> => {
    try {
      console.log(`🔄 Background submission for interview: ${interviewId}`);
      
      // Check if online
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - interview saved, will sync later');
        return;
      }

      // Get interview from offline storage
      const interview = await offlineStorage.getOfflineInterviewById(interviewId);
      if (!interview) {
        throw new Error('Interview not found in offline storage');
      }

      // Update status to syncing
      await offlineStorage.updateInterviewStatus(interviewId, 'syncing');

      // Upload audio if available (use offline path if available, otherwise original URI)
      let audioUrl: string | null = null;
      let audioFileSize: number = 0;
      
      const audioPathToUpload = audioOfflinePath || audioUri;
      if (audioPathToUpload && !isCatiMode) {
        try {
          // Check if audio is already uploaded
          if (interview.audioUploadStatus === 'uploaded' && interview.metadata?.audioUrl) {
            audioUrl = interview.metadata.audioUrl;
            console.log('✅ Using already uploaded audio:', audioUrl);
          } else {
            // Upload audio with retry
            console.log('📤 Uploading audio file...');
            interview.audioUploadStatus = 'uploading';
            await offlineStorage.saveOfflineInterview(interview);

            const uploadResult = await apiService.uploadAudioFile(
              audioPathToUpload,
              sessionId!,
              survey._id
            );

            if (uploadResult.success && uploadResult.response?.audioUrl) {
              audioUrl = uploadResult.response.audioUrl;
              audioFileSize = uploadResult.response.size || 0;
              interview.audioUploadStatus = 'uploaded';
              interview.metadata = {
                ...interview.metadata,
                audioUrl: audioUrl,
              };
              await offlineStorage.saveOfflineInterview(interview);
              console.log('✅ Audio uploaded successfully:', audioUrl);
            } else {
              throw new Error(uploadResult.message || 'Audio upload failed');
            }
          }
        } catch (audioError: any) {
          console.error('❌ Audio upload failed:', audioError);
          interview.audioUploadStatus = 'failed';
          interview.audioUploadError = audioError.message;
          await offlineStorage.saveOfflineInterview(interview);
          // Continue with submission even if audio upload failed
          console.log('⚠️ Continuing with submission without audio');
        }
      }

      // Extract metadata
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      let oldInterviewerID: string | null = null;
      let supervisorID: string | null = null;
      if (isTargetSurvey) {
        const interviewerIdResponse = responses['interviewer-id'];
        if (interviewerIdResponse !== null && interviewerIdResponse !== undefined && interviewerIdResponse !== '') {
          oldInterviewerID = String(interviewerIdResponse);
        }
        const supervisorIdResponse = responses['supervisor-id'];
        if (supervisorIdResponse !== null && supervisorIdResponse !== undefined && supervisorIdResponse !== '') {
          supervisorID = String(supervisorIdResponse);
        }
      }

      // Complete interview
      const result = await apiService.completeInterview(sessionId!, {
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
          startTime: sessionData?.startTime || startTime || new Date(),
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
          audioRecording: audioUrl ? {
            audioUrl: audioUrl,
            hasAudio: true,
            recordingDuration: Math.round(duration),
            format: 'm4a',
            codec: 'aac',
            bitrate: 128000,
            fileSize: audioFileSize,
            uploadedAt: new Date().toISOString()
          } : null,
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
          completionPercentage: Math.round((finalResponses.filter((r: any) => hasResponseContent(r.response)).length / allQuestions.length) * 100),
          setNumber: null,
          OldinterviewerID: oldInterviewerID,
          supervisorID: supervisorID
        }
      });

      // CRITICAL: Verify API response before considering it successful
      if (!result || !result.success) {
        throw new Error(result?.message || 'Submission failed');
      }
      
      // CRITICAL: Verify that the interview was actually created on the server
      // Check for response ID to confirm server-side creation
      const responseId = result.response?._id || 
                         result.response?.id || 
                         result.response?.mongoId || 
                         result.response?.responseId;
      
      if (!result.response || !responseId) {
        throw new Error('Submission returned success but no response ID - may have failed');
      }
      
      // Fix 3: Atomic metadata and status update - store responseId and update status together
      // This prevents race conditions where metadata might be updated but status is not
      await offlineStorage.updateInterviewMetadataAndStatus(
        interviewId,
        {
          responseId: responseId,
          serverResponseId: responseId,
        },
        'pending' // Keep as pending so sync service can verify and mark as synced
      );
      console.log('✅ Atomically stored responseId in interview metadata and updated status:', responseId);
      
      // CRITICAL: Do NOT mark as synced or delete here
      // Let the sync service handle status updates and cleanup after proper verification
      // Just log success - the sync service will pick it up and verify it properly
      console.log('✅ Background submission completed - sync service will verify and cleanup:', interviewId);
      console.log('✅ Response ID:', responseId);
    } catch (error: any) {
      console.error('❌ Background submission error:', error);
      // Mark as failed, will retry later
      await offlineStorage.updateInterviewStatus(interviewId, 'failed', error.message);
    }
  };

  // Background submission function for CATI interviews
  const attemptCatiOnlineSubmission = async (
    interviewId: string,
    finalResponses: any[],
    catiQueueId: string
  ): Promise<void> => {
    try {
      console.log(`🔄 Background CATI submission for interview: ${interviewId}`);
      
      // Check if online
      const isOnline = await apiService.isOnline();
      if (!isOnline) {
        console.log('📴 Offline - CATI interview saved, will sync when online');
        return;
      }

      // Get interview from offline storage
      const interview = await offlineStorage.getOfflineInterviewById(interviewId);
      if (!interview) {
        throw new Error('Interview not found in offline storage');
      }

      // Update status to syncing
      await offlineStorage.updateInterviewStatus(interviewId, 'syncing');

      // Extract metadata
      const answeredCount = finalResponses.filter((r: any) => hasResponseContent(r.response)).length;
      const totalCount = allQuestions.length;
      let finalSetNumber = selectedSetNumber;
      
      if (finalSetNumber === null && survey) {
        const setNumbers = new Set<number>();
        survey.sections?.forEach((section: any) => {
          section.questions?.forEach((question: any) => {
            if (question.setsForThisQuestion && question.setNumber !== null && question.setNumber !== undefined) {
              const wasAnswered = finalResponses.some((r: any) => r.questionId === question.id);
              if (wasAnswered) {
                setNumbers.add(question.setNumber);
              }
            }
          });
        });
        const setArray = Array.from(setNumbers).sort((a, b) => a - b);
        if (setArray.length > 0) {
          finalSetNumber = setArray[0];
        }
      }

      const callStatusResponse = responses['call-status'];
      const finalCallStatus = callStatusResponse === 'call_connected' ? 'success' : (callStatusResponse || 'unknown');

      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      let oldInterviewerID: string | null = null;
      let supervisorID: string | null = null;
      if (isTargetSurvey) {
        const interviewerIdResponse = responses['interviewer-id'];
        if (interviewerIdResponse !== null && interviewerIdResponse !== undefined && interviewerIdResponse !== '') {
          oldInterviewerID = String(interviewerIdResponse);
        }
        const supervisorIdResponse = responses['supervisor-id'];
        if (supervisorIdResponse !== null && supervisorIdResponse !== undefined && supervisorIdResponse !== '') {
          supervisorID = String(supervisorIdResponse);
        }
      }

      // Complete CATI interview
      const result = await apiService.completeCatiInterview(catiQueueId, {
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
        completionPercentage: totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0,
        setNumber: finalSetNumber,
        OldinterviewerID: oldInterviewerID,
        callStatus: finalCallStatus,
        supervisorID: supervisorID
      });

      // CRITICAL: Verify API response before considering it successful
      if (!result || !result.success) {
        throw new Error(result?.message || 'CATI submission failed');
      }
      
      // CRITICAL: Do NOT mark as synced or delete here
      // Let the sync service handle status updates and cleanup after proper verification
      // Just log success - the sync service will pick it up and verify it properly
      console.log('✅ Background CATI submission completed - sync service will verify and cleanup:', interviewId);
      
      // Update status back to pending so sync service can handle it properly
      // The sync service will verify the submission and mark as synced
      await offlineStorage.updateInterviewStatus(interviewId, 'pending');
    } catch (error: any) {
      console.error('❌ Background CATI submission error:', error);
      // Mark as failed, will retry later
      await offlineStorage.updateInterviewStatus(interviewId, 'failed', error.message);
    }
  };

  const completeInterview = async () => {
    if (!sessionId) return;

    // Check if consent form is "No" - if so, abandon instead of complete
    const consentResponse = responses['consent-form'];
    const isConsentDisagreed = consentResponse === '2' || consentResponse === 2;
    const shouldAbandonForConsent = isConsentDisagreed;
    
    // If consent form is "No", abandon the interview
    if (shouldAbandonForConsent && catiQueueId) {
      try {
        setIsLoading(true);
        
        const result = await apiService.abandonCatiInterview(
          catiQueueId,
          'consent_refused',
          'Consent form: No',
          undefined, // No call later date
          undefined // No call status (call was connected, consent was refused)
        );
        
        if (result.success) {
          Alert.alert(
            'Interview Abandoned',
            'Interview abandoned. Consent refusal recorded for reporting.',
            [
              {
                text: 'OK',
                onPress: () => {
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Dashboard' }],
                  });
                },
              },
            ]
          );
        } else {
          const errorMsg = result.message || 'Failed to abandon interview';
          showSnackbar(errorMsg);
        }
      } catch (error: any) {
        console.error('Error abandoning interview due to consent refusal:', error);
        showSnackbar(error.message || 'Failed to abandon interview');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // If call status is not connected (CATI), abandon instead of complete
    const callStatusResponse = responses['call-status'];
    const isCallConnected = callStatusResponse === 'call_connected';
    const shouldAbandonForCallStatus = isCatiMode && callStatusResponse && !isCallConnected;
    
    // If call status is not connected, abandon the interview
    if (shouldAbandonForCallStatus && catiQueueId) {
      try {
        setIsLoading(true);
        
        // Map call status to abandonment reason
        const statusToReasonMap: { [key: string]: string } = {
          'busy': 'busy',
          'switched_off': 'switched_off',
          'not_reachable': 'not_reachable',
          'did_not_pick_up': 'no_answer',
          'number_does_not_exist': 'does_not_exist',
          'didnt_get_call': 'technical_issue'
        };
        
        const abandonmentReason = statusToReasonMap[callStatusResponse] || callStatusResponse;
        
        const result = await apiService.abandonCatiInterview(
          catiQueueId,
          abandonmentReason,
          `Call status: ${callStatusResponse}`,
          undefined, // No call later date
          callStatusResponse // Pass call status for stats
        );
        
        if (result.success) {
          Alert.alert(
            'Interview Abandoned',
            'Interview abandoned. Call status recorded for reporting.',
            [
              {
                text: 'OK',
                onPress: () => {
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Dashboard' }],
                  });
                }
              }
            ]
          );
        } else {
          showSnackbar(result.message || 'Failed to abandon interview');
        }
      } catch (error) {
        console.error('Error abandoning interview:', error);
        showSnackbar('Failed to abandon interview');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // If call status is not connected (CATI), skip consent form check and proceed with submission
    // For CATI interviews, if call status is not connected, consent form doesn't matter
    const shouldSkipConsentCheck = isCatiMode && callStatusResponse && !isCallConnected;
    
    // If consent form is disagreed, save consent response + dynamic questions (interviewer ID, supervisor ID)
    // For survey "68fd1915d41841da463f0d46", we need to include these even when consent is "No"
    if (isConsentDisagreed && !shouldSkipConsentCheck) {
      const consentQuestion = allQuestions.find((q: any) => q.id === 'consent-form');
      const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
      
      if (consentQuestion) {
        try {
          setIsLoading(true);
          
          // Build finalResponses array - always include consent, and include dynamic questions for target survey
          const finalResponses: any[] = [{
            sectionIndex: consentQuestion.sectionIndex,
            questionIndex: consentQuestion.questionIndex,
            questionId: consentQuestion.id,
            questionType: consentQuestion.type,
            questionText: consentQuestion.text,
            questionDescription: consentQuestion.description,
            questionOptions: consentQuestion.options.map((opt: any) => typeof opt === 'object' ? opt.text : opt),
            response: responses['consent-form'] || '2',
            responseTime: 0,
            isRequired: true,
            isSkipped: false
          }];
          
          // For target survey, also include interviewer ID and supervisor ID if they exist
          if (isTargetSurvey) {
            const interviewerIdQuestion = allQuestions.find((q: any) => q.id === 'interviewer-id');
            const supervisorIdQuestion = allQuestions.find((q: any) => q.id === 'supervisor-id');
            
            if (interviewerIdQuestion && responses['interviewer-id'] !== undefined && responses['interviewer-id'] !== null && responses['interviewer-id'] !== '') {
              finalResponses.push({
                sectionIndex: interviewerIdQuestion.sectionIndex,
                questionIndex: interviewerIdQuestion.questionIndex,
                questionId: interviewerIdQuestion.id,
                questionType: interviewerIdQuestion.type,
                questionText: interviewerIdQuestion.text,
                questionDescription: interviewerIdQuestion.description,
                questionOptions: interviewerIdQuestion.options?.map((opt: any) => typeof opt === 'object' ? opt.text : opt) || [],
                response: responses['interviewer-id'],
                responseTime: 0,
                isRequired: interviewerIdQuestion.required || false,
                isSkipped: false
              });
            }
            
            if (supervisorIdQuestion && responses['supervisor-id'] !== undefined && responses['supervisor-id'] !== null && responses['supervisor-id'] !== '') {
              finalResponses.push({
                sectionIndex: supervisorIdQuestion.sectionIndex,
                questionIndex: supervisorIdQuestion.questionIndex,
                questionId: supervisorIdQuestion.id,
                questionType: supervisorIdQuestion.type,
                questionText: supervisorIdQuestion.text,
                questionDescription: supervisorIdQuestion.description,
                questionOptions: supervisorIdQuestion.options?.map((opt: any) => typeof opt === 'object' ? opt.text : opt) || [],
                response: responses['supervisor-id'],
                responseTime: 0,
                isRequired: supervisorIdQuestion.required || false,
                isSkipped: false
              });
            }
          }
          
          // Extract interviewer ID and supervisor ID for metadata (for target survey)
          let oldInterviewerID: string | null = null;
          let supervisorID: string | null = null;
          if (isTargetSurvey) {
            if (responses['interviewer-id'] !== null && responses['interviewer-id'] !== undefined && responses['interviewer-id'] !== '') {
              oldInterviewerID = String(responses['interviewer-id']);
            }
            if (responses['supervisor-id'] !== null && responses['supervisor-id'] !== undefined && responses['supervisor-id'] !== '') {
              supervisorID = String(responses['supervisor-id']);
            }
          }
          
          const result = await apiService.completeInterview(sessionId, {
            responses: finalResponses,
            qualityMetrics: {
              averageResponseTime: 0,
              backNavigationCount: 0,
              dataQualityScore: 0,
              totalPauseTime: 0,
              totalPauses: 0
            },
            metadata: {
              survey: survey._id,
              interviewer: sessionData?.interviewer || 'current-user',
              status: 'Pending_Approval',
              sessionId: sessionId,
              startTime: sessionData?.startTime || startTime || new Date(),
              endTime: new Date(),
              totalTimeSpent: duration,
              interviewMode: survey.mode === 'multi_mode' ? (survey.assignedMode || 'capi') : (survey.mode || 'capi'),
              selectedAC: selectedAC || null,
              selectedPollingStation: selectedPollingStation || null,
              location: locationData || null,
              setNumber: selectedSetNumber || null,
              OldinterviewerID: oldInterviewerID, // Include interviewer ID for target survey
              supervisorID: supervisorID, // Include supervisor ID for target survey
              consentResponse: 'no' // Explicitly set consentResponse to 'no' for backend processing
            }
          });
          
          if (result.success) {
            Alert.alert(
              'Interview Completed',
              'Interview completed and submitted for Quality Review.',
              [
                {
                  text: 'OK',
                  onPress: () => {
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
        } catch (error: any) {
          console.error('Error abandoning interview:', error);
          showSnackbar(error.message || 'Failed to abandon interview');
        } finally {
          setIsLoading(false);
        }
        return;
      }
    }

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
      setIsSubmitting(true);
      
      console.log('💾 STEP 1: Saving interview to offline storage FIRST (before any API calls)...');
      
      // STEP 1: ALWAYS save offline FIRST (before any API calls)
      // Stop audio recording if still recording (only for CAPI)
      let currentAudioUri = audioUri;
      if (!isCatiMode && (isRecording || !audioUri)) {
        console.log('🛑 Stopping audio recording before saving...');
        try {
          const stoppedUri = await stopAudioRecording();
          if (stoppedUri) {
            currentAudioUri = stoppedUri;
            setAudioUri(stoppedUri);
            console.log('✅ Audio stopped and URI saved:', currentAudioUri);
          } else {
            console.warn('⚠️ stopAudioRecording returned null, using existing audioUri:', audioUri);
            currentAudioUri = audioUri;
          }
        } catch (audioStopError) {
          console.error('❌ Error stopping audio:', audioStopError);
          if (!currentAudioUri) {
            console.warn('⚠️ No audio URI available after error');
          }
        }
      } else {
        console.log('✅ Using existing audio URI:', currentAudioUri);
      }
      
      // Build final responses for offline save
      const finalResponsesForOffline = buildFinalResponsesForOffline();
      
      // Save to offline storage FIRST
      const interviewId = await saveInterviewOffline({
        responses,
        finalResponses: finalResponsesForOffline,
        isCompleted: true,
        audioUri: currentAudioUri,
      });
      
      // Get the saved interview to retrieve audio offline path
      const savedInterview = await offlineStorage.getOfflineInterviewById(interviewId);
      const audioOfflinePath = savedInterview?.audioOfflinePath || null;
      
      console.log('✅ Interview saved offline:', interviewId);
      console.log('✅ Audio offline path:', audioOfflinePath);
      
      setIsLoading(false);
      setIsSubmitting(false);
      
      // STEP 2: Show brief success message and navigate smoothly (no full reset)
      showSnackbar('✅ Interview saved! Syncing in background...', 'success');
      
      // Navigate back smoothly without resetting the navigation stack
      // This prevents full dashboard reload
      setTimeout(() => {
        navigation.goBack();
      }, 500); // Small delay to show the success message
      
      // STEP 3: Interview is saved offline - sync service will handle submission
      // CRITICAL: Do NOT attempt background submission here
      // The sync service will handle ALL submissions to prevent race conditions
      // This ensures proper coordination and prevents duplicate submissions
      console.log('✅ Interview saved offline - sync service will handle submission');
      console.log('✅ No background submission - sync service is the single source of truth');
      
      return; // Exit early - sync service will handle submission
      
    } catch (error: any) {
      console.error('❌ Error completing interview:', error);
      showSnackbar('Error saving interview. Please try again.');
      setIsLoading(false);
      setIsSubmitting(false);
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

  // Helper function to check if a question is an age question (by ID or text, ignoring translations)
  const isAgeQuestion = (question: any): boolean => {
    if (!question) return false;
    const questionText = getMainText(question.text || '').toLowerCase();
    const questionId = question.id || '';
    
    // Check for fixed age question ID
    if (questionId.includes('fixed_respondent_age')) {
      return true;
    }
    
    // Check for age question text (ignoring translations)
    if (questionText.includes('could you please tell me your age') || 
        questionText.includes('tell me your age') ||
        questionText.includes('what is your age') ||
        questionText.includes('your age in complete years') ||
        questionText.includes('age in complete years')) {
      return true;
    }
    
    return false;
  };

  // Validate fixed questions against target audience
  const validateFixedQuestion = (questionId: string, response: any) => {
    const question = allQuestions.find(q => q.id === questionId);
    
    // Check if it's an age question (by ID or by text, ignoring translations)
    if (questionId === 'fixed_respondent_age' || isAgeQuestion(question)) {
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
    
    // Skip for "Second Choice" questions - they need dynamic filtering based on "2025 Preference" response
    // Filtering will be done in renderQuestion, so we return empty array to force use of filteredOptions
    // ONLY for survey "68fd1915d41841da463f0d46"
    const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
    const questionText = currentQuestion.text || '';
    const isSecondChoiceQuestion = questionText.includes('Second Choice') || 
                                   questionText.includes('দ্বিতীয় পছন্দ') ||
                                   questionText.toLowerCase().includes('second choice');
    if (isTargetSurvey && isSecondChoiceQuestion) {
      return []; // Return empty to force use of filteredOptions in renderQuestion
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
  }, [currentQuestion, shuffledOptions, computeShuffledOptions, responses]); // Add responses to dependencies

  // Update shuffledOptions state when current question changes (useEffect to avoid render loop)
  useEffect(() => {
    if (!currentQuestion || currentQuestion.type !== 'multiple_choice') return;
    
    // Skip for polling station selection questions (they don't have options)
    if ((currentQuestion as any)?.isPollingStationSelection) return;
    
    const questionId = currentQuestion.id;
    const questionOptions = 'options' in currentQuestion ? (currentQuestion as any).options : [];
    // Only compute and cache if not already cached
    // Note: For "Second Choice" questions, we still cache the shuffled options,
    // but we'll filter out the excluded option when displaying them
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
  // Helper function to render AC searchable dropdown (extracted for reuse)
  const renderACSearchableDropdown = (question: any) => {
    // Use allACs state directly if question.allACs is empty (for offline support)
    const acsToUse = (question.allACs && question.allACs.length > 0) ? question.allACs : allACs;
    const filteredACs = acsToUse && acSearchTerm
      ? acsToUse.filter((ac: any) => {
          const searchLower = acSearchTerm.toLowerCase();
          const searchText = ac.searchText || `${ac.acCode || ''} ${ac.acName || ''}`.toLowerCase();
          const acName = (ac.acName || '').toLowerCase();
          const acCode = (ac.acCode || '').toLowerCase();
          return searchText.includes(searchLower) || acName.includes(searchLower) || acCode.includes(searchLower);
        })
      : (acsToUse || []);
    
    console.log('🔍 AC Dropdown Render - allACs state:', allACs.length, 'question.allACs:', question.allACs?.length || 0, 'acsToUse:', acsToUse.length, 'filteredACs:', filteredACs.length);
    
    return (
      <View style={styles.pollingStationContainer}>
        <View style={[styles.pollingStationSection, showACDropdown && { zIndex: 1001 }]}>
          <Text style={styles.pollingStationLabel}>Select Assembly Constituency *</Text>
          {loadingAllACs ? (
            <View style={{ alignItems: 'center', padding: 20 }}>
              <ActivityIndicator size="small" color="#2563eb" />
              <Text style={{ marginTop: 10, color: '#666' }}>Loading ACs...</Text>
            </View>
          ) : filteredACs.length === 0 && acSearchTerm ? (
            <Text style={styles.pollingStationError}>No ACs found matching "{acSearchTerm}". Try a different search term.</Text>
          ) : acsToUse.length === 0 ? (
            <View style={{ padding: 20 }}>
              <Text style={styles.pollingStationError}>No ACs available offline. Please sync survey details when online, or ensure you have internet connection when starting the interview.</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.dropdownButton}
                onPress={async () => {
                  // OPTIMIZATION: Load ACs on-demand when dropdown opens
                  if (allACs.length === 0 && !loadingAllACs) {
                    const state = survey?.acAssignmentState || 'West Bengal';
                    await loadACsOnDemand(state);
                  }
                  setShowACDropdown(true);
                }}
              >
                <Text style={[
                  styles.dropdownButtonText,
                  !selectedAC && styles.dropdownPlaceholder
                ]}>
                  {selectedAC || 'Search and select an Assembly Constituency...'}
                </Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              
              {/* AC Selection Modal - Bottom Sheet with Search */}
              <Modal
                visible={showACDropdown}
                transparent={true}
                animationType="slide"
                onRequestClose={() => {
                  setShowACDropdown(false);
                  setACSearchTerm('');
                }}
              >
                <View style={styles.modalBackdrop}>
                  <TouchableOpacity
                    style={styles.modalBackdropTouchable}
                    activeOpacity={1}
                    onPress={() => {
                      setShowACDropdown(false);
                      setACSearchTerm('');
                    }}
                  />
                  <View style={styles.bottomSheetContainer}>
                    <View style={styles.bottomSheetHeader}>
                      <Text style={styles.bottomSheetTitle}>Select Assembly Constituency</Text>
                      <TouchableOpacity onPress={() => {
                        setShowACDropdown(false);
                        setACSearchTerm('');
                      }}>
                        <Text style={styles.bottomSheetClose}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Search Input */}
                    <View style={styles.searchContainer}>
                      <TextInput
                        mode="outlined"
                        placeholder="Search by AC Code or Name..."
                        value={acSearchTerm}
                        onChangeText={setACSearchTerm}
                        style={styles.searchInput}
                        left={<TextInput.Icon icon="magnify" />}
                      />
                    </View>
                    <ScrollView 
                      style={styles.bottomSheetContent}
                      contentContainerStyle={styles.bottomSheetContentInner}
                      showsVerticalScrollIndicator={true}
                      keyboardShouldPersistTaps="handled"
                    >
                      {filteredACs.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyStateText}>No ACs found matching "{acSearchTerm}"</Text>
                        </View>
                      ) : (
                        filteredACs.map((ac: any, index: number) => (
                          <TouchableOpacity
                            key={`ac-${ac.acCode}-${index}`}
                            activeOpacity={0.7}
                            style={[
                              styles.bottomSheetItem,
                              selectedAC === ac.acName && styles.bottomSheetItemSelected
                            ]}
                            onPress={() => {
                              // Pass AC object to handler so we can extract acCode immediately
                              handleResponseChange('ac-selection', ac.acName, ac);
                              setShowACDropdown(false);
                              setACSearchTerm('');
                            }}
                          >
                            <View>
                              <Text style={[
                                styles.bottomSheetItemText,
                                selectedAC === ac.acName && styles.bottomSheetItemTextSelected
                              ]}>
                                {ac.acName}
                              </Text>
                              {ac.acCode && (
                                <Text style={[
                                  styles.bottomSheetItemSubtext,
                                  selectedAC === ac.acName && styles.bottomSheetItemSubtextSelected
                                ]}>
                                  Code: {ac.acCode}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderQuestion = (question: any) => {
    // For multiple_choice questions with allowMultiple, initialize as array if not set
    const defaultResponse = (question.type === 'multiple_choice' && question.settings?.allowMultiple) ? [] : '';
    const currentResponse = responses[question.id] !== undefined ? responses[question.id] : defaultResponse;
    const questionId = question.id;
    
    // Calculate hasAssignedACs for AC selection questions (use question.isSearchable as fallback)
    // If isSearchable is false or undefined, it means user has assigned ACs
    const hasAssignedACs = question.id === 'ac-selection' || question.isACSelection 
      ? (question.isSearchable === false || (!question.isSearchable && question.type === 'single_choice'))
      : false;
    
    // Filter options for "Second Choice" question based on "2025 Preference" selection
    // ONLY for survey "68fd1915d41841da463f0d46"
    let filteredOptions = question.options;
    const questionText = question.text || '';
    const isSecondChoiceQuestion = questionText.includes('Second Choice') || 
                                   questionText.includes('দ্বিতীয় পছন্দ') ||
                                   questionText.toLowerCase().includes('second choice');
    
    // Only apply this filtering logic for the specific survey
    const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
    
    // Find "2025 Preference" question - declare it at the top of function scope so it's accessible everywhere
    // Initialize as null to avoid ReferenceError
    let preference2025Question: any = null;
    if (isTargetSurvey && isSecondChoiceQuestion) {
      preference2025Question = allQuestions.find((q: any) => {
        const qText = q.text || '';
        return qText.includes('2025 Preference') || 
               qText.includes('২০২৫ পছন্দ') ||
               qText.toLowerCase().includes('2025 preference');
      }) || null;
    }
    
    if (isTargetSurvey && isSecondChoiceQuestion && question.options) {
      if (preference2025Question) {
        const preferenceResponse = responses[preference2025Question.id];
        if (preferenceResponse) {
          // Get the selected option value (handle both string and array responses)
          let selectedOptionValue: any = null;
          if (Array.isArray(preferenceResponse)) {
            selectedOptionValue = preferenceResponse[0]; // Take first selection
          } else {
            selectedOptionValue = preferenceResponse;
          }
          
          // Find the matched option from "2025 Preference" question
          let matchedOptionFromPreference: any = null;
          if (preference2025Question.options && preference2025Question.options.length > 0) {
            // Find the option that matches the response
            matchedOptionFromPreference = preference2025Question.options.find((opt: any) => {
              const optValue = typeof opt === 'object' ? (opt.value || opt.text) : opt;
              const optText = typeof opt === 'object' ? opt.text : opt;
              // Try exact matches first
              return optValue === selectedOptionValue || 
                     optText === selectedOptionValue ||
                     String(optValue) === String(selectedOptionValue) ||
                     String(optText) === String(selectedOptionValue);
            });
          }
          
          // Get the main text (without translation) of the selected option for comparison
          let selectedOptionMainText: string | null = null;
          if (matchedOptionFromPreference) {
            const matchedOptionText = typeof matchedOptionFromPreference === 'object' 
              ? (matchedOptionFromPreference.text || matchedOptionFromPreference.value || '') 
              : String(matchedOptionFromPreference);
            selectedOptionMainText = getMainText(matchedOptionText);
          } else {
            // Fallback: use the response value and extract main text
            selectedOptionMainText = getMainText(String(selectedOptionValue));
          }
          
          // Filter out the selected option from "Second Choice" options using main text comparison (ignoring translations)
          if (selectedOptionMainText) {
            filteredOptions = question.options.filter((option: any) => {
              const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
              const optionValue = typeof option === 'object' ? (option.value || option.text) : option;
              
              // Get main text (without translation) for comparison
              const optionMainText = getMainText(optionText);
              const optionValueMainText = getMainText(String(optionValue));
              
              // Compare main texts (ignoring translations)
              if (optionMainText === selectedOptionMainText || optionValueMainText === selectedOptionMainText) {
                return false; // Exclude this option
              }
              
              // Also check if the option value matches the selected value (exact match)
              if (optionValue === selectedOptionValue || String(optionValue) === String(selectedOptionValue)) {
                return false; // Exclude this option
              }
              
              return true; // Keep this option
            });
          }
        }
      }
    }

    // Use memoized display options for current question, or compute for other questions
    // BUT: For "Second Choice" questions, use cached shuffled options but filter out the excluded option
    // This maintains the shuffled order while removing the excluded option
    let displayOptions = filteredOptions;
    
    // Only use cached displayOptions if it's NOT a "Second Choice" question
    // For "Second Choice", we use cached shuffled options but filter out excluded option
    // (isSecondChoiceQuestion is already declared above at line 2460)
    if (question.id === currentQuestion?.id && currentQuestionDisplayOptions.length > 0 && !isSecondChoiceQuestion) {
      displayOptions = currentQuestionDisplayOptions;
    } else if (question.type === 'multiple_choice') {
      // For "Second Choice" questions, use cached shuffled options but remove excluded option
      if (isTargetSurvey && isSecondChoiceQuestion) {
        // Check if we have cached shuffled options
        if (shuffledOptions[questionId] && shuffledOptions[questionId].length > 0) {
          // Use cached shuffled options, but filter out the excluded option
          const cachedShuffled = shuffledOptions[questionId];
          
          // Get the excluded option main text for comparison
          if (preference2025Question) {
            const preferenceResponse = responses[preference2025Question.id];
            if (preferenceResponse) {
              let selectedOptionValue: any = null;
              if (Array.isArray(preferenceResponse)) {
                selectedOptionValue = preferenceResponse[0];
              } else {
                selectedOptionValue = preferenceResponse;
              }
              
              // Find the matched option and get its main text
              let selectedOptionMainText: string | null = null;
              if (preference2025Question.options && preference2025Question.options.length > 0) {
                const matchedOption = preference2025Question.options.find((opt: any) => {
                  const optValue = typeof opt === 'object' ? (opt.value || opt.text) : opt;
                  const optText = typeof opt === 'object' ? opt.text : opt;
                  return optValue === selectedOptionValue || 
                         optText === selectedOptionValue ||
                         String(optValue) === String(selectedOptionValue) ||
                         String(optText) === String(selectedOptionValue);
                });
                
                if (matchedOption) {
                  const matchedOptionText = typeof matchedOption === 'object' 
                    ? (matchedOption.text || matchedOption.value || '') 
                    : String(matchedOption);
                  selectedOptionMainText = getMainText(matchedOptionText);
                } else {
                  selectedOptionMainText = getMainText(String(selectedOptionValue));
                }
              } else {
                selectedOptionMainText = getMainText(String(selectedOptionValue));
              }
              
              // Filter out the excluded option from cached shuffled options
              if (selectedOptionMainText) {
                displayOptions = cachedShuffled.filter((option: any) => {
                  const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
                  const optionValue = typeof option === 'object' ? (option.value || option.text) : option;
                  const optionMainText = getMainText(optionText);
                  const optionValueMainText = getMainText(String(optionValue));
                  
                  // Exclude if main text matches
                  if (optionMainText === selectedOptionMainText || optionValueMainText === selectedOptionMainText) {
                    return false;
                  }
                  // Exclude if value matches
                  if (optionValue === selectedOptionValue || String(optionValue) === String(selectedOptionValue)) {
                    return false;
                  }
                  return true;
                });
              } else {
                displayOptions = cachedShuffled;
              }
            } else {
              // No Q8 response yet, use cached shuffled options as is
              displayOptions = cachedShuffled;
            }
          } else {
            // Couldn't find Q8, use cached shuffled options as is
            displayOptions = cachedShuffled;
          }
        } else {
          // No cache yet, compute shuffled options from ORIGINAL options (not filtered) and cache them
          // We'll filter out the excluded option when displaying
          const originalOptions = question.options || [];
          displayOptions = computeShuffledOptions(questionId, originalOptions, question);
          // After caching, filter out the excluded option for display
          if (preference2025Question) {
            const preferenceResponse = responses[preference2025Question.id];
            if (preferenceResponse) {
              let selectedOptionValue: any = null;
              if (Array.isArray(preferenceResponse)) {
                selectedOptionValue = preferenceResponse[0];
              } else {
                selectedOptionValue = preferenceResponse;
              }
              
              let selectedOptionMainText: string | null = null;
              if (preference2025Question.options && preference2025Question.options.length > 0) {
                const matchedOption = preference2025Question.options.find((opt: any) => {
                  const optValue = typeof opt === 'object' ? (opt.value || opt.text) : opt;
                  const optText = typeof opt === 'object' ? opt.text : opt;
                  return optValue === selectedOptionValue || 
                         optText === selectedOptionValue ||
                         String(optValue) === String(selectedOptionValue) ||
                         String(optText) === String(selectedOptionValue);
                });
                
                if (matchedOption) {
                  const matchedOptionText = typeof matchedOption === 'object' 
                    ? (matchedOption.text || matchedOption.value || '') 
                    : String(matchedOption);
                  selectedOptionMainText = getMainText(matchedOptionText);
                } else {
                  selectedOptionMainText = getMainText(String(selectedOptionValue));
                }
              } else {
                selectedOptionMainText = getMainText(String(selectedOptionValue));
              }
              
              if (selectedOptionMainText) {
                displayOptions = displayOptions.filter((option: any) => {
                  const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
                  const optionValue = typeof option === 'object' ? (option.value || option.text) : option;
                  const optionMainText = getMainText(optionText);
                  const optionValueMainText = getMainText(String(optionValue));
                  
                  if (optionMainText === selectedOptionMainText || optionValueMainText === selectedOptionMainText) {
                    return false;
                  }
                  if (optionValue === selectedOptionValue || String(optionValue) === String(selectedOptionValue)) {
                    return false;
                  }
                  return true;
                });
              }
            }
          }
        }
      } else {
        // For other questions, use normal shuffling with cache
        if (shuffledOptions[questionId]) {
          displayOptions = shuffledOptions[questionId];
        } else {
          // Compute shuffled options (will be cached in useEffect if this is the current question)
          displayOptions = computeShuffledOptions(questionId, filteredOptions || [], question);
        }
      }
    } else if (question.type === 'single_choice' || question.type === 'single_select' || question.type === 'dropdown') {
      // Move "Others" to the end for single_choice and dropdown
      const othersOptions: any[] = [];
      const regularOptions: any[] = [];
      (filteredOptions || []).forEach((option: any) => {
        const optionText = typeof option === 'object' ? (option.text || option.value || '') : String(option);
        if (isOthersOption(optionText)) {
          othersOptions.push(option);
        } else {
          regularOptions.push(option);
        }
      });
      displayOptions = [...regularOptions, ...othersOptions];
    }

    // CRITICAL: Handle ac_searchable_dropdown FIRST before any other cases
    // This ensures it's always rendered correctly, even if question.type is somehow wrong
    if (question.id === 'ac-selection' || question.isACSelection) {
      console.log('🔍 Rendering AC selection question - type:', question.type, 'isSearchable:', question.isSearchable, 'hasAssignedACs:', hasAssignedACs);
      
      // Force ac_searchable_dropdown if no assigned ACs, regardless of question.type
      if (!hasAssignedACs && question.type !== 'ac_searchable_dropdown') {
        console.warn('⚠️ AC question type mismatch - forcing ac_searchable_dropdown (type was:', question.type, ')');
        // Render as dropdown directly
        return renderACSearchableDropdown(question);
      } else if (hasAssignedACs && question.type === 'ac_searchable_dropdown') {
        console.warn('⚠️ AC question type mismatch - should be single_choice but is ac_searchable_dropdown');
        // Fall through to single_choice rendering
      }
    }
    
    switch (question.type) {
      case 'ac_searchable_dropdown':
        return renderACSearchableDropdown(question);
        
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
        // Check if this is the phone number question
        const questionText = question.text || '';
        const isPhoneQuestion = questionText.toLowerCase().includes('share your mobile') || 
                                questionText.toLowerCase().includes('mobile number') ||
                                questionText.toLowerCase().includes('phone number');
        const isInterviewerIdQuestion = question.id === 'interviewer-id' || question.isInterviewerId;
        const didNotAnswer = currentResponse === 0 || currentResponse === '0';
        
        return (
          <View style={styles.phoneNumberContainer}>
            <TextInput
              mode="outlined"
              value={didNotAnswer ? '' : (currentResponse !== null && currentResponse !== undefined ? currentResponse.toString() : '')}
              onChangeText={(text) => {
                // Allow empty string or valid number (including 0 and negative numbers)
                if (text === '') {
                  handleResponseChange(question.id, '');
                } else {
                  // For interviewer ID question, limit to 5 digits
                  if (isInterviewerIdQuestion) {
                    // Remove any non-numeric characters
                    const numericText = text.replace(/[^0-9]/g, '');
                    // Limit to 5 digits
                    if (numericText.length <= 5) {
                      const numValue = parseInt(numericText, 10);
                      if (!isNaN(numValue) && isFinite(numValue)) {
                        handleResponseChange(question.id, numValue);
                      } else if (numericText === '') {
                        handleResponseChange(question.id, '');
                      }
                    }
                    // If longer than 5 digits, don't update (effectively blocks input)
                  } else {
                    const numValue = parseFloat(text);
                    if (!isNaN(numValue) && isFinite(numValue)) {
                      handleResponseChange(question.id, numValue);
                    }
                  }
                }
              }}
              placeholder={isInterviewerIdQuestion ? "Enter Interviewer ID (max 5 digits)..." : "Enter a number..."}
              keyboardType="numeric"
              maxLength={isInterviewerIdQuestion ? 5 : undefined}
              editable={!didNotAnswer || !isPhoneQuestion}
              style={[
                styles.textInput,
                didNotAnswer && isPhoneQuestion && styles.disabledInput
              ]}
            />
            {isPhoneQuestion && (
              <View style={styles.checkboxContainer}>
                <Checkbox
                  status={didNotAnswer ? 'checked' : 'unchecked'}
                  onPress={() => {
                    if (didNotAnswer) {
                      handleResponseChange(question.id, '');
                    } else {
                      handleResponseChange(question.id, 0);
                    }
                  }}
                />
                <Text style={styles.checkboxLabel}>
                  {getDisplayText('refused to share phone number {নম্বর দিতে চাননি}')}
                </Text>
              </View>
            )}
          </View>
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
              
              // Get party logo if applicable (exclude for Question 12)
              const partyLogo = getPartyLogo(optionText, question.text);
              
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
                            // "Others" can now be combined with other options (if multi-select is allowed)
                            // Only remove "None" if it exists (keep "None" exclusive)
                            if (noneOptionValue && currentAnswers.includes(noneOptionValue)) {
                              currentAnswers = currentAnswers.filter((a: string) => a !== noneOptionValue);
                            }
                            // Add "Others" to existing selections (allow combination)
                            if (!currentAnswers.includes(optionValue)) {
                              // Check if we've reached the maximum selections limit
                              if (maxSelections && currentAnswers.length >= maxSelections) {
                                showSnackbar(`Maximum ${maxSelections} selection${maxSelections > 1 ? 's' : ''} allowed`);
                                return;
                              }
                              // Add to end to preserve selection order (order in which options were first selected)
                              currentAnswers.push(optionValue);
                            }
                          } else {
                            // If any other option is selected, remove "None" if it exists (keep "None" exclusive)
                            // But allow "Others" to remain (can be combined with other options)
                            if (noneOptionValue && currentAnswers.includes(noneOptionValue)) {
                              currentAnswers = currentAnswers.filter((a: string) => a !== noneOptionValue);
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
                  <View style={styles.optionContentContainer}>
                    <Text style={styles.optionText} numberOfLines={0}>{getDisplayText(optionText)}</Text>
                    {/* Party logo after text */}
                    {partyLogo && (
                      <Image 
                        source={{ uri: partyLogo }} 
                        style={styles.partyLogo}
                        resizeMode="contain"
                        onError={(error) => {
                          console.error('❌ React Native - Multiple Choice - Logo failed to load:', partyLogo, error);
                        }}
                        onLoad={() => {
                        }}
                      />
                    )}
                  </View>
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

      case 'ac_searchable_dropdown':
        return renderACSearchableDropdown(question);

      case 'single_choice':
      case 'single_select':
        // Check if this is AC selection question with assigned ACs (use regular radio buttons)
        if (question.isACSelection && !question.isSearchable) {
          // Use regular single_choice rendering for assigned ACs
        }
        
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
              
              // Get party logo if applicable (exclude for Question 12)
              const partyLogo = getPartyLogo(option.text, question.text);
              
              return (
                <View key={option.id || index} style={styles.optionItem}>
                  <RadioButton
                    value={option.value}
                    status={currentResponse === option.value ? 'checked' : 'unchecked'}
                    onPress={() => handleResponseChange(question.id, option.value)}
                  />
                  <View style={styles.optionContentContainer}>
                    <Text style={styles.optionText} numberOfLines={0}>{getDisplayText(option.text)}</Text>
                    {/* Party logo after text */}
                    {partyLogo && (
                      <Image 
                        source={{ uri: partyLogo }} 
                        style={styles.partyLogo}
                        resizeMode="contain"
                        onError={(error) => {
                          console.error('❌ React Native - Single Choice - Logo failed to load:', partyLogo, error);
                        }}
                        onLoad={() => {
                        }}
                      />
                    )}
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
                    return {
                      text: getDisplayText(option.text),
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
                      <Text style={styles.ratingLabel}>{getDisplayText(label)}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {(minLabel || maxLabel) && (
              <View style={styles.ratingLabelsRow}>
                <View>
                  <Text style={styles.ratingScaleLabel}>{getDisplayText(minLabel)}</Text>
                </View>
                <View>
                  <Text style={styles.ratingScaleLabel}>{getDisplayText(maxLabel)}</Text>
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
              <View style={styles.optionContentContainer}>
                <Text style={styles.optionText}>Yes</Text>
              </View>
            </View>
            <View style={styles.optionItem}>
              <RadioButton
                value="no"
                status={currentResponse === 'no' ? 'checked' : 'unchecked'}
                onPress={() => handleResponseChange(question.id, 'no')}
              />
              <View style={styles.optionContentContainer}>
                <Text style={styles.optionText}>No</Text>
              </View>
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
            {/* Round Number Selection */}
            <View style={[styles.pollingStationSection, showRoundDropdown && { zIndex: 1002 }]}>
              <Text style={styles.pollingStationLabel}>Select Round Number *</Text>
              {loadingRoundNumbers ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : availableRoundNumbers.length === 0 ? (
                <Text style={styles.pollingStationError}>No round numbers available. Please select an AC first.</Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowRoundDropdown(true)}
                  >
                    <Text style={[
                      styles.dropdownButtonText,
                      !selectedPollingStation.roundNumber && styles.dropdownPlaceholder
                    ]}>
                      {selectedPollingStation.roundNumber ? `Round ${selectedPollingStation.roundNumber}` : 'Select a round number...'}
                    </Text>
                    <Text style={styles.dropdownArrow}>▼</Text>
                  </TouchableOpacity>
                  
                  {/* Round Number Selection Modal - Bottom Sheet */}
                  <Modal
                    visible={showRoundDropdown}
                    transparent={true}
                    animationType="slide"
                    onRequestClose={() => setShowRoundDropdown(false)}
                  >
                    <View style={styles.modalBackdrop}>
                      <TouchableOpacity
                        style={styles.modalBackdropTouchable}
                        activeOpacity={1}
                        onPress={() => setShowRoundDropdown(false)}
                      />
                      <View style={styles.bottomSheetContainer}>
                        <View style={styles.bottomSheetHeader}>
                          <Text style={styles.bottomSheetTitle}>Select Round Number</Text>
                          <TouchableOpacity onPress={() => setShowRoundDropdown(false)}>
                            <Text style={styles.bottomSheetClose}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <ScrollView 
                          style={styles.bottomSheetContent}
                          contentContainerStyle={styles.bottomSheetContentInner}
                          showsVerticalScrollIndicator={true}
                          keyboardShouldPersistTaps="handled"
                        >
                          {availableRoundNumbers.map((round, index) => (
                            <TouchableOpacity
                              key={`round-${index}`}
                              activeOpacity={0.7}
                              style={[
                                styles.bottomSheetItem,
                                selectedPollingStation.roundNumber === round && styles.bottomSheetItemSelected
                              ]}
                              onPress={() => {
                                handleResponseChange('polling-station-round', round);
                                setShowRoundDropdown(false);
                              }}
                            >
                              <Text style={[
                                styles.bottomSheetItemText,
                                selectedPollingStation.roundNumber === round && styles.bottomSheetItemTextSelected
                              ]}>
                                Round {round}
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

            {/* Group Selection - Only show if round number is selected */}
            {selectedPollingStation.roundNumber && (
            <View style={[styles.pollingStationSection, showGroupDropdown && { zIndex: 1001 }]}>
              <Text style={styles.pollingStationLabel}>Select Group *</Text>
              {loadingGroups ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : availableGroups.length === 0 ? (
                  <Text style={styles.pollingStationError}>No groups available for this round. Please select a different round.</Text>
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
            )}

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

            {/* Geofencing Error Display - Only show if booster is DISABLED (geofencing enforced when booster is OFF) */}
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
    const loadingTexts = isSubmitting
      ? [
          'Saving your response...',
          'Uploading your interview...',
          'Finalizing submission...',
          'Almost done...',
        ]
      : [
          'Preparing your interview...',
          'Loading survey questions...',
          'Setting up the interface...',
          'Almost ready...',
        ];

    const rotateInterpolate = rotationAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    const pulseScale = pulseAnimation;

    const loadingBarWidth = loadingAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <View style={styles.loadingContent}>
          {/* Animated Logo/Icon */}
          <Animated.View
            style={[
              styles.loadingLogoContainer,
              {
                transform: [
                  { scale: pulseScale },
                ],
              },
            ]}
          >
            <View style={styles.loadingLogoCircle}>
              <Animated.View
                style={[
                  styles.loadingLogoInner,
                  {
                    transform: [{ rotate: rotateInterpolate }],
                  },
                ]}
              >
                <Image
                  source={require('../../assets/icon.png')}
                  style={styles.loadingLogoIcon}
                  resizeMode="contain"
                />
              </Animated.View>
      </View>
          </Animated.View>

          {/* Loading Text */}
          <Text style={styles.loadingTitleText}>
            {loadingTexts[loadingTextIndex]}
          </Text>

          {/* Animated Dots */}
          <View style={styles.loadingDotsContainer}>
            {[0, 1, 2].map((index) => {
              const dotDelay = index * 0.2;
              const dotOpacity = pulseAnimation.interpolate({
                inputRange: [1, 1.2],
                outputRange: [0.3, 0.9],
              });

              return (
                <Animated.View
                  key={index}
                  style={[
                    styles.loadingDot,
                    {
                      opacity: dotOpacity,
                      transform: [
                        {
                          scale: pulseAnimation.interpolate({
                            inputRange: [1, 1.2],
                            outputRange: [1, 1.2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Subtle Progress Indicator */}
          <View style={styles.loadingProgressContainer}>
            <View style={styles.loadingProgressTrack}>
              <Animated.View
                style={[
                  styles.loadingProgressBar,
                  {
                    width: loadingBarWidth,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // If interview hasn't started successfully, show error and allow navigation back
  if (!isInterviewActive || !currentQuestion) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>
          {!isInterviewActive ? 'Interview not started' : 'No questions available'}
        </Text>
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
            {/* Language Selector and Call Status Container - Vertical layout for CATI */}
            {isCatiMode ? (
              <View style={styles.catiLanguageAndStatusContainer}>
                {/* Language Selector */}
                {detectAvailableLanguages && Array.isArray(detectAvailableLanguages) && detectAvailableLanguages.length > 1 && (
                  <>
                    <View ref={languageDropdownRef} collapsable={false}>
                      <Pressable
                        onPress={() => {
                          setLanguageMenuVisible(true);
                          // Reset animations before starting
                          languageDropdownAnimation.setValue(0);
                          languageDropdownOpacity.setValue(0);
                          // Animate dropdown opening
                          Animated.parallel([
                            Animated.timing(languageDropdownAnimation, {
                              toValue: 1,
                              duration: 200,
                              useNativeDriver: true,
                            }),
                            Animated.timing(languageDropdownOpacity, {
                              toValue: 1,
                              duration: 200,
                              useNativeDriver: true,
                            }),
                          ]).start();
                        }}
                        style={styles.translationToggleCompact}
                      >
                        <Text style={styles.translationToggleLabelCompact}>🌐</Text>
                        <Text style={[styles.translationToggleLabelCompact, { marginLeft: 4, fontSize: 12 }]}>
                          {detectAvailableLanguages[selectedLanguageIndex] || 'Language 1'}
                        </Text>
                        <Text style={[styles.translationToggleLabelCompact, { marginLeft: 4, fontSize: 10 }]}>▼</Text>
                      </Pressable>
                    </View>

                    {/* Custom Dropdown Modal */}
                    <Modal
                      visible={languageMenuVisible}
                      transparent={true}
                      animationType="none"
                      onRequestClose={() => {
                        handleCloseLanguageDropdown();
                      }}
                    >
                      <View style={styles.languageDropdownBackdrop}>
                        <Pressable
                          style={StyleSheet.absoluteFill}
                          onPress={() => {
                            handleCloseLanguageDropdown();
                          }}
                        />
                        <Animated.View
                          style={[
                            styles.languageDropdownContainer,
                            {
                              opacity: languageDropdownOpacity,
                              transform: [
                                {
                                  translateY: languageDropdownAnimation.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-10, 0],
                                  }),
                                },
                                {
                                  scale: languageDropdownAnimation.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.95, 1],
                                  }),
                                },
                              ],
                            },
                          ]}
                        >
                          <FlatList
                            data={detectAvailableLanguages}
                            keyExtractor={(_, index) => `lang-${index}`}
                            renderItem={({ item, index }) => (
                              <Pressable
                                onPress={() => {
                                  setSelectedLanguageIndex(index);
                                  handleCloseLanguageDropdown();
                                }}
                                style={({ pressed }) => [
                                  styles.languageDropdownItem,
                                  selectedLanguageIndex === index && styles.languageDropdownItemSelected,
                                  pressed && styles.languageDropdownItemPressed,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.languageDropdownItemText,
                                    selectedLanguageIndex === index && styles.languageDropdownItemTextSelected,
                                  ]}
                                >
                                  {item || `Language ${index + 1}`}
                                </Text>
                                {selectedLanguageIndex === index && (
                                  <Text style={styles.languageDropdownCheckmark}>✓</Text>
                                )}
                              </Pressable>
                            )}
                            ItemSeparatorComponent={() => <View style={styles.languageDropdownSeparator} />}
                          />
                        </Animated.View>
                      </View>
                    </Modal>
                  </>
                )}
                
                {/* CATI Call Status - Below language dropdown */}
                <View style={styles.callStatusContainer}>
                  {/* Show loading animation when call is processing (idle or calling) */}
                  {(callStatus === 'idle' || callStatus === 'calling' || !callStatus) && (
                    <View style={styles.callStatusIndicator}>
                      <ActivityIndicator size="small" color="#2563eb" />
                      <Text style={styles.callStatusText}>Processing call...</Text>
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
                </View>
              </View>
            ) : (
              /* Language Selector - Horizontal layout for CAPI */
              detectAvailableLanguages && Array.isArray(detectAvailableLanguages) && detectAvailableLanguages.length > 1 && (
                <>
                  <View ref={languageDropdownRef} collapsable={false}>
                    <Pressable
                      onPress={() => {
                        setLanguageMenuVisible(true);
                        // Reset animations before starting
                        languageDropdownAnimation.setValue(0);
                        languageDropdownOpacity.setValue(0);
                        // Animate dropdown opening
                        Animated.parallel([
                          Animated.timing(languageDropdownAnimation, {
                            toValue: 1,
                            duration: 200,
                            useNativeDriver: true,
                          }),
                          Animated.timing(languageDropdownOpacity, {
                            toValue: 1,
                            duration: 200,
                            useNativeDriver: true,
                          }),
                        ]).start();
                      }}
                      style={styles.translationToggleCompact}
                    >
                      <Text style={styles.translationToggleLabelCompact}>🌐</Text>
                      <Text style={[styles.translationToggleLabelCompact, { marginLeft: 4, fontSize: 12 }]}>
                        {detectAvailableLanguages[selectedLanguageIndex] || 'Language 1'}
                      </Text>
                      <Text style={[styles.translationToggleLabelCompact, { marginLeft: 4, fontSize: 10 }]}>▼</Text>
                    </Pressable>
                  </View>

                  {/* Custom Dropdown Modal */}
                  <Modal
                    visible={languageMenuVisible}
                    transparent={true}
                    animationType="none"
                    onRequestClose={() => {
                      handleCloseLanguageDropdown();
                    }}
                  >
                    <View style={styles.languageDropdownBackdrop}>
                      <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={() => {
                          handleCloseLanguageDropdown();
                        }}
                      />
                      <Animated.View
                        style={[
                          styles.languageDropdownContainer,
                          {
                            opacity: languageDropdownOpacity,
                            transform: [
                              {
                                translateY: languageDropdownAnimation.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [-10, 0],
                                }),
                              },
                              {
                                scale: languageDropdownAnimation.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.95, 1],
                                }),
                              },
                            ],
                          },
                        ]}
                      >
                        <FlatList
                          data={detectAvailableLanguages}
                          keyExtractor={(_, index) => `lang-${index}`}
                          renderItem={({ item, index }) => (
                            <Pressable
                              onPress={() => {
                                setSelectedLanguageIndex(index);
                                handleCloseLanguageDropdown();
                              }}
                              style={({ pressed }) => [
                                styles.languageDropdownItem,
                                selectedLanguageIndex === index && styles.languageDropdownItemSelected,
                                pressed && styles.languageDropdownItemPressed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.languageDropdownItemText,
                                  selectedLanguageIndex === index && styles.languageDropdownItemTextSelected,
                                ]}
                              >
                                {item || `Language ${index + 1}`}
                              </Text>
                              {selectedLanguageIndex === index && (
                                <Text style={styles.languageDropdownCheckmark}>✓</Text>
                              )}
                            </Pressable>
                          )}
                          ItemSeparatorComponent={() => <View style={styles.languageDropdownSeparator} />}
                        />
                      </Animated.View>
                    </View>
                  </Modal>
                </>
              )
            )}
            
            {/* CATI Respondent Info - Name and AC only (no phone) */}
            {isCatiMode && catiRespondent && (
              <View style={styles.respondentInfoContainer}>
                <Text style={styles.respondentName}>
                  {catiRespondent.name ? catiRespondent.name.split(' ')[0] : ''}
                </Text>
                <Text style={styles.respondentAC}>
                  {selectedAC || acFromSessionData || catiRespondent.ac || catiRespondent.assemblyConstituency || catiRespondent.acName || catiRespondent.assemblyConstituencyName || 'N/A'}
                </Text>
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
            Question {currentQuestionIndex + 1} of {maxPossibleQuestions || visibleQuestions.length}
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
            {/* Show loading/blocking overlay if recording hasn't started and confirmed */}
            {((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
             !isRecordingReady && audioPermission !== false && (
              <View style={styles.blockingOverlay}>
                <View style={styles.blockingContent}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={styles.blockingText}>Starting audio recording...</Text>
                  <Text style={styles.blockingSubtext}>Please wait - interview will begin once recording is ready</Text>
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
                {(() => {
                  // Get question number - use custom questionNumber if available, otherwise generate from position
                  let questionNumber = 'questionNumber' in currentQuestion ? (currentQuestion as any).questionNumber : undefined;
                  
                  // Special handling for call status, interviewer ID, supervisor ID, consent form and AC selection
                  if (currentQuestion.id === 'call-status') {
                    questionNumber = '0.001';
                  } else if (currentQuestion.id === 'interviewer-id') {
                    questionNumber = '0.002';
                  } else if (currentQuestion.id === 'supervisor-id') {
                    questionNumber = '0.003';
                  } else if (currentQuestion.id === 'consent-form') {
                    questionNumber = '0.0';
                  } else if (currentQuestion.id === 'ac-selection') {
                    questionNumber = '0.1';
                  } else if (!questionNumber && currentQuestion.sectionIndex !== undefined && currentQuestion.questionIndex !== undefined) {
                    questionNumber = `${currentQuestion.sectionIndex + 1}.${currentQuestion.questionIndex + 1}`;
                  } else if (!questionNumber) {
                    // Fallback: find question in allQuestions to get position
                    const questionPos = allQuestions.findIndex(q => q.id === currentQuestion.id);
                    if (questionPos !== -1) {
                      // Try to find section and question index
                      let sectionIdx = 0;
                      let qIdx = 0;
                      let count = 0;
                      if (survey && survey.sections) {
                        for (let s = 0; s < survey.sections.length; s++) {
                          for (let q = 0; q < survey.sections[s].questions.length; q++) {
                            if (count === questionPos) {
                              sectionIdx = s;
                              qIdx = q;
                              break;
                            }
                            count++;
                          }
                          if (count === questionPos) break;
                        }
                        questionNumber = `${sectionIdx + 1}.${qIdx + 1}`;
                      } else {
                        questionNumber = `${questionPos + 1}`;
                      }
                    }
                  }
                  return questionNumber ? `Q${questionNumber}: ` : '';
                })()}
                {getDisplayText(currentQuestion.text)}
                {/* Show MP/MLA name for Question 16.a and 16.b - check by question text/number regardless of survey */}
                {(() => {
                  if (!currentQuestion) return null;
                  
                  const questionText = (currentQuestion.text || '').toLowerCase();
                  const questionNumber = 'questionNumber' in currentQuestion ? (currentQuestion as any).questionNumber : '';
                  const questionId = currentQuestion.id || '';
                  
                  // Check if this is Question 16.a (MP) or 16.b (MLA) by multiple methods
                  // Prioritize question number over text to avoid conflicts
                  // Check question number first (most reliable)
                  const hasQuestionNumber16a = questionNumber === '16.a' || 
                                               questionNumber === '16a' ||
                                               questionNumber.includes('16.a') || 
                                               questionNumber.includes('16a');
                  const hasQuestionNumber16b = questionNumber === '16.b' || 
                                               questionNumber === '16b' ||
                                               questionNumber.includes('16.b') || 
                                               questionNumber.includes('16b');
                  
                  // If question number matches, use that (most reliable)
                  if (hasQuestionNumber16a) {
                    // This is definitely 16.a - show MP name
                    if (mpName) {
                      return <Text style={{ color: '#2563eb', fontWeight: '600', marginLeft: 8 }}>: {mpName}</Text>;
                    }
                    if (isLoadingMPMLA) {
                      return <Text style={{ color: '#6b7280', marginLeft: 8 }}> (Loading...)</Text>;
                    }
                    return null;
                  }
                  
                  if (hasQuestionNumber16b) {
                    // This is definitely 16.b - show MLA name
                    if (mlaName) {
                      return <Text style={{ color: '#2563eb', fontWeight: '600', marginLeft: 8 }}>: {mlaName}</Text>;
                    }
                    if (isLoadingMPMLA) {
                      return <Text style={{ color: '#6b7280', marginLeft: 8 }}> (Loading...)</Text>;
                    }
                    return null;
                  }
                  
                  // Fallback to text matching only if question number doesn't match
                  // Check 16.b first to avoid conflicts
                  const isQuestion16b = questionId.includes('16b') ||
                                       questionText.includes('satisfaction with mla') || 
                                       questionText.includes('16.b') ||
                                       questionText.includes('16b') ||
                                       (questionText.includes('mla') && questionText.includes('satisfaction') && !questionText.includes('mp')) ||
                                       (questionText.includes('current mla') || questionText.includes('your current mla')) ||
                                       (questionText.includes('work done by') && questionText.includes('mla') && !questionText.includes('mp'));
                  
                  // Only check for 16.a if it's not 16.b
                  const isQuestion16a = !isQuestion16b && (
                                       questionId.includes('16a') ||
                                       questionText.includes('satisfaction with mp') || 
                                       questionText.includes('16.a') ||
                                       questionText.includes('16a') ||
                                       (questionText.includes('mp') && questionText.includes('satisfaction') && !questionText.includes('mla')) ||
                                       (questionText.includes('current mp') || questionText.includes('your current mp')) ||
                                       (questionText.includes('work done by') && questionText.includes('mp') && !questionText.includes('mla')));
                  
                  
                  // Check 16.b first (text fallback), then 16.a
                  if (isQuestion16b && mlaName) {
                    return <Text style={{ color: '#2563eb', fontWeight: '600', marginLeft: 8 }}>: {mlaName}</Text>;
                  }
                  if (isQuestion16a && mpName) {
                    return <Text style={{ color: '#2563eb', fontWeight: '600', marginLeft: 8 }}>: {mpName}</Text>;
                  }
                  if ((isQuestion16a || isQuestion16b) && isLoadingMPMLA) {
                    return <Text style={{ color: '#6b7280', marginLeft: 8 }}> (Loading...)</Text>;
                  }
                  // MP/MLA names will be displayed when available
                  return null;
                })()}
                {/* Show AC name for registered voter question - only for survey "68fd1915d41841da463f0d46" */}
                {(() => {
                  if (!currentQuestion) return null;
                  
                  // Only for target survey
                  const isTargetSurvey = survey && (survey._id === '68fd1915d41841da463f0d46' || survey.id === '68fd1915d41841da463f0d46');
                  if (!isTargetSurvey) return null;
                  
                  const questionText = (currentQuestion.text || '').toLowerCase();
                  const questionId = currentQuestion.id || '';
                  
                  // Check if this is the registered voter question
                  const isRegisteredVoterQuestion = questionText.includes('are you a registered voter') ||
                                                    questionText.includes('registered voter') ||
                                                    questionText.includes('নিবন্ধিত ভোটার') ||
                                                    questionText.includes('বিধানসভা কেন্দ্র') ||
                                                    (questionText.includes('registered') && questionText.includes('voter') && questionText.includes('assembly'));
                  
                  if (isRegisteredVoterQuestion) {
                    // Get AC name: for CAPI use selectedAC, for CATI use acFromSessionData
                    const acName = selectedAC || acFromSessionData;
                    if (acName) {
                      return <Text style={{ color: '#2563eb', fontWeight: '600', marginLeft: 8 }}>: {acName}</Text>;
                    }
                    return null;
                  }
                  return null;
                })()}
                {currentQuestion.required && <Text style={styles.requiredAsterisk}> *</Text>}
                {currentQuestion.type === 'multiple_choice' && currentQuestion.settings?.allowMultiple && (
                  <Text style={styles.multipleSelectionTag}> Multiple</Text>
                )}
              </Text>
            </View>
            {currentQuestion.description && (
              <Text style={styles.questionDescription}>
                {getDisplayText(currentQuestion.description)}
              </Text>
            )}
            
            <View style={[
              styles.questionContent,
              (!isRecordingReady && 
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
      <View style={[styles.navigation, { paddingBottom: Math.max(16, insets.bottom) }]}>
        <Button
          mode="outlined"
          onPress={goToPreviousQuestion}
          disabled={currentQuestionIndex === 0 || 
                   (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                    !isRecordingReady)}
          style={styles.navButton}
        >
          Previous
        </Button>
        
        {(currentQuestionIndex === visibleQuestions.length - 1 || shouldShowSubmitForCallStatus || shouldShowAbandonForConsent || (isConsentDisagreed && currentQuestion?.id === 'consent-form')) ? (
          <Button
            mode="contained"
            onPress={() => {
              // If call status is not connected, abandon instead of complete
              if (shouldShowSubmitForCallStatus && callStatusResponse) {
                abandonInterview();
              } 
              // If consent form is "No", abandon instead of complete
              else if ((shouldShowAbandonForConsent || (isConsentDisagreed && currentQuestion?.id === 'consent-form')) && isConsentDisagreed) {
                abandonInterview('consent_refused');
              } 
              else {
                completeInterview();
              }
            }}
            style={[
              (shouldShowSubmitForCallStatus || shouldShowAbandonForConsent || (isConsentDisagreed && currentQuestion?.id === 'consent-form')) ? styles.abandonButton : styles.completeButton,
              (targetAudienceErrors.size > 0 || 
               (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                !isRecordingReady)) && styles.disabledButton
            ]}
            disabled={targetAudienceErrors.size > 0 || 
                     (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                      !isRecordingReady)}
            loading={isLoading}
          >
            {(shouldShowSubmitForCallStatus || shouldShowAbandonForConsent || (isConsentDisagreed && currentQuestion?.id === 'consent-form')) ? 'Abandon' : 'Submit'}
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
               // Check if polling station is not selected in CAPI mode
               (!isCatiMode && currentQuestion && 
                (currentQuestion.id === 'polling-station-selection' ||
                 currentQuestion.type === 'polling_station' ||
                 (currentQuestion as any)?.isPollingStationSelection ||
                 (currentQuestion.text && currentQuestion.text.toLowerCase().includes('select polling station'))) &&
                (!selectedPollingStation.groupName || !selectedPollingStation.stationName)) ||
               // Check if call status is not connected in CATI mode
               (isCatiMode && currentQuestion && currentQuestion.id === 'call-status' && callStatusResponse !== 'call_connected') ||
               (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                !isRecordingReady)) && styles.disabledButton
            ]}
            disabled={targetAudienceErrors.has(visibleQuestions[currentQuestionIndex]?.id) || 
                     (visibleQuestions[currentQuestionIndex]?.required && 
                      !responses[visibleQuestions[currentQuestionIndex]?.id] &&
                      // For polling station question, check if both group and station are selected
                      !((currentQuestion as any)?.isPollingStationSelection && 
                        selectedPollingStation.groupName && selectedPollingStation.stationName)) ||
                     (geofencingError && (currentQuestion as any)?.isPollingStationSelection && locationControlBooster) ||
                     // Check if polling station is not selected in CAPI mode
                     (!isCatiMode && currentQuestion && 
                      (currentQuestion.id === 'polling-station-selection' ||
                       currentQuestion.type === 'polling_station' ||
                       (currentQuestion as any)?.isPollingStationSelection ||
                       (currentQuestion.text && currentQuestion.text.toLowerCase().includes('select polling station'))) &&
                      (!selectedPollingStation.groupName || !selectedPollingStation.stationName)) ||
                     // Check if call status is not connected in CATI mode
                     (isCatiMode && currentQuestion && currentQuestion.id === 'call-status' && callStatusResponse !== 'call_connected') ||
                     (((survey.mode === 'capi') || (survey.mode === 'multi_mode' && survey.assignedMode === 'capi')) && 
                      !isRecordingReady)}
          >
            Next
          </Button>
        )}
      </View>

      {/* Abandon Modal (CAPI) */}
      {showAbandonConfirm && !isCatiMode && (
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
            <Text style={styles.modalTitle}>Abandon Interview</Text>
            <Text style={styles.modalLabel}>
              Please select a reason for abandoning this interview:
            </Text>
            
            <View style={styles.radioGroup}>
              <RadioButton.Group
                onValueChange={setAbandonReason}
                value={abandonReason}
              >
                <RadioButton.Item label="Respondent Not Available" value="respondent_not_available" />
                <RadioButton.Item label="Respondent Refused" value="respondent_refused" />
                <RadioButton.Item label="Location Issue" value="location_issue" />
                <RadioButton.Item label="Technical Issue" value="technical_issue" />
                <RadioButton.Item label="Language Barrier" value="language_barrier" />
                <RadioButton.Item label="Respondent Busy" value="respondent_busy" />
                <RadioButton.Item label="Other" value="other" />
              </RadioButton.Group>
            </View>
            
            {abandonReason === 'other' && (
              <View style={styles.datePickerContainer}>
                <Text style={styles.modalLabel}>Please specify:</Text>
                <TextInput
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  placeholder="Enter custom reason..."
                  value={abandonNotes}
                  onChangeText={setAbandonNotes}
                  style={styles.notesInput}
                />
              </View>
            )}
            
            {abandonReason !== 'other' && (
              <View>
                <Text style={styles.modalLabel}>Additional Notes (Optional):</Text>
                <TextInput
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  placeholder="Add any additional notes..."
                  value={abandonNotes}
                  onChangeText={setAbandonNotes}
                  style={styles.notesInput}
                />
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <Button
                mode="outlined"
                onPress={() => {
                  setShowAbandonConfirm(false);
                  setAbandonReason('');
                  setAbandonNotes('');
                }}
                style={styles.modalButton}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={() => {
                  if (!abandonReason) {
                    showSnackbar('Please select a reason for abandoning');
                    return;
                  }
                  if (abandonReason === 'other' && !abandonNotes.trim()) {
                    showSnackbar('Please specify the custom reason');
                    return;
                  }
                  setShowAbandonConfirm(false);
                  abandonInterview();
                }}
                disabled={!abandonReason || (abandonReason === 'other' && !abandonNotes.trim())}
                style={[styles.modalButton, { backgroundColor: '#ef4444' }]}
              >
                Submit
              </Button>
            </View>
          </ScrollView>
        </View>
      )}

      {/* CATI Abandon Modal */}
      {showAbandonModal && (
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
            <Text style={styles.modalTitle}>Abandon Interview</Text>
            {callStatus === 'failed' && (
              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>
                  <Text style={styles.warningBold}>Call Failed:</Text> You can abandon this interview without selecting a reason, or optionally provide one below.
                </Text>
              </View>
            )}
            
            <Text style={styles.modalLabel}>
              {callStatus === 'failed' 
                ? 'Optionally select a reason for abandoning this interview:'
                : 'Please select a reason for abandoning this interview:'}
            </Text>
            
            <View style={styles.radioGroup}>
              <RadioButton.Group
                onValueChange={setAbandonReason}
                value={abandonReason}
              >
                <RadioButton.Item label="Call Later" value="call_later" />
                <RadioButton.Item label="Not Interested" value="not_interested" />
                <RadioButton.Item label="Busy" value="busy" />
                <RadioButton.Item label="No Answer" value="no_answer" />
                <RadioButton.Item label="Switched Off" value="switched_off" />
                <RadioButton.Item label="Not Reachable" value="not_reachable" />
                <RadioButton.Item label="Number Does Not Exist" value="does_not_exist" />
                <RadioButton.Item label="Call Rejected" value="rejected" />
                <RadioButton.Item label="Technical Issue" value="technical_issue" />
                <RadioButton.Item label="Other" value="other" />
              </RadioButton.Group>
            </View>
                
            {abandonReason === 'call_later' && (
              <View style={styles.datePickerContainer}>
                <Text style={styles.modalLabel}>Schedule Call For:</Text>
                <TextInput
                  mode="outlined"
                  placeholder="YYYY-MM-DD HH:MM"
                  value={callLaterDate}
                  onChangeText={setCallLaterDate}
                  style={styles.dateInput}
                />
              </View>
            )}
            
            <Text style={styles.modalLabel}>Additional Notes (Optional):</Text>
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
                disabled={
                  (callStatus !== 'failed' && !abandonReason) ||
                  (abandonReason === 'call_later' && !callLaterDate)
                }
                style={[styles.modalButton, { backgroundColor: '#ef4444' }]}
              >
                {callStatus === 'failed' ? 'Abandon (No Reason Required)' : 'Submit'}
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
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 400,
    flex: 1,
  },
  loadingLogoContainer: {
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f4f8',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  loadingLogoInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  loadingLogoIcon: {
    width: '100%',
    height: '100%',
  },
  loadingTitleText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  loadingDotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 8,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#001D48',
  },
  loadingProgressContainer: {
    width: '100%',
    maxWidth: 200,
    alignItems: 'center',
  },
  loadingProgressTrack: {
    width: '100%',
    height: 2,
    backgroundColor: '#e5e7eb',
    borderRadius: 1,
    overflow: 'hidden',
  },
  loadingProgressBar: {
    height: '100%',
    backgroundColor: '#001D48',
    borderRadius: 1,
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
  translationToggleCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    minHeight: 32,
  },
  translationToggleLabelCompact: {
    fontSize: 14,
    marginRight: 4,
    color: '#374151',
  },
  languageDropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 50 : 60,
    paddingLeft: 16,
  },
  languageDropdownContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    minWidth: 180,
    maxWidth: 250,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  languageDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  languageDropdownItemSelected: {
    backgroundColor: '#eff6ff',
  },
  languageDropdownItemPressed: {
    backgroundColor: '#dbeafe',
  },
  languageDropdownItemText: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  languageDropdownItemTextSelected: {
    color: '#2563eb',
    fontWeight: '600',
  },
  languageDropdownCheckmark: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  languageDropdownSeparator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 8,
  },
  translationToggleSwitch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
  translationToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  multipleSelectionTag: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
    overflow: 'hidden',
  },
  translationToggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e40af',
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
  phoneNumberContainer: {
    marginTop: 8,
  },
  disabledInput: {
    backgroundColor: '#f3f4f6',
    opacity: 0.6,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#374151',
    marginLeft: 8,
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
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginVertical: 2,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    minHeight: 40,
  },
  optionContentContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    gap: 8,
  },
  optionText: {
    fontSize: 16,
    color: '#374151',
    flex: 1,
    flexShrink: 1,
    lineHeight: 22,
    paddingRight: 4,
  },
  partyLogo: {
    width: 28,
    height: 28,
    flexShrink: 0,
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
  catiLanguageAndStatusContainer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginRight: 8,
  },
  callStatusContainer: {
    marginTop: 8, // Add space below language dropdown
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
  respondentInfoContainer: {
    marginTop: 4,
    alignItems: 'flex-start',
  },
  respondentName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 2,
  },
  respondentAC: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  respondentPhone: {
    fontSize: 11,
    color: '#9ca3af',
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
    paddingTop: 16,
    // paddingBottom will be set dynamically based on safe area insets
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
  abandonButton: {
    flex: 0.45,
    backgroundColor: '#ef4444',
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
  warningContainer: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fbbf24',
    borderRadius: 8,
  },
  warningText: {
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  warningBold: {
    fontWeight: '600',
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
  bottomSheetItemSubtext: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  bottomSheetItemSubtextSelected: {
    color: '#3b82f6',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  searchInput: {
    backgroundColor: '#f9fafb',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
  },
  emptyStateContainer: {
    padding: 16,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
});