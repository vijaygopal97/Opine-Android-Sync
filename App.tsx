import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import screens
import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import InterviewerDashboard from './src/screens/InterviewerDashboard';
import QualityAgentDashboard from './src/screens/QualityAgentDashboard';
import AvailableSurveys from './src/screens/AvailableSurveys';
import MyInterviews from './src/screens/MyInterviews';
import InterviewInterface from './src/screens/InterviewInterface';
import InterviewDetails from './src/screens/InterviewDetails';

// Import theme
import { theme } from './src/theme/theme';

// Import API service
import { apiService } from './src/services/api';
import { appLoggingService } from './src/services/appLoggingService';

const Stack = createStackNavigator();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Initialize logging service
    appLoggingService.initialize().catch(err => {
      console.error('Failed to initialize logging service:', err);
    });
    
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      console.log('🔐 Checking authentication status...');
      
      // Step 1: IMMEDIATELY check for stored authentication data (no network calls)
      const token = await AsyncStorage.getItem('authToken');
      const userData = await AsyncStorage.getItem('userData');
      
      console.log('📦 Stored token exists:', !!token);
      console.log('📦 Stored user data exists:', !!userData);
      
      // If no stored auth data, user is not authenticated
      if (!token || !userData) {
        console.log('❌ No stored authentication data found');
        setUser(null);
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }
      
      // Parse user data
      let parsedUser;
      try {
        parsedUser = JSON.parse(userData);
        console.log('✅ Parsed user data:', parsedUser?.firstName, parsedUser?.userType);
      } catch (parseError) {
        console.error('❌ Error parsing user data:', parseError);
        // Invalid user data, clear storage
        await AsyncStorage.multiRemove(['authToken', 'userData']);
        setUser(null);
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }
      
      // Step 2: IMMEDIATELY authenticate from cache (like WhatsApp/Facebook)
      // This ensures user stays logged in even if offline check fails
      console.log('✅ Authenticating from cache (offline-first approach)');
      setUser(parsedUser);
      setIsAuthenticated(true);
      setIsLoading(false);
      
      // Step 3: In background, check online status and verify token (non-blocking)
      // This is done asynchronously and doesn't affect the login state
      setTimeout(async () => {
        try {
          console.log('🌐 Background: Checking network connectivity...');
          const isOnline = await Promise.race([
            apiService.isOnline(),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
          ]).catch(() => false);
          
          if (isOnline) {
            console.log('🌐 Background: Online - verifying token...');
            try {
              const response = await Promise.race([
                apiService.verifyToken(),
                new Promise<any>((_, reject) => 
                  setTimeout(() => reject(new Error('Timeout')), 2000)
                )
              ]) as any;
              
              if (response?.success) {
                console.log('✅ Background: Token verified successfully');
              } else {
                // Token invalid - but don't log out immediately, let user continue
                console.log('⚠️ Background: Token verification failed, but keeping user logged in for offline access');
              }
            } catch (verifyError: any) {
              const responseStatus = verifyError?.response?.status;
              // Only clear auth if we get explicit 401/403 (token truly invalid)
              if (responseStatus === 401 || responseStatus === 403) {
                console.log('❌ Background: Token explicitly invalid (401/403) - will require re-login on next app start');
                // Don't clear immediately - let user finish their session
                // The token will be invalidated on next app start when online
              } else {
                console.log('📴 Background: Network error during verification - keeping user logged in');
              }
            }
          } else {
            console.log('📴 Background: Offline - skipping token verification');
          }
        } catch (bgError) {
          console.log('⚠️ Background: Error in background auth check (non-critical):', bgError);
          // Non-critical - user is already logged in
        }
      }, 100); // Very short delay to ensure UI renders first
      
    } catch (error: any) {
      console.error('❌ Critical error in auth check:', error);
      
      // On critical error, ALWAYS try to use cached data as fallback
      try {
        const token = await AsyncStorage.getItem('authToken');
        const userData = await AsyncStorage.getItem('userData');
        if (token && userData) {
          const parsedUser = JSON.parse(userData);
          console.log('🔄 Using cached user data as fallback');
          setUser(parsedUser);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (fallbackError) {
        console.error('❌ Error reading cached data:', fallbackError);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleLogin = async (userData: any, token: string) => {
    try {
      console.log('✅ handleLogin called with user data:', userData?.firstName, userData?.userType);
      console.log('✅ Token exists:', !!token);
      
      // Store the authentication data (API service already stored it, but ensure it's here too)
      try {
      await AsyncStorage.setItem('authToken', token);
      await AsyncStorage.setItem('userData', JSON.stringify(userData));
        console.log('✅ Authentication data stored in App.tsx');
      } catch (storageError) {
        console.error('⚠️ Error storing auth data in App.tsx (non-critical):', storageError);
      }
      
      // Update state FIRST - this is critical for login to complete
      setUser(userData);
      setIsAuthenticated(true);
      console.log('✅ User state updated, authentication complete');
      
      // Download surveys and dependent data for offline use (completely async, non-blocking)
      // Do this in the background so login completes immediately
      // Use setTimeout with longer delay to ensure login completes first
      setTimeout(async () => {
        try {
          console.log('📥 Starting background download of offline data...');
          const { offlineStorage } = await import('./src/services/offlineStorage');
          
          console.log('📥 Downloading surveys for offline use...');
          const surveysResult = await apiService.getAvailableSurveys();
          if (surveysResult.success && surveysResult.surveys) {
            // Save surveys AND download all dependent data in one call
            // This ensures dependent data is downloaded immediately when surveys are saved
            await offlineStorage.saveSurveys(surveysResult.surveys, true);
            console.log('✅ Surveys and all dependent data downloaded and saved for offline use');
          } else {
            console.log('⚠️ Failed to download surveys, will retry later');
          }
        } catch (downloadError) {
          console.error('⚠️ Error in background download (non-critical):', downloadError);
          // Non-critical error, login already completed
        }
      }, 1000); // 1 second delay to ensure login completes
      
    } catch (error) {
      console.error('❌ Error in handleLogin:', error);
      // Even if there's an error, try to set user as authenticated
      try {
      setUser(userData);
      setIsAuthenticated(true);
        console.log('✅ User authenticated despite error');
      } catch (stateError) {
        console.error('❌ Critical error: Could not authenticate user:', stateError);
      }
    }
  };

  const handleLogout = async () => {
    try {
      console.log('Logging out user...');
      
      // Call the logout API to invalidate the token on the server
      try {
        await apiService.logout();
        console.log('Server logout successful');
      } catch (error) {
        console.error('Server logout failed:', error);
        // Continue with local logout even if server logout fails
      }
      
      // Clear local storage
      await AsyncStorage.multiRemove(['authToken', 'userData']);
      console.log('Local storage cleared');
      
      // Update state
      setUser(null);
      setIsAuthenticated(false);
      
      console.log('User logged out successfully');
    } catch (error) {
      console.error('Error during logout:', error);
      // Even if there's an error, clear the local state
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  if (isLoading) {
    return <SplashScreen />;
  }

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            cardStyle: { backgroundColor: '#ffffff' }
          }}
        >
          {!isAuthenticated ? (
            <>
              <Stack.Screen name="Login">
                {(props) => (
                  <LoginScreen
                    {...props}
                    onLogin={handleLogin}
                  />
                )}
              </Stack.Screen>
            </>
          ) : (
            <>
              <Stack.Screen name="Dashboard">
                {(props) => {
                  // Route to appropriate dashboard based on user type
                  if (user?.userType === 'quality_agent') {
                    return (
                      <QualityAgentDashboard
                        {...props}
                        user={user}
                        onLogout={handleLogout}
                      />
                    );
                  }
                  return (
                    <InterviewerDashboard
                      {...props}
                      user={user}
                      onLogout={handleLogout}
                    />
                  );
                }}
              </Stack.Screen>
              <Stack.Screen 
                name="AvailableSurveys" 
                component={AvailableSurveys}
                options={{
                  headerShown: true,
                  title: 'Available Surveys',
                  headerStyle: {
                    backgroundColor: theme.colors.primary,
                  },
                  headerTintColor: '#ffffff',
                  headerTitleStyle: {
                    fontWeight: 'bold',
                  },
                }}
              />
              <Stack.Screen 
                name="MyInterviews" 
                component={MyInterviews}
                options={{
                  headerShown: true,
                  title: 'My Interviews',
                  headerStyle: {
                    backgroundColor: theme.colors.primary,
                  },
                  headerTintColor: '#ffffff',
                  headerTitleStyle: {
                    fontWeight: 'bold',
                  },
                }}
              />
              <Stack.Screen 
                name="InterviewInterface" 
                component={InterviewInterface}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen 
                name="InterviewDetails" 
                options={{
                  headerShown: false,
                }}
              >
                {(props) => <InterviewDetails {...props} />}
              </Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}