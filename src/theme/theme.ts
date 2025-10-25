import { MD3LightTheme } from 'react-native-paper';

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#2563eb', // Blue
    primaryContainer: '#dbeafe',
    secondary: '#7c3aed', // Purple
    secondaryContainer: '#ede9fe',
    tertiary: '#059669', // Green
    tertiaryContainer: '#d1fae5',
    surface: '#ffffff',
    surfaceVariant: '#f8fafc',
    background: '#f8fafc',
    error: '#dc2626',
    errorContainer: '#fef2f2',
    onPrimary: '#ffffff',
    onSecondary: '#ffffff',
    onTertiary: '#ffffff',
    onSurface: '#1f2937',
    onBackground: '#1f2937',
    onError: '#ffffff',
    outline: '#d1d5db',
    outlineVariant: '#e5e7eb',
    shadow: '#000000',
    scrim: '#000000',
    inverseSurface: '#374151',
    inverseOnSurface: '#f9fafb',
    inversePrimary: '#93c5fd',
    elevation: {
      level0: 'transparent',
      level1: '#ffffff',
      level2: '#ffffff',
      level3: '#ffffff',
      level4: '#ffffff',
      level5: '#ffffff',
    },
  },
  roundness: 12,
  fonts: {
    ...MD3LightTheme.fonts,
    headlineLarge: {
      fontFamily: 'System',
      fontSize: 32,
      fontWeight: '400' as const,
      lineHeight: 40,
    },
    headlineMedium: {
      fontFamily: 'System',
      fontSize: 28,
      fontWeight: '400' as const,
      lineHeight: 36,
    },
    headlineSmall: {
      fontFamily: 'System',
      fontSize: 24,
      fontWeight: '400' as const,
      lineHeight: 32,
    },
    titleLarge: {
      fontFamily: 'System',
      fontSize: 22,
      fontWeight: '400' as const,
      lineHeight: 28,
    },
    titleMedium: {
      fontFamily: 'System',
      fontSize: 16,
      fontWeight: '500' as const,
      lineHeight: 24,
    },
    titleSmall: {
      fontFamily: 'System',
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 20,
    },
    bodyLarge: {
      fontFamily: 'System',
      fontSize: 16,
      fontWeight: '400' as const,
      lineHeight: 24,
    },
    bodyMedium: {
      fontFamily: 'System',
      fontSize: 14,
      fontWeight: '400' as const,
      lineHeight: 20,
    },
    bodySmall: {
      fontFamily: 'System',
      fontSize: 12,
      fontWeight: '400' as const,
      lineHeight: 16,
    },
    labelLarge: {
      fontFamily: 'System',
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 20,
    },
    labelMedium: {
      fontFamily: 'System',
      fontSize: 12,
      fontWeight: '500' as const,
      lineHeight: 16,
    },
    labelSmall: {
      fontFamily: 'System',
      fontSize: 11,
      fontWeight: '500' as const,
      lineHeight: 16,
    },
  },
};


