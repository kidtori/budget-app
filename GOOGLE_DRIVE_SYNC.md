# Google Drive Sync Setup

This app can now run as a browser/PWA app and sync the budget JSON to Google Drive's hidden app data folder.

## Local Web App

Run:

```powershell
cmd /c npm run web
```

Open the printed `http://localhost:4174` URL on this computer. The LAN URL can load on your phone if both devices are on the same network, but Google sign-in for Drive sync should use an HTTPS origin for real phone use.

## Google Cloud Setup

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID with type `Web application`.
5. Add your app origin under Authorized JavaScript origins.
   - For local desktop testing: `http://localhost:4174`
   - For phone/PWA use: deploy the `src` folder to an HTTPS host and add that origin.
6. Copy the Client ID into Budget > Settings > Data > Google OAuth Client ID.
7. Click `Connect Google`.

The app requests only:

```text
https://www.googleapis.com/auth/drive.appdata
```

That scope lets the app read/write only its own hidden app data in your Drive, not your regular Drive files.

## Practical Deployment Choices

- Best simple option: GitHub Pages, Netlify, Cloudflare Pages, or another static HTTPS host.
- Desktop app remains available through Electron with local JSON storage.
- Phone app should use the hosted HTTPS PWA for Google sync.

## Conflict Behavior

The app keeps a browser cache and checks Google Drive's `modifiedTime` before uploading. If another device has changed the Drive copy, it warns about a conflict instead of silently overwriting it. Use `Load remote` or `Sync now` in Settings to resolve it.
