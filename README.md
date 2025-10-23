# Opine Interviewer App

A React Native mobile application for interviewers to conduct surveys using the Opine platform. This app provides native GPS access and audio recording capabilities that are essential for Computer-Assisted Personal Interviewing (CAPI).

## Features

### 🔐 Authentication
- Secure login for interviewers only
- Role-based access control
- Token-based authentication

### 📱 Interviewer Dashboard
- Overview of available surveys
- Recent interview history
- Quick access to all features
- Real-time statistics

### 📊 Available Surveys
- Browse all available surveys
- Filter by survey mode (CAPI, CATI, Online)
- Search functionality
- Survey details and metadata

### 🎤 Interview Interface
- **Native GPS Location**: Direct access to device GPS for accurate location tracking
- **Audio Recording**: High-quality audio recording for CAPI interviews
- **Multiple Question Types**: Text, multiple choice, single choice, rating, date, number
- **Progress Tracking**: Real-time progress and duration tracking
- **Auto-save**: Automatic progress saving
- **Location Verification**: Required location capture for CAPI interviews

### 📋 My Interviews
- View all interview history
- Filter by status (in-progress, completed, submitted)
- Continue incomplete interviews
- View interview details and statistics

### 🎨 Modern Design
- Material Design 3 components
- Responsive layout for all device sizes
- Premium UI/UX standards
- Smooth animations and transitions

## Technical Features

### 📍 Location Services
- **High Accuracy GPS**: Primary location detection method
- **WiFi Triangulation**: Fallback for indoor locations
- **Network Location**: Additional fallback option
- **Reverse Geocoding**: Automatic address resolution
- **Location Validation**: Ensures accurate location capture

### 🎵 Audio Recording
- **High Quality Recording**: Optimized for mobile devices
- **Automatic Upload**: Seamless audio file upload to backend
- **Permission Handling**: Proper microphone permission management
- **Background Recording**: Continues recording during app usage

### 🔄 Data Synchronization
- **Real-time Sync**: Automatic data synchronization with backend
- **Offline Support**: Local data storage for offline scenarios
- **Conflict Resolution**: Handles data conflicts gracefully
- **Progress Persistence**: Never lose interview progress

## Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Expo CLI
- Expo Go app on your mobile device

### Installation

1. **Clone and navigate to the project:**
   ```bash
   cd /var/www/Opine-Android
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run start:tunnel
   ```

4. **Open in Expo Go:**
   - Install Expo Go app on your mobile device
   - Scan the QR code displayed in the terminal
   - The app will load on your device

### Development Commands

```bash
# Start with tunnel (recommended for testing)
npm run start:tunnel

# Start normally
npm start

# Start for Android
npm run android

# Start for iOS (requires macOS)
npm run ios

# Start for web
npm run web
```

## Configuration

### Backend API
The app is configured to connect to the Opine backend at:
```
https://opine.exypnossolutions.com
```

### Environment Variables
Create a `.env` file in the root directory:
```
API_BASE_URL=https://opine.exypnossolutions.com
```

## Usage

### For Interviewers

1. **Login**: Use your interviewer credentials to log in
2. **Browse Surveys**: View available surveys in the dashboard
3. **Start Interview**: Select a survey and begin the interview
4. **Location Access**: Grant location permissions when prompted
5. **Audio Recording**: Allow microphone access for CAPI interviews
6. **Complete Interview**: Answer all questions and submit

### Survey Modes

- **CAPI (Computer-Assisted Personal Interviewing)**: Requires GPS location and audio recording
- **CATI (Computer-Assisted Telephone Interviewing)**: Phone-based interviews
- **Online**: Web-based surveys

## Architecture

### Project Structure
```
src/
├── components/          # Reusable UI components
├── screens/            # Main app screens
│   ├── SplashScreen.tsx
│   ├── LoginScreen.tsx
│   ├── InterviewerDashboard.tsx
│   ├── AvailableSurveys.tsx
│   ├── MyInterviews.tsx
│   └── InterviewInterface.tsx
├── services/           # API and external services
│   └── api.ts
├── theme/              # App theming
│   └── theme.ts
├── types/              # TypeScript type definitions
│   └── index.ts
└── utils/              # Utility functions
    └── location.ts
```

### Key Technologies
- **React Native**: Cross-platform mobile development
- **Expo**: Development platform and tools
- **TypeScript**: Type-safe JavaScript
- **React Navigation**: Navigation library
- **React Native Paper**: Material Design components
- **Expo Location**: Native location services
- **Expo AV**: Audio recording and playback
- **Axios**: HTTP client for API calls

## Troubleshooting

### Common Issues

1. **Location not working:**
   - Ensure location services are enabled on device
   - Grant location permissions to the app
   - Try moving to an area with better GPS signal

2. **Audio recording issues:**
   - Grant microphone permissions
   - Ensure no other apps are using the microphone
   - Check device storage space

3. **Connection issues:**
   - Verify internet connection
   - Check if backend server is running
   - Try using tunnel mode: `npm run start:tunnel`

### Debug Mode
Enable debug mode by adding to your device's developer options or using Expo DevTools.

## Contributing

1. Follow the existing code style and patterns
2. Add TypeScript types for all new features
3. Test on both Android and iOS devices
4. Ensure proper error handling and user feedback

## Support

For technical support or questions:
- Check the troubleshooting section above
- Review the console logs for error messages
- Ensure all dependencies are properly installed

## License

This project is proprietary software for the Opine platform.

