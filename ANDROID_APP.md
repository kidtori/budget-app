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

The Android wrapper loads the hosted GitHub Pages app:

```text
https://kidtori.github.io/budget-app/
```

This lets Google Identity Services run from the same HTTPS origin used by the browser/PWA version.

Make sure the Google OAuth Web Client has this authorized JavaScript origin:

```text
https://kidtori.github.io
```

It also uses the phone browser for Android sign-in and returns to the app with this redirect page. Add it as an authorized redirect URI:

```text
https://kidtori.github.io/budget-app/oauth.html
```

After installing a rebuilt APK, the app opens Google sign-in in the browser and then deep-links back into Budget.
