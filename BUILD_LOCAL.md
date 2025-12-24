# Building APK Locally (Without EAS Subscription)

## Quick Setup Guide

### Step 1: Install Java JDK 17
```bash
sudo apt update
sudo apt install openjdk-17-jdk -y
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$JAVA_HOME/bin
```

### Step 2: Install Android SDK Command Line Tools
```bash
cd ~
mkdir -p android-sdk
cd android-sdk
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-11076708_latest.zip
mkdir -p cmdline-tools/latest
mv cmdline-tools/* cmdline-tools/latest/ 2>/dev/null || true
rm commandlinetools-linux-11076708_latest.zip
```

### Step 3: Set Environment Variables
```bash
export ANDROID_HOME=$HOME/android-sdk
export ANDROID_SDK_ROOT=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
```

### Step 4: Install Android SDK Components
```bash
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

### Step 5: Prebuild Native Folders
```bash
cd /var/www/Opine-Android
npx expo prebuild --platform android
```

### Step 6: Build APK Locally
```bash
cd /var/www/Opine-Android/android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

---

## Alternative: Use EAS Build --local (Easier)

This method uses Docker-like containers but builds on your machine:

```bash
cd /var/www/Opine-Android
npx eas-cli build --platform android --profile preview --local
```

**Note:** This still requires Docker or Android SDK setup.

---

## Simplest Alternative: Build on Another Machine

If you have access to:
- A Windows/Mac machine with Android Studio installed
- Or a development machine with Android SDK

You can:
1. Copy the project folder
2. Run `npx eas-cli build --platform android --profile preview --local`
3. It will build locally without subscription limits

---

## Troubleshooting

### If Android SDK installation fails:
- Make sure you have enough disk space (Android SDK needs ~5GB)
- Check internet connection (downloads large files)
- Try installing Android Studio instead (includes SDK)

### If build fails:
- Check Java version: `java -version` (should be 17+)
- Verify ANDROID_HOME: `echo $ANDROID_HOME`
- Check Gradle: `cd android && ./gradlew --version`











