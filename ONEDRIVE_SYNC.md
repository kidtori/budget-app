# OneDrive Sync Setup

This app can sync `budget-data.v1.json` to your private OneDrive app folder through Microsoft Graph.

The data file lives in the app's OneDrive app folder, usually:

```text
OneDrive / Apps / Budget / budget-data.v1.json
```

The app requests only:

```text
Files.ReadWrite.AppFolder
```

That permission lets the app read/write files in its own app folder, not your whole OneDrive.

## Microsoft Entra Setup

1. Go to the Microsoft Entra admin center:
   `https://entra.microsoft.com`
2. Open **Applications** > **App registrations**.
3. Select **New registration**.
4. Name it `Budget`.
5. For supported account types, choose **Personal Microsoft accounts only**.
6. Under **Redirect URI**, choose **Single-page application (SPA)**.
7. Add the redirect URI you are using:
   - Local testing: `http://localhost:4174/`
   - If you open local by IP: `http://127.0.0.1:4174/`
   - Hosted GitHub Pages: `https://kidtori.github.io/budget-app/`
8. Create the registration.
9. Copy the **Application (client) ID**.
10. In Budget, open **Settings** > **Data**.
11. Paste the ID into **Microsoft Client ID** and click **Save ID**.
12. Click **Connect OneDrive**.

## API Permission

If the Microsoft sign-in prompt does not ask for app-folder access automatically:

1. In the app registration, open **API permissions**.
2. Add **Microsoft Graph** > **Delegated permissions**.
3. Add:

```text
Files.ReadWrite.AppFolder
```

For a personal app, user consent during sign-in is usually enough.

## Android Plan

Once OneDrive sync works in the browser, the next step is wrapping the app with Capacitor for Android. Building an APK requires:

- Android Studio
- Android SDK
- Java/JDK

The phone app will use the same Microsoft Client ID and OneDrive app-folder file.
