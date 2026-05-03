(function () {
  const FILE_NAME = 'budget-data.v1.json';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const CLIENT_ID_KEY = 'budget.google.clientId';
  const MODE_KEY = 'budget.storage.mode';
  const FILE_ID_KEY = 'budget.google.fileId';
  const DB_NAME = 'budget-app-cache';
  const STORE_NAME = 'kv';

  const state = {
    mode: localStorage.getItem(MODE_KEY) || 'local',
    clientId: localStorage.getItem(CLIENT_ID_KEY) || '',
    fileId: localStorage.getItem(FILE_ID_KEY) || '',
    accessToken: '',
    tokenClient: null,
    remoteModifiedTime: '',
    syncStatus: 'Local only',
    syncDetail: ''
  };

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
      signedIn: Boolean(state.accessToken),
      fileId: state.fileId,
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

  async function requestToken(prompt = 'consent') {
    if (!state.clientId) throw new Error('Add a Google OAuth Client ID first.');
    await loadGis();

    return new Promise((resolve, reject) => {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: state.clientId,
        scope: DRIVE_SCOPE,
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

  async function load() {
    if (window.api) {
      const data = await window.api.loadData();
      if (data) await saveCache(data, { source: 'electron' });
      emitStatus(state.mode === 'google' ? 'Cached desktop data loaded' : 'Local desktop data');
      return data;
    }

    const cached = await loadCache();
    if (cached?.data) {
      emitStatus(state.mode === 'google' ? 'Offline cache loaded' : 'Browser cache loaded');
      return cached.data;
    }

    emitStatus(state.mode === 'google' ? 'Sign in to sync' : 'No local data yet');
    return null;
  }

  async function save(data, options = {}) {
    await saveCache(data, { source: 'local-cache' });

    if (window.api) {
      const ok = await window.api.saveData(data);
      emitStatus(state.mode === 'google' ? 'Saved locally; sync from web app' : 'Saved locally');
      return ok;
    }

    if (state.mode !== 'google') {
      emitStatus('Saved to browser cache');
      return true;
    }

    if (!state.clientId) {
      emitStatus('Google sync not configured', 'Add a Client ID in Settings.');
      return false;
    }

    if (!state.accessToken) {
      emitStatus('Saved offline', 'Sign in to upload changes to Google Drive.');
      return false;
    }

    emitStatus('Syncing...');
    await uploadDriveFile(data, options);
    emitStatus('Synced to Google Drive', new Date().toLocaleTimeString());
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

  function configureGoogle(clientId) {
    state.clientId = String(clientId || '').trim();
    if (state.clientId) localStorage.setItem(CLIENT_ID_KEY, state.clientId);
    else localStorage.removeItem(CLIENT_ID_KEY);
    emitStatus(state.clientId ? 'Google Client ID saved' : 'Google Client ID removed');
  }

  function disconnectGoogle() {
    state.mode = 'local';
    state.accessToken = '';
    localStorage.setItem(MODE_KEY, 'local');
    emitStatus('Local only');
  }

  async function getDataLocation() {
    if (window.api) return window.api.getDataPath();
    if (state.mode === 'google') return state.fileId ? `Google Drive appDataFolder / ${FILE_NAME}` : 'Google Drive appDataFolder';
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
