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
import AvailableSurveys from './src/screens/AvailableSurveys';
import MyInterviews from './src/screens/MyInterviews';
import InterviewInterface from './src/screens/InterviewInterface';
import InterviewDetails from './src/screens/InterviewDetails';

// Import theme
import { theme } from './src/theme/theme';

// Import API service
import { apiService } from './src/services/api';

const Stack = createStackNavigator();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      console.log('Checking authentication status...');
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Auth check timeout')), 5000);
      });
      
      const authCheckPromise = (async () => {
        const token = await AsyncStorage.getItem('authToken');
        const userData = await AsyncStorage.getItem('userData');
        
        console.log('Stored token exists:', !!token);
        console.log('Stored user data exists:', !!userData);
        
        if (token && userData) {
          const parsedUser = JSON.parse(userData);
          console.log('Parsed user data:', parsedUser);
          
          // Verify token is still valid with timeout
          try {
            console.log('Verifying token with server...');
            const response = await Promise.race([
              apiService.verifyToken(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Token verification timeout')), 5000))
            ]) as any;
            
            console.log('Token verification response:', response);
            
            if (response.success) {
              console.log('Token is valid, user authenticated');
              setUser(parsedUser);
              setIsAuthenticated(true);
            } else {
              console.log('Token is invalid, clearing storage');
              // Token invalid, clear storage
              await AsyncStorage.multiRemove(['authToken', 'userData']);
              setUser(null);
              setIsAuthenticated(false);
            }
          } catch (error: any) {
            console.error('Token verification failed:', error);
            
            // Check if it's a network error or timeout
            const errorMessage = error?.message || '';
            const errorCode = error?.code || '';
            const isNetworkError = errorMessage.includes('Network Error') || 
                                  errorMessage.includes('timeout') ||
                                  errorMessage.includes('Token verification timeout') ||
                                  errorCode === 'NETWORK_ERROR' ||
                                  errorCode === 'ECONNABORTED';
            
            if (isNetworkError) {
              console.log('Network/timeout error during token verification, allowing offline access');
              // If it's a network error or timeout, allow the user to stay logged in
              setUser(parsedUser);
              setIsAuthenticated(true);
            } else {
              console.log('Non-network error, clearing storage');
              // For other errors (like 401 Unauthorized), clear storage
              await AsyncStorage.multiRemove(['authToken', 'userData']);
              setUser(null);
              setIsAuthenticated(false);
            }
          }
        } else {
          console.log('No stored authentication data found');
          setUser(null);
          setIsAuthenticated(false);
        }
      })();
      
      // Race between auth check and timeout
      await Promise.race([authCheckPromise, timeoutPromise]);
      
    } catch (error: any) {
      console.error('Auth check error:', error);
      
      // If timeout, try to use cached data
      if (error?.message === 'Auth check timeout') {
        console.log('Auth check timed out, checking for cached data...');
        try {
          const token = await AsyncStorage.getItem('authToken');
          const userData = await AsyncStorage.getItem('userData');
          if (token && userData) {
            const parsedUser = JSON.parse(userData);
            console.log('Using cached user data due to timeout');
            setUser(parsedUser);
            setIsAuthenticated(true);
          } else {
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (cacheError) {
          console.error('Error reading cached data:', cacheError);
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        // On any other error, clear storage and set as not authenticated
        try {
          await AsyncStorage.multiRemove(['authToken', 'userData']);
        } catch (clearError) {
          console.error('Error clearing storage:', clearError);
        }
        setUser(null);
        setIsAuthenticated(false);
      }
    } finally {
      console.log('Auth check completed, setting loading to false');
      setIsLoading(false);
    }
  };

  const handleLogin = async (userData: any, token: string) => {
    try {
      console.log('Handling login with user data:', userData);
      console.log('Handling login with token:', !!token);
      
      // Store the authentication data
      await AsyncStorage.setItem('authToken', token);
      await AsyncStorage.setItem('userData', JSON.stringify(userData));
      
      console.log('Authentication data stored successfully');
      
      // Update state
      setUser(userData);
      setIsAuthenticated(true);
      
      console.log('User authenticated successfully');
    } catch (error) {
      console.error('Error storing authentication data:', error);
      // Even if storage fails, we can still set the user as authenticated for the current session
      setUser(userData);
      setIsAuthenticated(true);
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
                {(props) => (
                  <InterviewerDashboard
                    {...props}
                    user={user}
                    onLogout={handleLogout}
                  />
                )}
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