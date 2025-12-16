import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  TouchableOpacity,
  PanResponder,
  StatusBar,
  Platform,
  AppState,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { fromByteArray } from 'base64-js';
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
import { findGenderResponse, normalizeGenderResponse } from '../utils/genderUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const [playbackRate, setPlaybackRate] = useState(1.0); // Playback speed (1.0 = normal, 0.5 = half, 2.0 = double)
  const sliderRef = useRef<View>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [catiCallDetails, setCatiCallDetails] = useState<any>(null);
  const [catiRecordingUri, setCatiRecordingUri] = useState<string | null>(null);
  const [loadingCatiRecording, setLoadingCatiRecording] = useState(false);
  const [catiAudioSound, setCatiAudioSound] = useState<Audio.Sound | null>(null);
  const [isPlayingCatiAudio, setIsPlayingCatiAudio] = useState(false);
  const [catiAudioPosition, setCatiAudioPosition] = useState(0);
  const [catiAudioDuration, setCatiAudioDuration] = useState(0);
  const [catiPlaybackRate, setCatiPlaybackRate] = useState(1.0);
  const [catiIsSeeking, setCatiIsSeeking] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [responsesSectionExpanded, setResponsesSectionExpanded] = useState(false);
  
  // Use ref to store audio sound to avoid dependency cycles
  const audioSoundRef = useRef<Audio.Sound | null>(null);
  const catiAudioSoundRef = useRef<Audio.Sound | null>(null);
  const catiSliderRef = useRef<View>(null);
  const [catiSliderWidth, setCatiSliderWidth] = useState(0);
  
  // Update ref whenever audioSound state changes
  useEffect(() => {
    audioSoundRef.current = audioSound;
  }, [audioSound]);

  // Update ref whenever catiAudioSound state changes
  useEffect(() => {
    catiAudioSoundRef.current = catiAudioSound;
  }, [catiAudioSound]);

  // Function to stop and cleanup audio completely (using ref to avoid dependency cycles)
  const cleanupAudio = useCallback(async () => {
    const currentAudio = audioSoundRef.current;
    if (currentAudio) {
      try {
        const status = await currentAudio.getStatusAsync();
        if (status.isLoaded) {
          // Stop playback if playing
          if (status.isPlaying) {
            await currentAudio.stopAsync();
          }
          // Unload the sound
          await currentAudio.unloadAsync();
        }
      } catch (error) {
        console.error('Error cleaning up audio:', error);
        // Force unload even if there's an error
        try {
          await currentAudio.unloadAsync();
        } catch (unloadError) {
          console.error('Error force unloading audio:', unloadError);
        }
      }
      audioSoundRef.current = null;
      setAudioSound(null);
      setIsPlaying(false);
      setAudioPosition(0);
      setPlaybackRate(1.0);
    }
  }, []); // Empty dependency array - uses ref instead

  // Function to stop and cleanup CATI audio
  const cleanupCatiAudio = useCallback(async () => {
    const currentAudio = catiAudioSoundRef.current;
    if (currentAudio) {
      try {
        const status = await currentAudio.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await currentAudio.stopAsync();
          }
          await currentAudio.unloadAsync();
        }
      } catch (error) {
        console.error('Error cleaning up CATI audio:', error);
        try {
          await currentAudio.unloadAsync();
        } catch (unloadError) {
          console.error('Error force unloading CATI audio:', unloadError);
        }
      }
      catiAudioSoundRef.current = null;
      setCatiAudioSound(null);
      setIsPlayingCatiAudio(false);
      setCatiAudioPosition(0);
      setCatiPlaybackRate(1.0);
    }
  }, []);

  useEffect(() => {
    if (visible && interview) {
      // Debug: Log interviewer data when modal opens
      console.log('🔍 ResponseDetailsModal - Interview data:', {
        responseId: interview.responseId,
        hasInterviewer: !!interview.interviewer,
        interviewerType: typeof interview.interviewer,
        interviewerIsObject: interview.interviewer && typeof interview.interviewer === 'object',
        interviewerKeys: interview.interviewer ? Object.keys(interview.interviewer) : [],
        interviewerId: interview.interviewer?._id?.toString(),
        interviewerName: interview.interviewer ? `${interview.interviewer.firstName || ''} ${interview.interviewer.lastName || ''}`.trim() : 'null',
        interviewerMemberId: interview.interviewer?.memberId || 'null',
        fullInterviewer: JSON.stringify(interview.interviewer, null, 2)
      });
      
      // Load audio if CAPI interview has audio recording
      // Check for signedUrl first (preferred for S3), then fallback to audioUrl
      const signedUrl = interview.metadata?.audioRecording?.signedUrl || 
                       interview.audioRecording?.signedUrl ||
                       interview.signedUrl;
      const audioUrl = interview.metadata?.audioRecording?.audioUrl || 
                      interview.audioUrl || 
                      interview.audioRecording?.url ||
                      interview.audioRecording?.audioUrl;
      
      // Use signedUrl if available, otherwise use audioUrl
      const audioSource = signedUrl || audioUrl;
      
      if (interview.interviewMode === 'capi' && audioSource) {
        loadAudio(audioSource).catch((error) => {
          // Silently handle error - audio will show "No Recording Found"
          console.error('Audio loading failed:', error);
        });
      }
      
      // Fetch CATI call details if CATI interview
      if (interview.interviewMode === 'cati' && interview.call_id) {
        fetchCatiCallDetails(interview.call_id);
      }
    } else {
      // Stop and cleanup audio when modal closes
      cleanupAudio();
    }

    return () => {
      // Cleanup audio on unmount
      cleanupAudio();
    };
  }, [visible, interview?.responseId]); // Removed cleanupAudio from dependencies

  // Listen to app state changes to stop audio when app goes to background or closes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App is going to background or closing - stop audio immediately
        console.log('🛑 App going to background/inactive - stopping audio');
        cleanupAudio();
        cleanupCatiAudio();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [cleanupAudio, cleanupCatiAudio]);

  // Helper function to format duration
  const formatDuration = (seconds: number): string => {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const fetchCatiCallDetails = async (callId: string) => {
    try {
      const result = await apiService.getCatiCallById(callId);
      if (result.success && result.data) {
        setCatiCallDetails(result.data);
        // Only fetch recording if recordingUrl is explicitly available
        // Don't fetch just based on _id to avoid unnecessary 404 errors
        if (result.data.recordingUrl) {
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
      
      // Use expo-file-system to download the recording directly
      // This is better for React Native than handling blobs
      const token = await AsyncStorage.getItem('authToken');
      if (!token) {
        console.error('No auth token available');
        setLoadingCatiRecording(false);
        return;
      }

      const API_BASE_URL = 'https://convo.convergentview.com';
      const recordingUrl = `${API_BASE_URL}/api/cati/recording/${callId}`;
      
      // Download to a temporary file using legacy API
      const fileUri = `${FileSystem.cacheDirectory}cati_recording_${callId}_${Date.now()}.mp3`;
      
      try {
        const downloadResult = await FileSystem.downloadAsync(
          recordingUrl,
          fileUri,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          }
        );

        if (downloadResult.status === 200) {
          // Load the audio from the downloaded file
          await loadCatiAudio(downloadResult.uri);
        } else {
          console.error('Failed to download recording:', downloadResult.status);
          setLoadingCatiRecording(false);
        }
      } catch (downloadError: any) {
        // If legacy API fails, try using fetch as fallback
        console.log('Legacy downloadAsync failed, trying fetch approach...', downloadError);
        
        const response = await fetch(recordingUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setLoadingCatiRecording(false);
            return;
          }
          throw new Error(`Failed to download: ${response.status}`);
        }

        // Get the arrayBuffer and convert to base64 using base64-js (React Native compatible)
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        // Convert Uint8Array to base64 using base64-js
        const base64 = Buffer.from(uint8Array).toString('base64');
        
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        
        await loadCatiAudio(fileUri);
      }
    } catch (error: any) {
      // Silently handle 404 errors (recording not available) - this is expected
      if (error?.response?.status === 404 || error?.status === 404 || error?.message?.includes('404')) {
        // Recording not available - this is normal, don't log as error
        setLoadingCatiRecording(false);
        return;
      }
      // Only log unexpected errors
      console.error('Error fetching CATI recording:', error);
      setLoadingCatiRecording(false);
    }
  };

  const loadCatiAudio = async (audioUri: string) => {
    try {
      // Clean up existing CATI audio
      if (catiAudioSoundRef.current) {
        try {
          await catiAudioSoundRef.current.unloadAsync();
        } catch (error) {
          console.error('Error unloading existing CATI audio:', error);
        }
        catiAudioSoundRef.current = null;
        setCatiAudioSound(null);
      }

      console.log('Loading CATI audio from URI');

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { 
          shouldPlay: false,
          rate: catiPlaybackRate,
        }
      );

      catiAudioSoundRef.current = sound;
      setCatiAudioSound(sound);
      setCatiRecordingUri(audioUri);

      // Set up status update listener
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && !catiIsSeeking) {
          setCatiAudioPosition(status.positionMillis || 0);
          setCatiAudioDuration(status.durationMillis || 0);
          setIsPlayingCatiAudio(status.isPlaying || false);
          
          if (status.didJustFinish) {
            setIsPlayingCatiAudio(false);
            setCatiAudioPosition(0);
          }
        }
      });

      setLoadingCatiRecording(false);
    } catch (error) {
      console.error('Error loading CATI audio:', error);
      setLoadingCatiRecording(false);
    }
  };

  const playCatiAudio = async () => {
    try {
      if (catiAudioSoundRef.current) {
        await catiAudioSoundRef.current.playAsync();
        setIsPlayingCatiAudio(true);
      }
    } catch (error) {
      console.error('Error playing CATI audio:', error);
    }
  };

  const pauseCatiAudio = async () => {
    try {
      if (catiAudioSoundRef.current) {
        await catiAudioSoundRef.current.pauseAsync();
        setIsPlayingCatiAudio(false);
      }
    } catch (error) {
      console.error('Error pausing CATI audio:', error);
    }
  };

  const formatTime = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // CATI Audio speed control functions
  const increaseCatiSpeed = async () => {
    if (catiPlaybackRate < 4.0) {
      const newRate = Math.min(catiPlaybackRate + 0.25, 4.0);
      setCatiPlaybackRate(newRate);
      if (catiAudioSoundRef.current) {
        try {
          await catiAudioSoundRef.current.setRateAsync(newRate, true);
        } catch (error) {
          console.error('Error setting CATI audio rate:', error);
        }
      }
    }
  };

  const decreaseCatiSpeed = async () => {
    if (catiPlaybackRate > 0.5) {
      const newRate = Math.max(catiPlaybackRate - 0.25, 0.5);
      setCatiPlaybackRate(newRate);
      if (catiAudioSoundRef.current) {
        try {
          await catiAudioSoundRef.current.setRateAsync(newRate, true);
        } catch (error) {
          console.error('Error setting CATI audio rate:', error);
        }
      }
    }
  };

  // CATI Audio seek handler
  const handleCatiSeek = async (positionMillis: number) => {
    if (!catiAudioSoundRef.current || catiAudioDuration === 0) return;
    
    try {
      const clampedPosition = Math.max(0, Math.min(positionMillis, catiAudioDuration));
      await catiAudioSoundRef.current.setPositionAsync(clampedPosition);
      setCatiAudioPosition(clampedPosition);
    } catch (error) {
      console.error('Error seeking CATI audio:', error);
    } finally {
      setCatiIsSeeking(false);
    }
  };

  // CATI Audio slider handler
  const handleCatiSliderPress = (event: any) => {
    if (!catiSliderRef.current || catiSliderWidth === 0 || catiAudioDuration === 0) return;
    
    const { locationX } = event.nativeEvent;
    const percentage = Math.max(0, Math.min(1, locationX / catiSliderWidth));
    const positionMillis = Math.floor(percentage * catiAudioDuration);
    setCatiIsSeeking(true);
    handleCatiSeek(positionMillis);
  };

  const loadAudio = async (audioUrl: string) => {
    try {
      // Clean up existing audio using ref
      if (audioSoundRef.current) {
        try {
          await audioSoundRef.current.unloadAsync();
        } catch (error) {
          console.error('Error unloading existing audio:', error);
        }
        audioSoundRef.current = null;
        setAudioSound(null);
      }

      // Check if we have a signed URL (preferred for S3)
      let fullAudioUrl = audioUrl;
      
      // If it's an S3 key (starts with audio/, documents/, reports/), we need to get a signed URL
      if (audioUrl && (audioUrl.startsWith('audio/') || audioUrl.startsWith('documents/') || audioUrl.startsWith('reports/')) && 
          !audioUrl.startsWith('http')) {
        try {
          // Check if interview has signedUrl already
          const signedUrl = interview.metadata?.audioRecording?.signedUrl || 
                           interview.audioRecording?.signedUrl ||
                           interview.signedUrl;
          
          if (signedUrl) {
            fullAudioUrl = signedUrl;
            console.log('✅ Using provided signed URL for audio');
          } else if (audioUrl) {
            // Fetch signed URL from API only if we have an audioUrl
            console.log('📥 Fetching signed URL for S3 key:', audioUrl);
            try {
              const token = await AsyncStorage.getItem('authToken');
              if (!token) {
                throw new Error('No auth token available');
              }
              const API_BASE_URL = 'https://convo.convergentview.com';
              const response = await fetch(`${API_BASE_URL}/api/survey-responses/audio-signed-url?audioUrl=${encodeURIComponent(audioUrl)}`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });
              
              if (response.ok) {
                const data = await response.json();
                if (data.success && data.signedUrl) {
                  fullAudioUrl = data.signedUrl;
                  console.log('✅ Successfully fetched signed URL for audio');
                } else {
                  console.warn('⚠️ No signed URL in response:', data);
                  throw new Error('No signed URL in response');
                }
              } else {
                const errorText = await response.text();
                console.error('❌ Failed to fetch signed URL:', response.status, errorText);
                throw new Error(`Failed to fetch signed URL: ${response.status}`);
              }
            } catch (fetchError) {
              console.error('❌ Error fetching signed URL:', fetchError);
              throw fetchError; // Re-throw to trigger fallback
            }
          }
        } catch (error) {
          console.error('Error fetching signed URL:', error);
          // Fallback: try to construct URL using production API base URL
          const API_BASE_URL = 'https://convo.convergentview.com';
          fullAudioUrl = `${API_BASE_URL}${audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl}`;
          console.log('Using fallback URL for audio:', fullAudioUrl);
        }
      } else if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
        // If it's a relative URL, prepend the production base URL
        const API_BASE_URL = 'https://convo.convergentview.com';
        fullAudioUrl = `${API_BASE_URL}${audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl}`;
        console.log('Constructed audio URL from relative path:', fullAudioUrl);
      }

      console.log('Loading audio from URL:', fullAudioUrl);

      const { sound } = await Audio.Sound.createAsync(
        { uri: fullAudioUrl },
        { 
          shouldPlay: false,
          rate: playbackRate, // Set initial playback rate
          shouldCorrectPitch: true // Maintain pitch when changing speed
        }
      );

      // Update both state and ref
      audioSoundRef.current = sound;
      setAudioSound(sound);
      
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        setAudioDuration(status.durationMillis || 0);
        // Set initial playback rate
        await sound.setRateAsync(playbackRate, true);
      }

      // Listen to playback status
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && !isSeeking) {
          setIsPlaying(status.isPlaying || false);
          setAudioPosition(status.positionMillis || 0);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setAudioPosition(0);
          }
        }
      });
    } catch (error) {
      console.error('Error loading audio:', error);
      // Don't show error snackbar - just mark as no recording available
      setAudioSound(null);
    }
  };

  const playAudio = async () => {
    try {
      if (!audioSound) {
        // Try to get audio URL from various possible locations
        // Check for signedUrl first (preferred for S3), then fallback to audioUrl
        const signedUrl = interview.metadata?.audioRecording?.signedUrl || 
                         interview.audioRecording?.signedUrl ||
                         interview.signedUrl;
        const audioUrl = interview.metadata?.audioRecording?.audioUrl || 
                        interview.audioUrl || 
                        interview.audioRecording?.url ||
                        interview.audioRecording?.audioUrl;
        // Use signedUrl if available, otherwise use audioUrl
        const audioSource = signedUrl || audioUrl;
        if (audioSource) {
          await loadAudio(audioSource);
          // After loading, play it
          if (audioSound) {
            await audioSound.setRateAsync(playbackRate, true);
            await audioSound.playAsync();
          }
          return;
        }
        // Don't show snackbar - just return silently
        return;
      }

      // Get current status to check if actually playing
      const status = await audioSound.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          // Actually playing - pause it
          await audioSound.pauseAsync();
          setIsPlaying(false);
        } else {
          // Not playing - play it
          await audioSound.setRateAsync(playbackRate, true);
          await audioSound.playAsync();
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      // Don't show snackbar - just log the error
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

  // Increase playback speed
  const increaseSpeed = async () => {
    const newRate = Math.min(playbackRate + 0.25, 4.0); // Max 4x speed
    setPlaybackRate(newRate);
    if (audioSound) {
      try {
        const status = await audioSound.getStatusAsync();
        if (status.isLoaded) {
          const wasPlaying = status.isPlaying;
          await audioSound.setRateAsync(newRate, true);
          // If audio was playing, ensure it continues playing at new rate
          if (wasPlaying && !status.isPlaying) {
            await audioSound.playAsync();
          }
          console.log('✅ Playback speed increased to:', newRate);
        }
      } catch (error) {
        console.error('Error setting playback rate:', error);
      }
    }
  };

  // Decrease playback speed
  const decreaseSpeed = async () => {
    const newRate = Math.max(playbackRate - 0.25, 0.5); // Min 0.5x speed
    setPlaybackRate(newRate);
    if (audioSound) {
      try {
        const status = await audioSound.getStatusAsync();
        if (status.isLoaded) {
          const wasPlaying = status.isPlaying;
          await audioSound.setRateAsync(newRate, true);
          // If audio was playing, ensure it continues playing at new rate
          if (wasPlaying && !status.isPlaying) {
            await audioSound.playAsync();
          }
          console.log('✅ Playback speed decreased to:', newRate);
        }
      } catch (error) {
        console.error('Error setting playback rate:', error);
      }
    }
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

  // Helper function to check if a value is a rejection option for a question type
  const isRejectionOption = (questionType: string, value: string): boolean => {
    if (!value || value === '') return false;
    
    switch (questionType) {
      case 'audioStatus':
        // Rejection options: anything that's not "1", "4", or "7"
        return value !== '1' && value !== '4' && value !== '7';
      case 'gender':
        // Rejection options: "2" (Not Matched), "3" (Male answering on behalf of female)
        return value === '2' || value === '3';
      case 'upcomingElection':
      case 'assembly2021':
      case 'lokSabha2024':
      case 'name':
      case 'age':
        // Rejection options: "2" (Not Matched), "4" (Did not ask)
        // Note: "3" (Cannot hear) is acceptable, not a rejection
        return value === '2' || value === '4';
      default:
        return false;
    }
  };

  // Helper function to check if any rejection option has been selected
  const hasRejectionOption = (): boolean => {
    // Check in order of questions
    const questionOrder = [
      { type: 'audioStatus', value: verificationForm.audioStatus },
      { type: 'gender', value: verificationForm.genderMatching },
      { type: 'upcomingElection', value: verificationForm.upcomingElectionsMatching },
      { type: 'assembly2021', value: verificationForm.previousElectionsMatching },
      { type: 'lokSabha2024', value: verificationForm.previousLoksabhaElectionsMatching },
      { type: 'name', value: verificationForm.nameMatching },
      { type: 'age', value: verificationForm.ageMatching },
    ];
    
    for (const question of questionOrder) {
      if (question.value && isRejectionOption(question.type, question.value)) {
        return true;
      }
    }
    
    return false;
  };

  // Helper function to check if a verification question should be shown
  const shouldShowVerificationQuestion = (questionType: string): boolean => {
    if (!interview) return true;
    
    // Phone number question should not be shown for CATI responses
    if (questionType === 'phoneNumber' && interview.interviewMode === 'cati') {
      return false;
    }
    
    // If any rejection option has been selected, hide all subsequent questions
    if (hasRejectionOption()) {
      // Define question order
      const questionOrder = ['audioStatus', 'gender', 'upcomingElection', 'assembly2021', 'lokSabha2024', 'name', 'age', 'phoneNumber'];
      const currentIndex = questionOrder.indexOf(questionType);
      
      // Find the first question with a rejection option
      let rejectionIndex = -1;
      if (isRejectionOption('audioStatus', verificationForm.audioStatus)) {
        rejectionIndex = 0;
      } else if (isRejectionOption('gender', verificationForm.genderMatching)) {
        rejectionIndex = 1;
      } else if (isRejectionOption('upcomingElection', verificationForm.upcomingElectionsMatching)) {
        rejectionIndex = 2;
      } else if (isRejectionOption('assembly2021', verificationForm.previousElectionsMatching)) {
        rejectionIndex = 3;
      } else if (isRejectionOption('lokSabha2024', verificationForm.previousLoksabhaElectionsMatching)) {
        rejectionIndex = 4;
      } else if (isRejectionOption('name', verificationForm.nameMatching)) {
        rejectionIndex = 5;
      } else if (isRejectionOption('age', verificationForm.ageMatching)) {
        rejectionIndex = 6;
      }
      
      // Hide all questions after the one with rejection option
      if (rejectionIndex >= 0 && currentIndex > rejectionIndex) {
        return false;
      }
    }
    
    // For gender question, only show if audioStatus is valid (1 or 7)
    // Audio Status must be either:
    // - "1" (Survey Conversation can be heard)
    // - "7" (Cannot hear the response clearly)
    // If any other option is selected, the response will be rejected anyway, so don't show gender question
    if (questionType === 'gender') {
      const audioStatus = verificationForm.audioStatus;
      // Only show gender question if audioStatus is '1' or '7'
      if (audioStatus !== '1' && audioStatus !== '7') {
        return false;
      }
    }
    
    // Get verification responses to check if related response is skipped
    const verificationResponses = getVerificationResponses();
    
    // Check if related response is skipped
    switch (questionType) {
      case 'gender':
        return !verificationResponses.genderResponse?.isSkipped;
      case 'upcomingElection':
        return !verificationResponses.upcomingElectionResponse?.isSkipped;
      case 'assembly2021':
        return !verificationResponses.assembly2021Response?.isSkipped;
      case 'lokSabha2024':
        return !verificationResponses.lokSabha2024Response?.isSkipped;
      case 'name':
        return !verificationResponses.nameResponse?.isSkipped;
      case 'age':
        return !verificationResponses.ageResponse?.isSkipped;
      default:
        return true;
    }
  };

  const isVerificationFormValid = () => {
    if (!interview) return false;
    
    // Audio status is always required
    if (verificationForm.audioStatus === '') return false;
    
    // If a rejection option is selected, form is valid (don't require other questions)
    if (hasRejectionOption()) {
      return true;
    }
    
    // Otherwise, check each question only if it should be shown
    if (shouldShowVerificationQuestion('gender') && verificationForm.genderMatching === '') return false;
    if (shouldShowVerificationQuestion('upcomingElection') && verificationForm.upcomingElectionsMatching === '') return false;
    if (shouldShowVerificationQuestion('assembly2021') && verificationForm.previousElectionsMatching === '') return false;
    if (shouldShowVerificationQuestion('lokSabha2024') && verificationForm.previousLoksabhaElectionsMatching === '') return false;
    if (shouldShowVerificationQuestion('name') && verificationForm.nameMatching === '') return false;
    if (shouldShowVerificationQuestion('age') && verificationForm.ageMatching === '') return false;
    if (shouldShowVerificationQuestion('phoneNumber') && verificationForm.phoneNumberAsked === '') return false;
    
    return true;
  };

  const getApprovalStatus = () => {
    if (!interview) return 'rejected';
    
    // If any rejection option is selected, automatically reject
    if (hasRejectionOption()) {
      return 'rejected';
    }
    
    const audioStatus = verificationForm.audioStatus;
    if (audioStatus !== '1' && audioStatus !== '4' && audioStatus !== '7') {
      return 'rejected';
    }
    
    // Only check questions that should be shown
    if (shouldShowVerificationQuestion('gender')) {
      if (verificationForm.genderMatching !== '1') {
        return 'rejected';
      }
    }
    
    if (shouldShowVerificationQuestion('upcomingElection')) {
      if (verificationForm.upcomingElectionsMatching !== '1' && 
          verificationForm.upcomingElectionsMatching !== '3') {
        return 'rejected';
      }
    }
    
    if (shouldShowVerificationQuestion('assembly2021')) {
      if (verificationForm.previousElectionsMatching !== '1' && 
          verificationForm.previousElectionsMatching !== '3') {
        return 'rejected';
      }
    }
    
    if (shouldShowVerificationQuestion('lokSabha2024')) {
      if (verificationForm.previousLoksabhaElectionsMatching !== '1' && 
          verificationForm.previousLoksabhaElectionsMatching !== '3') {
        return 'rejected';
      }
    }
    
    if (shouldShowVerificationQuestion('name')) {
      if (verificationForm.nameMatching !== '1' && 
          verificationForm.nameMatching !== '3') {
        return 'rejected';
      }
    }
    
    if (shouldShowVerificationQuestion('age')) {
      if (verificationForm.ageMatching !== '1' && 
          verificationForm.ageMatching !== '3') {
        return 'rejected';
      }
    }
    
    // Phone number question is informational only and already excluded for CATI
    
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

  // Handle close with confirmation dialog
  const handleClose = () => {
    // Check if audio is playing using ref
    const currentAudio = audioSoundRef.current;
    if (currentAudio) {
      currentAudio.getStatusAsync().then((status) => {
        if (status.isLoaded && status.isPlaying) {
          // Audio is playing - show confirmation
          Alert.alert(
            'Close Quality Check?',
            'Audio is currently playing. Are you sure you want to close the Quality Check? The audio will be stopped.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Close',
                style: 'destructive',
                onPress: async () => {
                  // Stop and cleanup audio
                  await cleanupAudio();
                  // Close modal
                  onClose();
                },
              },
            ],
            { cancelable: true }
          );
        } else {
          // Audio not playing - still show confirmation but simpler message
          Alert.alert(
            'Close Quality Check?',
            'Are you sure you want to close the Quality Check?',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Close',
                style: 'destructive',
                onPress: async () => {
                  // Cleanup audio anyway (in case it's loaded but paused)
                  await cleanupAudio();
                  // Close modal
                  onClose();
                },
              },
            ],
            { cancelable: true }
          );
        }
      }).catch(() => {
        // If we can't get status, assume audio might be playing and show confirmation
        Alert.alert(
          'Close Quality Check?',
          'Are you sure you want to close the Quality Check? Any playing audio will be stopped.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Close',
              style: 'destructive',
              onPress: async () => {
                // Cleanup audio
                await cleanupAudio();
                // Close modal
                onClose();
              },
            },
          ],
          { cancelable: true }
        );
      });
    } else {
      // No audio loaded - show simple confirmation
      Alert.alert(
        'Close Quality Check?',
        'Are you sure you want to close the Quality Check?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Close',
            style: 'destructive',
            onPress: () => {
              onClose();
            },
          },
        ],
        { cancelable: true }
      );
    }
  };

  const getRespondentInfo = () => {
    const responses = interview.responses || [];
    const surveyId = interview.survey?._id || interview.survey?.survey?._id || null;
    
    // Helper to extract value from response (handle arrays)
    const extractValue = (response: any) => {
      if (!response || !response.response) return null;
      if (Array.isArray(response.response)) {
        return response.response.length > 0 ? response.response[0] : null;
      }
      return response.response;
    };

    // Helper to find response by question text (ignoring translations)
    const findResponseByQuestionText = (searchTexts: string[]) => {
      return responses.find((r: any) => {
        if (!r.questionText) return false;
        const mainText = getMainText(r.questionText).toLowerCase();
        return searchTexts.some(text => mainText.includes(text.toLowerCase()));
      });
    };

    // Helper to find response by questionNumber
    const findResponseByQuestionNumber = (questionNumber: string) => {
      return responses.find((r: any) => {
        if (!r.questionNumber) return false;
        const qNum = r.questionNumber || '';
        return qNum === questionNumber || qNum.includes(questionNumber) || questionNumber.includes(qNum);
      });
    };

    // Find name from Q28 - "Would You like to share your name with us?"
    let nameResponse = null;
    if (surveyId === '68fd1915d41841da463f0d46') {
      // Strategy 1: Find by questionNumber (Q28 or 28)
      nameResponse = findResponseByQuestionNumber('Q28') || findResponseByQuestionNumber('28');
      
      // Strategy 2: Find by question text keywords
      if (!nameResponse) {
        nameResponse = findResponseByQuestionText([
          'would you like to share your name',
          'share your name',
          'name with us'
        ]);
      }
      
      // Strategy 3: Find by question ID if available
      if (!nameResponse && survey) {
        const actualSurvey = survey.survey || survey;
        let nameQuestion = null;
        
        // Search in sections
        if (actualSurvey.sections) {
          for (const section of actualSurvey.sections) {
            if (section.questions) {
              nameQuestion = section.questions.find((q: any) => {
                const qText = getMainText(q.text || '').toLowerCase();
                return qText.includes('would you like to share your name') ||
                       qText.includes('share your name') ||
                       (q.questionNumber && (q.questionNumber === '28' || q.questionNumber === 'Q28' || q.questionNumber.includes('28')));
              });
              if (nameQuestion) break;
            }
          }
        }
        
        // Search in direct questions
        if (!nameQuestion && actualSurvey.questions) {
          nameQuestion = actualSurvey.questions.find((q: any) => {
            const qText = getMainText(q.text || '').toLowerCase();
            return qText.includes('would you like to share your name') ||
                   qText.includes('share your name') ||
                   (q.questionNumber && (q.questionNumber === '28' || q.questionNumber === 'Q28' || q.questionNumber.includes('28')));
          });
        }
        
        if (nameQuestion && nameQuestion.id) {
          nameResponse = responses.find((r: any) => r.questionId === nameQuestion.id);
        }
      }
      
      // Fallback to general name search
      if (!nameResponse) {
        nameResponse = findResponseByQuestionText([
          'what is your full name',
          'full name',
          'name'
        ]);
      }
    } else {
      // For other surveys, use general name search
      nameResponse = findResponseByQuestionText([
        'what is your full name',
        'full name',
        'name',
        'respondent'
      ]);
    }

    // Find gender response using genderUtils (more reliable)
    const genderResponse = findGenderResponse(responses, survey) || responses.find((r: any) => {
      const mainText = getMainText(r.questionText || '').toLowerCase();
      return mainText.includes('gender') || mainText.includes('sex');
    });
    
    // Get gender question from survey to format the response correctly
    let genderQuestion = null;
    if (genderResponse && survey) {
      const actualSurvey = survey.survey || survey;
      genderQuestion = findQuestionByText(genderResponse.questionText, actualSurvey);
    }
    
    // Format gender response using formatResponseDisplay (removes translation part)
    let genderDisplay = 'Not Available';
    if (genderResponse?.response) {
      const genderValue = extractValue(genderResponse.response);
      if (genderValue) {
        genderDisplay = formatResponseDisplay(genderValue, genderQuestion);
      }
    }

    const ageResponse = responses.find((r: any) => {
      const mainText = getMainText(r.questionText || '').toLowerCase();
      return mainText.includes('age') || mainText.includes('year');
    });

    // Get name and capitalize it
    let name = 'Not Available';
    if (nameResponse?.response) {
      const nameValue = extractValue(nameResponse.response);
      if (nameValue && nameValue !== 'N/A' && String(nameValue).trim() !== '') {
        // Make sure it's not a gender value
        const nameStr = String(nameValue).toLowerCase().trim();
        if (nameStr !== 'male' && nameStr !== 'female' && !nameStr.includes('_{')) {
          // Capitalize the name
          name = String(nameValue)
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        }
      }
    }

    return {
      name: name,
      gender: genderDisplay,
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

  // Helper function to find question in survey by keywords
  const findQuestionInSurveyByKeywords = (keywords: string[], survey: any, requireAll: boolean = false) => {
    if (!survey) return null;
    const actualSurvey = survey.survey || survey;
    const normalizedKeywords = keywords.map(k => k.toLowerCase());
    
    const searchInQuestions = (questions: any[]) => {
      for (const question of questions) {
        const questionText = getMainText(question.text || question.questionText || '').toLowerCase();
        if (requireAll) {
          if (normalizedKeywords.every(keyword => questionText.includes(keyword))) {
            return question;
          }
        } else {
          if (normalizedKeywords.some(keyword => questionText.includes(keyword))) {
            return question;
          }
        }
      }
      return null;
    };
    
    // Search in sections
    if (actualSurvey.sections) {
      for (const section of actualSurvey.sections) {
        if (section.questions) {
          const found = searchInQuestions(section.questions);
          if (found) return found;
        }
      }
    }
    
    // Search in top-level questions
    if (actualSurvey.questions) {
      const found = searchInQuestions(actualSurvey.questions);
      if (found) return found;
    }
    
    return null;
  };

  // Helper function to find response by matching question text (without translations)
  const findResponseByQuestionText = (targetQuestionText: string) => {
    const responses = interview.responses || [];
    const targetMainText = getMainText(targetQuestionText).toLowerCase().trim();
    
    return responses.find((r: any) => {
      const responseQuestionText = getMainText(r.questionText || '').toLowerCase().trim();
      // Exact match or contains the main text
      return responseQuestionText === targetMainText || 
             responseQuestionText.includes(targetMainText) ||
             targetMainText.includes(responseQuestionText);
    });
  };

  // Helper function to find response by matching survey question (finds question in survey, then matches response)
  const findResponseBySurveyQuestion = (keywords: string[], survey: any, requireAll: boolean = false, excludeKeywords: string[] = []) => {
    // First, find the question in the survey
    const surveyQuestion = findQuestionInSurveyByKeywords(keywords, survey, requireAll);
    if (!surveyQuestion) return null;
    
    // Get the main text of the survey question (without translation)
    const surveyQuestionMainText = getMainText(surveyQuestion.text || surveyQuestion.questionText || '');
    
    // If exclude keywords are provided, check if this question matches them
    if (excludeKeywords.length > 0) {
      const questionTextLower = surveyQuestionMainText.toLowerCase();
      const hasExcludeKeyword = excludeKeywords.some(keyword => questionTextLower.includes(keyword.toLowerCase()));
      if (hasExcludeKeyword) return null;
    }
    
    // Now find the response that matches this question text
    return findResponseByQuestionText(surveyQuestionMainText);
  };

  // Helper function to find response by question text keywords (fallback method)
  const findResponseByKeywords = (keywords: string[], requireAll: boolean = false, excludeKeywords: string[] = []) => {
    const responses = interview.responses || [];
    const normalizedKeywords = keywords.map(k => k.toLowerCase());
    const normalizedExclude = excludeKeywords.map(k => k.toLowerCase());
    
    return responses.find((r: any) => {
      const questionText = getMainText(r.questionText || '').toLowerCase();
      
      // Check exclude keywords first
      if (normalizedExclude.length > 0) {
        const hasExcludeKeyword = normalizedExclude.some(keyword => questionText.includes(keyword));
        if (hasExcludeKeyword) return false;
      }
      
      // Check include keywords
      if (requireAll) {
        return normalizedKeywords.every(keyword => questionText.includes(keyword));
      } else {
        return normalizedKeywords.some(keyword => questionText.includes(keyword));
      }
    });
  };

  // Helper to get main text (strip translations)
  const getMainText = (text: string) => {
    if (!text || typeof text !== 'string') return text || '';
    const translationRegex = /^(.+?)\s*\{([^}]+)\}\s*$/;
    const match = text.match(translationRegex);
    return match ? match[1].trim() : text.trim();
  };

  // Get specific responses for verification questions
  const getVerificationResponses = () => {
    const responses = interview.responses || [];
    
    // Gender response - match by finding question in survey first
    let genderResponse = findResponseBySurveyQuestion(['gender', 'sex'], survey, false);
    if (!genderResponse) {
      genderResponse = findResponseByKeywords(['gender', 'sex'], false);
    }
    const genderValue = genderResponse?.response 
      ? (Array.isArray(genderResponse.response) ? genderResponse.response[0] : genderResponse.response)
      : null;
    
    // Upcoming election response (Q9) - "2025 Preference"
    // Match by finding question in survey first
    let upcomingElectionResponse = findResponseBySurveyQuestion(['2025', 'preference'], survey, true);
    if (!upcomingElectionResponse) {
      upcomingElectionResponse = findResponseByKeywords(['2025', 'preference'], true);
    }
    const upcomingElectionValue = upcomingElectionResponse?.response 
      ? (Array.isArray(upcomingElectionResponse.response) ? upcomingElectionResponse.response[0] : upcomingElectionResponse.response)
      : null;
    
    // 2021 Assembly election response (Q6) - "Which party did you vote for in the last assembly elections (MLA) in 2021?"
    let assembly2021Response = findResponseBySurveyQuestion([
      'last assembly elections', 'mla', '2021', 'which party did you vote'
    ], survey, false);
    if (!assembly2021Response) {
      assembly2021Response = findResponseByKeywords([
        'last assembly elections', 'mla', '2021', 'which party did you vote'
      ], false);
    }
    const assembly2021Value = assembly2021Response?.response 
      ? (Array.isArray(assembly2021Response.response) ? assembly2021Response.response[0] : assembly2021Response.response)
      : null;
    
    // 2024 Lok Sabha election response (Q6) - "2024 GE Party Choice"
    // Match by finding "2024 GE Party Choice" question in survey first
    // Use more specific keywords to avoid matching age or other questions
    let lokSabha2024Response = null;
    
    // Strategy 1: Look for "ge party choice" with "2024" - require both
    lokSabha2024Response = findResponseBySurveyQuestion([
      'ge party choice', '2024'
    ], survey, true, ['age', 'বয়স', 'year', 'old', 'assembly', 'ae', '2021', '2025']);
    
    // Strategy 2: Look for responses with "2024" and "ge party choice" separately
    if (!lokSabha2024Response) {
      lokSabha2024Response = findResponseByKeywords([
        '2024', 'ge party choice'
      ], true, ['age', 'বয়স', 'year', 'old', 'assembly', 'ae', '2021', '2025', 'preference']);
    }
    
    // Strategy 3: Look for "ge party choice" (case-insensitive) with "2024" anywhere
    if (!lokSabha2024Response) {
      lokSabha2024Response = responses.find((r: any) => {
        const questionText = getMainText(r.questionText || '').toLowerCase();
        const has2024 = questionText.includes('2024');
        const hasGePartyChoice = questionText.includes('ge party choice') || questionText.includes('ge party');
        const hasExclude = questionText.includes('age') || questionText.includes('বয়স') || 
                          questionText.includes('assembly') || questionText.includes('ae') ||
                          questionText.includes('2021') || questionText.includes('2025') ||
                          questionText.includes('preference');
        return has2024 && hasGePartyChoice && !hasExclude;
      });
    }
    const lokSabha2024Value = lokSabha2024Response?.response 
      ? (Array.isArray(lokSabha2024Response.response) ? lokSabha2024Response.response[0] : lokSabha2024Response.response)
      : null;
    
    // Name response - "Would You like to share your name with us?"
    let nameResponse = findResponseBySurveyQuestion(['would you like to share your name', 'share your name', 'name with us'], survey, false);
    if (!nameResponse) {
      nameResponse = findResponseByKeywords(['would you like to share your name', 'share your name', 'name with us'], false);
    }
    // Fallback to general name search
    if (!nameResponse) {
      nameResponse = findResponseBySurveyQuestion(['name', 'respondent'], survey, false);
      if (!nameResponse) {
        nameResponse = findResponseByKeywords(['name', 'respondent'], false);
      }
    }
    const nameValue = nameResponse?.response 
      ? (Array.isArray(nameResponse.response) ? nameResponse.response[0] : nameResponse.response)
      : null;
    
    // Age response - "Could you please tell me your age in complete years?"
    // Try multiple matching strategies - start with simplest first
    let ageResponse = null;
    
    // Strategy 1: Direct text match - look for exact question text or key phrases
    ageResponse = responses.find((r: any) => {
      const questionText = getMainText(r.questionText || '').toLowerCase().trim();
      return questionText.includes('could you please tell me your age') ||
             questionText.includes('tell me your age in complete years') ||
             questionText === 'could you please tell me your age in complete years?';
    });
    
    // Strategy 2: More flexible matching - look for "age" and "years" or "complete years"
    if (!ageResponse) {
      ageResponse = responses.find((r: any) => {
        const questionText = getMainText(r.questionText || '').toLowerCase();
        return (questionText.includes('age') || questionText.includes('বয়স')) && 
               (questionText.includes('complete years') || questionText.includes('year'));
      });
    }
    
    // Strategy 3: Find question in survey first, excluding election-related terms
    if (!ageResponse) {
      ageResponse = findResponseBySurveyQuestion([
        'age', 'how old', 'tell me your age', 'complete years', 'বয়স'
      ], survey, false, ['election', 'vote', 'party', 'preference', 'lok sabha', 'loksabha', 'mp', 'mla', '2025', '2024', '2021']);
    }
    
    // Strategy 4: Direct keyword matching with exclusions
    if (!ageResponse) {
      ageResponse = findResponseByKeywords([
        'age', 'how old', 'tell me your age', 'complete years', 'বয়স'
      ], false, ['election', 'vote', 'party', 'preference', 'lok sabha', 'loksabha', 'mp', 'mla', '2025', '2024', '2021']);
    }
    
    // Strategy 5: Last resort - any question with "age" that doesn't have election keywords
    if (!ageResponse) {
      ageResponse = responses.find((r: any) => {
        const questionText = getMainText(r.questionText || '').toLowerCase();
        const hasAge = questionText.includes('age') || questionText.includes('বয়স');
        const hasElection = questionText.includes('election') || questionText.includes('vote') || 
                           questionText.includes('party') || questionText.includes('preference');
        return hasAge && !hasElection;
      });
    }
    
    // Strategy 6: Absolute last resort - ANY response with "age" in question text (no exclusions)
    if (!ageResponse) {
      ageResponse = responses.find((r: any) => {
        const questionText = getMainText(r.questionText || '').toLowerCase();
        return questionText.includes('age') || questionText.includes('বয়স');
      });
    }
    
    const ageValue = ageResponse?.response 
      ? (Array.isArray(ageResponse.response) ? ageResponse.response[0] : ageResponse.response)
      : null;
    
    return {
      gender: genderValue ? formatResponseDisplay(genderValue, findQuestionByText(genderResponse?.questionText, survey)) : 'Not Available',
      upcomingElection: upcomingElectionValue ? formatResponseDisplay(upcomingElectionValue, findQuestionByText(upcomingElectionResponse?.questionText, survey)) : 'Not Available',
      assembly2021: assembly2021Value ? formatResponseDisplay(assembly2021Value, findQuestionByText(assembly2021Response?.questionText, survey)) : 'Not Available',
      lokSabha2024: lokSabha2024Value ? formatResponseDisplay(lokSabha2024Value, findQuestionByText(lokSabha2024Response?.questionText, survey)) : 'Not Available',
      name: nameValue ? formatResponseDisplay(nameValue, findQuestionByText(nameResponse?.questionText, survey)) : 'Not Available',
      age: ageValue ? formatResponseDisplay(ageValue, findQuestionByText(ageResponse?.questionText, survey)) : 'Not Available',
      // Include response objects to check if skipped
      genderResponse,
      upcomingElectionResponse,
      assembly2021Response,
      lokSabha2024Response,
      nameResponse,
      ageResponse
    };
  };

  const survey = interview?.survey || interview?.survey?.survey || null;
  const verificationResponses = getVerificationResponses();

  if (!interview) return null;

  const statusBarHeight = Platform.OS === 'ios' ? 0 : StatusBar.currentHeight || 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <View style={styles.modalContainer}>
        <StatusBar barStyle="dark-content" />
        
        {/* Header - Fixed at top */}
        <View style={[styles.header, { paddingTop: statusBarHeight + 12 }]}>
          <Text style={styles.headerTitle}>Response Details</Text>
          <Button
            mode="text"
            onPress={handleClose}
            icon="close"
            textColor="#6b7280"
            compact
          >
            Close
          </Button>
        </View>

        <Divider style={styles.divider} />

        {/* Audio Recording (CAPI) - Sticky at top */}
        {interview.interviewMode === 'capi' && (
          <View style={styles.stickyAudioSection}>
            <Card style={styles.audioCard}>
              <Card.Content>
                <Text style={styles.sectionTitle}>Audio Recording</Text>
                
                {audioSound ? (
                  <View style={styles.audioControls}>
                    {audioDuration > 0 ? (
                      <>
                        <View style={styles.audioTimelineContainer}>
                          <Button
                            mode="contained"
                            onPress={playAudio}
                            icon={isPlaying ? "pause" : "play"}
                            style={styles.audioButtonInline}
                            disabled={!audioSound}
                            compact
                          >
                            {isPlaying ? 'Pause' : 'Play'}
                          </Button>
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
                        {/* Speed Control */}
                        <View style={styles.speedControlContainer}>
                          <Text style={styles.speedLabel}>Speed:</Text>
                          <TouchableOpacity
                            onPress={decreaseSpeed}
                            disabled={playbackRate <= 0.5}
                            style={[styles.speedButtonTouchable, playbackRate <= 0.5 && styles.speedButtonDisabled]}
                          >
                            <Ionicons 
                              name="remove-circle-outline" 
                              size={24} 
                              color={playbackRate <= 0.5 ? '#9ca3af' : '#2563eb'} 
                            />
                          </TouchableOpacity>
                          <Text style={styles.speedValue}>{playbackRate.toFixed(2)}x</Text>
                          <TouchableOpacity
                            onPress={increaseSpeed}
                            disabled={playbackRate >= 4.0}
                            style={[styles.speedButtonTouchable, playbackRate >= 4.0 && styles.speedButtonDisabled]}
                          >
                            <Ionicons 
                              name="add-circle-outline" 
                              size={24} 
                              color={playbackRate >= 4.0 ? '#9ca3af' : '#2563eb'} 
                            />
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <Button
                        mode="contained"
                        onPress={playAudio}
                        icon={isPlaying ? "pause" : "play"}
                        style={styles.audioButton}
                        disabled={!audioSound}
                      >
                        {isPlaying ? 'Pause' : 'Play'}
                      </Button>
                    )}
                  </View>
                ) : (
                  <Text style={styles.noDataText}>No Recording Found</Text>
                )}
              </Card.Content>
            </Card>
          </View>
        )}

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
                
                {interview.interviewer ? (
                  <>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Interviewer:</Text>
                      <Text style={styles.infoValue}>
                        {interview.interviewer.firstName || ''} {interview.interviewer.lastName || ''}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Interviewer ID:</Text>
                      <Text style={styles.infoValue}>
                        {(() => {
                          const memberId = interview.interviewer?.memberId || interview.interviewer?.memberID;
                          console.log('🔍 ResponseDetailsModal - Interviewer ID check:', {
                            memberId: memberId,
                            interviewer: interview.interviewer,
                            hasMemberId: !!interview.interviewer?.memberId,
                            hasMemberID: !!interview.interviewer?.memberID,
                            allKeys: interview.interviewer ? Object.keys(interview.interviewer) : []
                          });
                          return memberId || 'N/A';
                        })()}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Interviewer:</Text>
                    <Text style={styles.infoValue}>Not available</Text>
                  </View>
                )}
                
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

            {/* CATI Call Information */}
            {interview.interviewMode === 'cati' && (
              <Card style={styles.card}>
                <Card.Content>
                  <Text style={styles.sectionTitle}>Call Information</Text>
                  
                  {loadingCatiRecording ? (
                    <ActivityIndicator size="small" color="#2563eb" />
                  ) : catiCallDetails ? (
                    <View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Call Status:</Text>
                        <Text style={[
                          styles.infoValue,
                          (catiCallDetails.callStatus === 'completed' || catiCallDetails.callStatus === 'answered') && { color: '#16a34a' },
                          (catiCallDetails.callStatus === 'failed' || catiCallDetails.callStatus === 'busy') && { color: '#dc2626' }
                        ]}>
                          {catiCallDetails.callStatusDescription || catiCallDetails.statusDescription || catiCallDetails.callStatus || 'N/A'}
                        </Text>
                      </View>
                      
                      {(catiCallDetails.callStatusCode || catiCallDetails.originalStatusCode) && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Status Code:</Text>
                          <Text style={styles.infoValue}>
                            {catiCallDetails.callStatusCode || catiCallDetails.originalStatusCode}
                          </Text>
                        </View>
                      )}
                      
                      {catiCallDetails.callId && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Call ID:</Text>
                          <Text style={[styles.infoValue, { fontFamily: 'monospace', fontSize: 11 }]}>
                            {catiCallDetails.callId}
                          </Text>
                        </View>
                      )}
                      
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>From Number:</Text>
                        <Text style={styles.infoValue}>{catiCallDetails.fromNumber || 'N/A'}</Text>
                      </View>
                      
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>To Number:</Text>
                        <Text style={styles.infoValue}>{catiCallDetails.toNumber || 'N/A'}</Text>
                      </View>
                      
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Call Duration:</Text>
                        <Text style={styles.infoValue}>
                          {catiCallDetails.callDuration ? formatDuration(catiCallDetails.callDuration) : 'N/A'}
                        </Text>
                      </View>
                      
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Talk Duration:</Text>
                        <Text style={styles.infoValue}>
                          {catiCallDetails.talkDuration ? formatDuration(catiCallDetails.talkDuration) : 'N/A'}
                        </Text>
                      </View>
                      
                      {(catiCallDetails.startTime || catiCallDetails.callStartTime) && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Call Start Time:</Text>
                          <Text style={styles.infoValue}>
                            {new Date(catiCallDetails.startTime || catiCallDetails.callStartTime).toLocaleString()}
                          </Text>
                        </View>
                      )}
                      
                      {(catiCallDetails.endTime || catiCallDetails.callEndTime) && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Call End Time:</Text>
                          <Text style={styles.infoValue}>
                            {new Date(catiCallDetails.endTime || catiCallDetails.callEndTime).toLocaleString()}
                          </Text>
                        </View>
                      )}
                      
                      {catiCallDetails.ringDuration && catiCallDetails.ringDuration > 0 && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Ring Duration:</Text>
                          <Text style={styles.infoValue}>
                            {formatDuration(catiCallDetails.ringDuration)}
                          </Text>
                        </View>
                      )}
                      
                      {catiCallDetails.hangupCause && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Hangup Cause:</Text>
                          <Text style={styles.infoValue}>{catiCallDetails.hangupCause}</Text>
                        </View>
                      )}
                      
                      {catiCallDetails.hangupBySource && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Hangup By:</Text>
                          <Text style={styles.infoValue}>{catiCallDetails.hangupBySource}</Text>
                        </View>
                      )}
                      
                      {catiCallDetails.recordingUrl && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Recording Available:</Text>
                          <Text style={[styles.infoValue, { color: '#16a34a' }]}>Yes</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoValue}>Call details not available</Text>
                    </View>
                  )}
                </Card.Content>
              </Card>
            )}

            {/* CATI Call Recording */}
            {interview.interviewMode === 'cati' && catiCallDetails?.recordingUrl && (
              <Card style={styles.card}>
                <Card.Content>
                  <Text style={styles.sectionTitle}>Call Recording</Text>
                  
                  {loadingCatiRecording ? (
                    <View style={styles.audioControls}>
                      <ActivityIndicator size="small" color="#2563eb" />
                      <Text style={styles.noDataText}>Loading recording...</Text>
                    </View>
                  ) : catiAudioSound ? (
                    <View style={styles.audioControls}>
                      {catiAudioDuration > 0 ? (
                        <>
                          <View style={styles.audioTimelineContainer}>
                            <Button
                              mode="contained"
                              onPress={isPlayingCatiAudio ? pauseCatiAudio : playCatiAudio}
                              icon={isPlayingCatiAudio ? "pause" : "play"}
                              style={styles.audioButtonInline}
                              disabled={!catiAudioSound}
                              compact
                            >
                              {isPlayingCatiAudio ? 'Pause' : 'Play'}
                            </Button>
                            <Text style={styles.audioTime}>
                              {formatTime(catiAudioPosition)}
                            </Text>
                            <TouchableOpacity
                              activeOpacity={1}
                              style={styles.sliderContainer}
                              onLayout={(event) => {
                                const { width } = event.nativeEvent.layout;
                                setCatiSliderWidth(width);
                              }}
                              onPress={handleCatiSliderPress}
                            >
                              <View 
                                ref={catiSliderRef}
                                style={styles.sliderTrack}
                              >
                                <View 
                                  style={[
                                    styles.sliderProgress,
                                    { width: `${catiAudioDuration > 0 ? (catiAudioPosition / catiAudioDuration) * 100 : 0}%` }
                                  ]}
                                />
                                <View
                                  style={[
                                    styles.sliderThumb,
                                    { left: `${catiAudioDuration > 0 ? (catiAudioPosition / catiAudioDuration) * 100 : 0}%` }
                                  ]}
                                />
                              </View>
                            </TouchableOpacity>
                            <Text style={styles.audioTime}>
                              {formatTime(catiAudioDuration)}
                            </Text>
                          </View>
                          {/* Speed Control */}
                          <View style={styles.speedControlContainer}>
                            <Text style={styles.speedLabel}>Speed:</Text>
                            <TouchableOpacity
                              onPress={decreaseCatiSpeed}
                              disabled={catiPlaybackRate <= 0.5}
                              style={[styles.speedButtonTouchable, catiPlaybackRate <= 0.5 && styles.speedButtonDisabled]}
                            >
                              <Ionicons 
                                name="remove-circle-outline" 
                                size={24} 
                                color={catiPlaybackRate <= 0.5 ? '#9ca3af' : '#2563eb'} 
                              />
                            </TouchableOpacity>
                            <Text style={styles.speedValue}>{catiPlaybackRate.toFixed(2)}x</Text>
                            <TouchableOpacity
                              onPress={increaseCatiSpeed}
                              disabled={catiPlaybackRate >= 4.0}
                              style={[styles.speedButtonTouchable, catiPlaybackRate >= 4.0 && styles.speedButtonDisabled]}
                            >
                              <Ionicons 
                                name="add-circle-outline" 
                                size={24} 
                                color={catiPlaybackRate >= 4.0 ? '#9ca3af' : '#2563eb'} 
                              />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.audioInfoContainer}>
                            <Text style={styles.audioInfoText}>
                              Call Duration: {catiCallDetails?.callDuration ? formatDuration(catiCallDetails.callDuration) : 'N/A'}
                            </Text>
                            <Text style={styles.audioInfoText}>
                              Talk Duration: {catiCallDetails?.talkDuration ? formatDuration(catiCallDetails.talkDuration) : 'N/A'}
                            </Text>
                            <Text style={styles.audioInfoText}>Format: MP3</Text>
                            <Text style={styles.audioInfoText}>
                              Status: {catiCallDetails?.callStatusDescription || catiCallDetails?.callStatus || 'N/A'}
                            </Text>
                          </View>
                        </>
                      ) : (
                        <Button
                          mode="contained"
                          onPress={playCatiAudio}
                          icon={isPlayingCatiAudio ? "pause" : "play"}
                          style={styles.audioButton}
                          disabled={!catiAudioSound}
                        >
                          {isPlayingCatiAudio ? 'Pause' : 'Play'}
                        </Button>
                      )}
                    </View>
                  ) : catiCallDetails?.recordingUrl ? (
                    <Text style={styles.noDataText}>No recording available</Text>
                  ) : null}
                </Card.Content>
              </Card>
            )}

            {/* Responses - Collapsible */}
            <Card style={styles.card}>
              <Card.Content>
                <TouchableOpacity
                  onPress={() => setResponsesSectionExpanded(!responsesSectionExpanded)}
                  style={styles.collapsibleHeader}
                >
                  <Text style={styles.sectionTitle}>Responses</Text>
                  <Ionicons
                    name={responsesSectionExpanded ? "chevron-up" : "chevron-down"}
                    size={24}
                    color="#6b7280"
                  />
                </TouchableOpacity>
                
                {responsesSectionExpanded && (
                  <View style={styles.responsesContent}>
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
                  </View>
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

                {/* Gender Matching - Only show if Audio Status is '1' or '7' */}
                {shouldShowVerificationQuestion('gender') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>2. Gender of the Respondent Matching? (উত্তরদাতার লিঙ্গ কি মেলানো হয়েছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.gender}</Text>
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
                )}

                {/* Upcoming Elections Matching */}
                {shouldShowVerificationQuestion('upcomingElection') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>3. Is the Response Matching for the Upcoming Elections preference (Q8)? (উত্তরটি কি আসন্ন নির্বাচনের পছন্দ (প্রশ্ন ৮) এর সাথে মিলে যাচ্ছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.upcomingElection}</Text>
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
                )}

                {/* Previous Elections Matching */}
                {shouldShowVerificationQuestion('assembly2021') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>4. Is the Response Matching for the Previous 2021 Assembly Election (Q5)? (উত্তরটি কি ২০২১ সালের পূর্ববর্তী বিধানসভা নির্বাচনের (প্রশ্ন ৫) সাথে মিলে যাচ্ছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.assembly2021}</Text>
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
                )}

                {/* Previous Loksabha Elections Matching */}
                {shouldShowVerificationQuestion('lokSabha2024') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>5. Is the Response Matching for the Previous 2024 Loksabha Election (Q6)? (উত্তরটি কি ২০২৪ সালের পূর্ববর্তী লোকসভা নির্বাচনের (প্রশ্ন ৬) সাথে মিলে যাচ্ছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.lokSabha2024}</Text>
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
                )}

                {/* Name Matching */}
                {shouldShowVerificationQuestion('name') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>6. Name of the Respondent Matching? (উত্তরদাতার নাম কি মিলে গেছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.name}</Text>
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
                )}

                {/* Age Matching */}
                {shouldShowVerificationQuestion('age') && (
                  <View style={styles.formSection}>
                    <Text style={styles.formLabel}>7. Is the Age matching? (বয়স কি মিলে গেছে?) *</Text>
                    <Text style={styles.responseDisplayText}>Response: {verificationResponses.age}</Text>
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
                )}

                {/* Phone Number Asked */}
                {shouldShowVerificationQuestion('phoneNumber') && (
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
                )}

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
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  stickyAudioSection: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  audioCard: {
    marginBottom: 0,
    elevation: 0,
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
  audioButtonInline: {
    minWidth: 80,
    marginRight: 8,
  },
  audioTimelineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 8,
    marginTop: 0,
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
  speedControlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  speedLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
    marginRight: 4,
  },
  speedValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'center',
  },
  speedButton: {
    minWidth: 40,
    height: 36,
  },
  speedButtonTouchable: {
    padding: 4,
    borderRadius: 4,
  },
  speedButtonDisabled: {
    opacity: 0.5,
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
  audioInfoContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
  },
  audioInfoText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
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
  responseDisplayText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '500',
    marginBottom: 12,
    padding: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#2563eb',
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
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  responsesContent: {
    marginTop: 12,
  },
});

