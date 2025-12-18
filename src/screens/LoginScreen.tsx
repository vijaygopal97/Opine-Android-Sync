import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Card,
  Snackbar,
} from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { apiService } from '../services/api';

const { width, height } = Dimensions.get('window');

interface LoginScreenProps {
  navigation: any;
  onLogin: (userData: any, token: string) => void;
}

export default function LoginScreen({ navigation, onLogin }: LoginScreenProps) {
  const [identifier, setIdentifier] = useState(''); // Can be email or memberId
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const validateIdentifier = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    
    // Check if it's an email (contains @)
    const isEmail = trimmed.includes('@');
    if (isEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(trimmed);
    }
    
    // Check if it's a memberId (alphanumeric, no @)
    const isMemberId = /^[A-Za-z0-9]+$/.test(trimmed);
    return isMemberId;
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      showSnackbar('Please enter both email/Member ID and password');
      return;
    }

    // Validate identifier format
    if (!validateIdentifier(identifier.trim())) {
      showSnackbar('Please provide a valid email address or Member ID');
      return;
    }

    setIsLoading(true);
    try {
      console.log('🔐 Login attempt started');
      const result = await apiService.login(identifier.trim(), password);
      console.log('🔐 Login result:', result.success ? 'SUCCESS' : 'FAILED', result.message);
      
      if (result.success && result.user && result.token) {
        // Check if user is an interviewer or quality agent
        if (result.user.userType !== 'interviewer' && result.user.userType !== 'quality_agent') {
          showSnackbar('Access denied. This app is only for interviewers and quality agents.');
          setIsLoading(false);
          return;
        }
        
        console.log('✅ Login successful, calling onLogin callback');
        onLogin(result.user, result.token);
      } else {
        const errorMsg = result.message || 'Login failed. Please try again.';
        console.error('❌ Login failed:', errorMsg);
        showSnackbar(errorMsg);
      }
    } catch (error: any) {
      console.error('❌ Login exception:', error);
      console.error('❌ Error details:', error.message, error.stack);
      showSnackbar(error.message || 'Login failed. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#001D48', '#373177', '#3FADCC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image 
                  source={require('../../assets/icon.png')} 
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </View>

            {/* Login Form */}
            <Card style={styles.loginCard}>
              <Card.Content style={styles.cardContent}>
                <Text style={styles.formTitle}>Login</Text>
                
                <TextInput
                  label="Email Address or Member ID"
                  value={identifier}
                  onChangeText={setIdentifier}
                  mode="outlined"
                  keyboardType="default"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  left={<TextInput.Icon icon="email" />}
                  placeholder="Enter email or Member ID"
                />
                
                <TextInput
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  mode="outlined"
                  secureTextEntry={!showPassword}
                  style={styles.input}
                  left={<TextInput.Icon icon="lock" />}
                  right={
                    <TextInput.Icon
                      icon={showPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowPassword(!showPassword)}
                    />
                  }
                />
                
                <Button
                  mode="contained"
                  onPress={handleLogin}
                  loading={isLoading}
                  disabled={isLoading}
                  style={styles.loginButton}
                  contentStyle={styles.loginButtonContent}
                >
                  {isLoading ? 'Signing In...' : 'Sign In'}
                </Button>
              </Card.Content>
            </Card>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                Convergent App
              </Text>
              <Text style={styles.footerSubtext}>
                Professional survey interviewing platform
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        style={styles.snackbar}
      >
        {snackbarMessage}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  loginCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  cardContent: {
    padding: 24,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    marginBottom: 16,
  },
  loginButton: {
    marginTop: 16,
    borderRadius: 12,
  },
  loginButtonContent: {
    paddingVertical: 8,
  },
  footer: {
    alignItems: 'center',
    marginTop: 40,
  },
  footerText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  snackbar: {
    backgroundColor: '#dc2626',
  },
});
