(function () {
  const FILE_NAME = 'budget-data.v1.json';
  const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const GOOGLE_CLIENT_ID_KEY = 'budget.google.clientId';
  const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder';
  const ONEDRIVE_CLIENT_ID_KEY = 'budget.onedrive.clientId';
  const MODE_KEY = 'budget.storage.mode';
  const FILE_ID_KEY = 'budget.google.fileId';
  const OAUTH_STATE_KEY = 'budget.google.oauthState';
  const DB_NAME = 'budget-app-cache';
  const STORE_NAME = 'kv';

  const state = {
    mode: localStorage.getItem(MODE_KEY) || 'local',
    clientId: localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || '',
    oneDriveClientId: localStorage.getItem(ONEDRIVE_CLIENT_ID_KEY) || '',
    fileId: localStorage.getItem(FILE_ID_KEY) || '',
    accessToken: '',
    oneDriveAccessToken: '',
    tokenClient: null,
    msalApp: null,
    oneDriveItemId: '',
    oneDriveETag: '',
    remoteModifiedTime: '',
    syncStatus: 'Local only',
    syncDetail: ''
  };

  let nativeAuthPlugin = null;
  const listeners = new Set();

  function emitStatus(status, detail = '') {
    state.syncStatus = status;
    state.syncDetail = detail;
    const snapshot = getInfo();
    listeners.forEach(listener => listener(snapshot));
  }

  function getInfo() {
    return {
      mode: state.mode,
      clientId: state.clientId,
      oneDriveClientId: state.oneDriveClientId,
      signedIn: Boolean(state.accessToken || state.oneDriveAccessToken),
      fileId: state.fileId,
      oneDriveItemId: state.oneDriveItemId,
      status: state.syncStatus,
      detail: state.syncDetail,
      remoteModifiedTime: state.remoteModifiedTime
    };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function loadCache() {
    try {
      const cached = await idbGet('budget-data');
      if (cached?.data) return cached;
    } catch (err) {
      console.warn('[budget] cache load failed', err);
    }
    return null;
  }

  async function saveCache(data, meta = {}) {
    try {
      await idbSet('budget-data', {
        data,
        meta,
        cachedAt: new Date().toISOString()
      });
    } catch (err) {
      console.warn('[budget] cache save failed', err);
    }
  }

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google Identity Services could not be loaded.'));
      document.head.appendChild(script);
    });
  }

  function getNativeAuth() {
    if (nativeAuthPlugin) return nativeAuthPlugin;
    const capacitor = window.Capacitor;
    if (!capacitor) return null;

    nativeAuthPlugin = capacitor.Plugins?.NativeAuth || capacitor.registerPlugin?.('NativeAuth') || null;
    return nativeAuthPlugin;
  }

  function getGoogleRedirectUri() {
    return new URL('oauth.html', window.location.href.split('#')[0]).href;
  }

  function createNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function parseOAuthCallback(url) {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, ''));
    const error = params.get('error');
    if (error) throw new Error(params.get('error_description') || error);

    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    const actualState = params.get('state');
    if (!expectedState || actualState !== expectedState) {
      throw new Error('Google sign-in returned an invalid state. Try again.');
    }

    const token = params.get('access_token');
    if (!token) throw new Error('Google did not return an access token.');
    return token;
  }

  async function requestNativeToken() {
    const nativeAuth = getNativeAuth();
    if (!nativeAuth) throw new Error('Native sign-in is not available in this app.');
    if (!state.clientId) throw new Error('Add a Google OAuth Client ID first.');

    const oauthState = createNonce();
    sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
    const params = new URLSearchParams({
      client_id: state.clientId,
      redirect_uri: getGoogleRedirectUri(),
      response_type: 'token',
      scope: GOOGLE_DRIVE_SCOPE,
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: oauthState
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return new Promise(async (resolve, reject) => {
      let listener = null;
      const cleanup = () => {
        sessionStorage.removeItem(OAUTH_STATE_KEY);
        listener?.remove?.();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Google sign-in timed out. Try again.'));
      }, 120000);

      try {
        listener = await nativeAuth.addListener('oauthComplete', event => {
          try {
            clearTimeout(timer);
            const token = parseOAuthCallback(event.url || '');
            state.accessToken = token;
            cleanup();
            resolve(token);
          } catch (err) {
            cleanup();
            reject(err);
          }
        });
        await nativeAuth.open({ url: authUrl });
      } catch (err) {
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    });
  }

  async function requestToken(prompt = 'consent') {
    if (!state.clientId) throw new Error('Add a Google OAuth Client ID first.');
    if (getNativeAuth()) return requestNativeToken();
    await loadGis();

    return new Promise((resolve, reject) => {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: state.clientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: response => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          state.accessToken = response.access_token;
          resolve(response.access_token);
        }
      });

      state.tokenClient.requestAccessToken({ prompt });
    });
  }

  async function prepareGoogleAuth() {
    if (!state.clientId) throw new Error('Add a Google OAuth Client ID first.');
    if (getNativeAuth()) {
      emitStatus('Android sign-in ready', 'Tap Sign in with Google.');
      return true;
    }
    emitStatus('Loading Google sign-in...');
    await loadGis();
    emitStatus('Google sign-in ready', 'Tap Sign in with Google.');
    return true;
  }

  async function driveFetch(url, options = {}) {
    if (!state.accessToken) await requestToken('consent');
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      state.accessToken = '';
      await requestToken('consent');
      return driveFetch(url, options);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Drive request failed (${res.status}): ${text || res.statusText}`);
    }
    return res;
  }

  function escapeDriveQuery(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function findDriveFile() {
    const q = encodeURIComponent(`name='${escapeDriveQuery(FILE_NAME)}' and trashed=false`);
    const fields = encodeURIComponent('files(id,name,modifiedTime,version,size)');
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=${fields}&pageSize=10`);
    const json = await res.json();
    const file = json.files?.[0] || null;
    if (file) {
      state.fileId = file.id;
      state.remoteModifiedTime = file.modifiedTime || '';
      localStorage.setItem(FILE_ID_KEY, file.id);
    }
    return file;
  }

  async function getDriveMetadata(fileId = state.fileId) {
    if (!fileId) return null;
    const fields = encodeURIComponent('id,name,modifiedTime,version,size');
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`);
    return res.json();
  }

  async function createDriveFile(data) {
    const boundary = `budget_boundary_${Date.now()}`;
    const metadata = { name: FILE_NAME, parents: ['appDataFolder'] };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(data, null, 2),
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const fields = encodeURIComponent('id,name,modifiedTime,version');
    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fields}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const file = await res.json();
    state.fileId = file.id;
    state.remoteModifiedTime = file.modifiedTime || '';
    localStorage.setItem(FILE_ID_KEY, file.id);
    return file;
  }

  async function downloadDriveFile(fileId = state.fileId) {
    if (!fileId) return null;
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const data = await res.json();
    const meta = await getDriveMetadata(fileId);
    state.remoteModifiedTime = meta?.modifiedTime || state.remoteModifiedTime;
    await saveCache(data, { source: 'google-drive', fileId, modifiedTime: state.remoteModifiedTime });
    return { data, meta };
  }

  async function uploadDriveFile(data, options = {}) {
    if (!state.fileId) {
      const existing = await findDriveFile();
      if (!existing) return createDriveFile(data);
    }

    if (!options.force && state.remoteModifiedTime) {
      const remote = await getDriveMetadata();
      if (remote?.modifiedTime && remote.modifiedTime !== state.remoteModifiedTime) {
        await saveCache(data, { source: 'local-conflict', conflictedAt: new Date().toISOString() });
        emitStatus('Sync conflict', 'Google Drive changed on another device. Load remote or force upload from Settings.');
        throw new Error('Google Drive has a newer copy.');
      }
    }

    const fields = encodeURIComponent('id,name,modifiedTime,version');
    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${state.fileId}?uploadType=media&fields=${fields}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data, null, 2)
    });
    const file = await res.json();
    state.remoteModifiedTime = file.modifiedTime || '';
    await saveCache(data, { source: 'google-drive', fileId: state.fileId, modifiedTime: state.remoteModifiedTime });
    return file;
  }

  function loadMsal() {
    if (window.msal?.PublicClientApplication) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-msal-browser]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
      script.async = true;
      script.defer = true;
      script.dataset.msalBrowser = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Microsoft sign-in library could not be loaded.'));
      document.head.appendChild(script);
    });
  }

  async function getMsalApp() {
    if (!state.oneDriveClientId) throw new Error('Add a Microsoft Entra Application Client ID first.');
    await loadMsal();
    if (!state.msalApp) {
      state.msalApp = new msal.PublicClientApplication({
        auth: {
          clientId: state.oneDriveClientId,
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: window.location.href.split('#')[0]
        },
        cache: {
          cacheLocation: 'localStorage',
          storeAuthStateInCookie: false
        }
      });
    }
    return state.msalApp;
  }

  async function requestOneDriveToken(interactive = true) {
    const app = await getMsalApp();
    const scopes = [ONEDRIVE_SCOPE];
    const accounts = app.getAllAccounts();
    const account = accounts[0] || null;

    if (account) {
      try {
        const result = await app.acquireTokenSilent({ scopes, account });
        state.oneDriveAccessToken = result.accessToken;
        return result.accessToken;
      } catch (err) {
        if (!interactive) throw err;
      }
    }

    if (!interactive) throw new Error('Sign in to OneDrive first.');
    const result = await app.loginPopup({ scopes, prompt: 'select_account' });
    state.oneDriveAccessToken = result.accessToken;
    return result.accessToken;
  }

  async function graphFetch(url, options = {}) {
    if (!state.oneDriveAccessToken) await requestOneDriveToken(true);
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${state.oneDriveAccessToken}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      state.oneDriveAccessToken = '';
      await requestOneDriveToken(true);
      return graphFetch(url, options);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`OneDrive request failed (${res.status}): ${text || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function getOneDriveMetadata() {
    try {
      const res = await graphFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE_NAME}`);
      const item = await res.json();
      state.oneDriveItemId = item.id || '';
      state.oneDriveETag = item.eTag || item.cTag || '';
      state.remoteModifiedTime = item.lastModifiedDateTime || '';
      return item;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function downloadOneDriveFile() {
    const meta = await getOneDriveMetadata();
    if (!meta) return null;
    const res = await graphFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE_NAME}:/content`);
    const data = await res.json();
    await saveCache(data, {
      source: 'onedrive',
      itemId: state.oneDriveItemId,
      eTag: state.oneDriveETag,
      modifiedTime: state.remoteModifiedTime
    });
    return { data, meta };
  }

  async function uploadOneDriveFile(data, options = {}) {
    if (!options.force && state.oneDriveETag) {
      const remote = await getOneDriveMetadata();
      const remoteTag = remote?.eTag || remote?.cTag || '';
      if (remoteTag && remoteTag !== state.oneDriveETag) {
        await saveCache(data, { source: 'local-conflict', conflictedAt: new Date().toISOString() });
        emitStatus('Sync conflict', 'OneDrive changed on another device. Load remote or force upload from Settings.');
        throw new Error('OneDrive has a newer copy.');
      }
    }

    const res = await graphFetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE_NAME}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data, null, 2)
    });
    const item = await res.json();
    state.oneDriveItemId = item.id || '';
    state.oneDriveETag = item.eTag || item.cTag || '';
    state.remoteModifiedTime = item.lastModifiedDateTime || '';
    await saveCache(data, {
      source: 'onedrive',
      itemId: state.oneDriveItemId,
      eTag: state.oneDriveETag,
      modifiedTime: state.remoteModifiedTime
    });
    return item;
  }

  async function load() {
    if (window.api) {
      const data = await window.api.loadData();
      if (data) await saveCache(data, { source: 'electron' });
      emitStatus(state.mode === 'local' ? 'Local desktop data' : 'Cached desktop data loaded');
      return data;
    }

    const cached = await loadCache();
    if (cached?.data) {
      emitStatus(state.mode === 'local' ? 'Browser cache loaded' : 'Offline cache loaded');
      return cached.data;
    }

    emitStatus(state.mode === 'local' ? 'No local data yet' : 'Sign in to sync');
    return null;
  }

  async function save(data, options = {}) {
    await saveCache(data, { source: 'local-cache' });

    if (window.api) {
      const ok = await window.api.saveData(data);
      emitStatus(state.mode === 'local' ? 'Saved locally' : 'Saved locally; sync from web app');
      return ok;
    }

    if (state.mode === 'local') {
      emitStatus('Saved to browser cache');
      return true;
    }

    if (state.mode === 'google' && !state.clientId) {
      emitStatus('Google sync not configured', 'Add a Client ID in Settings.');
      return false;
    }

    if (state.mode === 'onedrive' && !state.oneDriveClientId) {
      emitStatus('OneDrive sync not configured', 'Add a Microsoft Client ID in Settings.');
      return false;
    }

    if (state.mode === 'google' && !state.accessToken) {
      emitStatus('Saved offline', 'Sign in to upload changes to Google Drive.');
      return false;
    }

    if (state.mode === 'onedrive' && !state.oneDriveAccessToken) {
      emitStatus('Saved offline', 'Sign in to upload changes to OneDrive.');
      return false;
    }

    emitStatus('Syncing...');
    if (state.mode === 'google') {
      await uploadDriveFile(data, options);
      emitStatus('Synced to Google Drive', new Date().toLocaleTimeString());
    } else if (state.mode === 'onedrive') {
      await uploadOneDriveFile(data, options);
      emitStatus('Synced to OneDrive', new Date().toLocaleTimeString());
    }
    return true;
  }

  async function connectGoogle(currentData) {
    state.mode = 'google';
    localStorage.setItem(MODE_KEY, 'google');
    emitStatus('Opening Google sign-in...');
    await requestToken('consent');
    emitStatus('Connected to Google Drive');

    const file = await findDriveFile();
    if (file) {
      emitStatus('Loading Google Drive data...');
      const remote = await downloadDriveFile(file.id);
      emitStatus('Loaded from Google Drive', remote.meta?.modifiedTime || '');
      return { ...remote, foundRemote: true };
    }

    emitStatus('Creating Google Drive data file...');
    const created = await createDriveFile(currentData);
    await saveCache(currentData, { source: 'google-drive', fileId: created.id, modifiedTime: created.modifiedTime });
    emitStatus('Google Drive sync ready');
    return { data: currentData, meta: created, foundRemote: false };
  }

  async function pullGoogle() {
    if (!state.accessToken) await requestToken('consent');
    const file = state.fileId ? await getDriveMetadata() : await findDriveFile();
    if (!file) return null;
    emitStatus('Loading Google Drive data...');
    const remote = await downloadDriveFile(file.id);
    emitStatus('Loaded from Google Drive', remote.meta?.modifiedTime || '');
    return remote;
  }

  async function connectOneDrive(currentData) {
    state.mode = 'onedrive';
    localStorage.setItem(MODE_KEY, 'onedrive');
    emitStatus('Opening Microsoft sign-in...');
    await requestOneDriveToken(true);
    emitStatus('Connected to OneDrive');

    const remote = await downloadOneDriveFile();
    if (remote) {
      emitStatus('Loaded from OneDrive', remote.meta?.lastModifiedDateTime || '');
      return { ...remote, foundRemote: true };
    }

    emitStatus('Creating OneDrive data file...');
    const created = await uploadOneDriveFile(currentData, { force: true });
    emitStatus('OneDrive sync ready');
    return { data: currentData, meta: created, foundRemote: false };
  }

  async function pullOneDrive() {
    await requestOneDriveToken(true);
    emitStatus('Loading OneDrive data...');
    const remote = await downloadOneDriveFile();
    if (remote) emitStatus('Loaded from OneDrive', remote.meta?.lastModifiedDateTime || '');
    else emitStatus('No OneDrive data file yet');
    return remote;
  }

  function configureGoogle(clientId) {
    state.clientId = String(clientId || '').trim();
    if (state.clientId) localStorage.setItem(GOOGLE_CLIENT_ID_KEY, state.clientId);
    else localStorage.removeItem(GOOGLE_CLIENT_ID_KEY);
    emitStatus(state.clientId ? 'Google Client ID saved' : 'Google Client ID removed');
  }

  function configureOneDrive(clientId) {
    state.oneDriveClientId = String(clientId || '').trim();
    state.msalApp = null;
    if (state.oneDriveClientId) localStorage.setItem(ONEDRIVE_CLIENT_ID_KEY, state.oneDriveClientId);
    else localStorage.removeItem(ONEDRIVE_CLIENT_ID_KEY);
    emitStatus(state.oneDriveClientId ? 'Microsoft Client ID saved' : 'Microsoft Client ID removed');
  }

  function disconnectGoogle() {
    state.mode = 'local';
    state.accessToken = '';
    state.oneDriveAccessToken = '';
    localStorage.setItem(MODE_KEY, 'local');
    emitStatus('Local only');
  }

  async function getDataLocation() {
    if (window.api) return window.api.getDataPath();
    if (state.mode === 'google') return state.fileId ? `Google Drive appDataFolder / ${FILE_NAME}` : 'Google Drive appDataFolder';
    if (state.mode === 'onedrive') return state.oneDriveItemId ? `OneDrive Apps/Budget / ${FILE_NAME}` : 'OneDrive Apps/Budget';
    return 'Browser IndexedDB cache';
  }

  function openUrl(url) {
    if (window.api?.openUrl) return window.api.openUrl(url);
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }

  window.dataStore = {
    load,
    save,
    connectGoogle,
    pullGoogle,
    configureGoogle,
    prepareGoogleAuth,
    connectOneDrive,
    pullOneDrive,
    configureOneDrive,
    disconnectGoogle,
    getDataLocation,
    getInfo,
    openUrl,
    onStatus(listener) {
      listeners.add(listener);
      listener(getInfo());
      return () => listeners.delete(listener);
    }
  };
})();
