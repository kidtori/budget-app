# Android App Build

This project is prepared for a Capacitor Android wrapper.

## Install Requirements

Capacitor Android requires:

- Node.js
- Android Studio
- Android SDK

Android Studio installs the JDK used by the Android build.

## First-Time Setup

After Android Studio and the Android SDK are installed:

```powershell
cmd /c npm install
cmd /c npm run android:add
cmd /c npm run android:sync
```

If the `android/` directory already exists, run only:

```powershell
cmd /c npm run android:sync
```

## Build Debug APK

```powershell
cmd /c npm run android:apk
cmd /c npm run android:copy-apk
```

The copied installer will be:

```text
dist/android/Budget-debug.apk
```

Because this project folder is inside OneDrive, that APK will also be easy to find from OneDrive sync on this PC.

## Google OAuth Redirects for Android

The current app uses Google Identity Services in a web view. For testing, keep using the GitHub Pages/PWA version for Google Drive sync until the Android auth flow is verified.

The Android wrapper is the next step toward a real APK, but Google sign-in inside Android WebView may require a native auth plugin or redirect adjustment if Google blocks embedded web sign-in.
