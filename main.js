const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Paths ──────────────────────────────────────────────────────────────────
let DATA_PATH;
let BACKUP_PATH;

function initPaths() {
  // When running as a portable exe, store data next to the exe so the
  // whole folder (exe + data) can be moved to any machine.
  const dir = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
  DATA_PATH   = path.join(dir, 'budget-data.json');
  BACKUP_PATH = path.join(dir, 'budget-data.backup.json');
}

// ── Validation ─────────────────────────────────────────────────────────────
function isValid(d) {
  return d && typeof d === 'object' && Array.isArray(d.banks) && typeof d.exchangeRates === 'object';
}

// ── Load ────────────────────────────────────────────────────────────────────
function loadData() {
  for (const p of [DATA_PATH, BACKUP_PATH]) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (isValid(parsed)) return parsed;
    } catch (e) {
      console.warn('[budget] failed to parse', p, e.message);
    }
  }
  return { banks: [], exchangeRates: { EUR: 1, USD: 0.92, GBP: 1.17 }, preferredCurrency: 'EUR' };
}

// ── Save (atomic) ──────────────────────────────────────────────────────────
function saveData(data) {
  if (!isValid(data)) return false;
  const tmp = DATA_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try { if (fs.existsSync(DATA_PATH)) fs.copyFileSync(DATA_PATH, BACKUP_PATH); } catch (_) {}
    fs.renameSync(tmp, DATA_PATH);
    return true;
  } catch (e) {
    console.error('[budget] save failed:', e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 960, height: 700, minWidth: 700, minHeight: 500,
    backgroundColor: '#f0f2f5', show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'), sandbox: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Budget'
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  initPaths();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('load-data',     ()        => loadData());
ipcMain.handle('save-data',     (_, data) => saveData(data));
ipcMain.handle('get-data-path', ()        => DATA_PATH);
ipcMain.handle('open-url',      (_, url)  => shell.openExternal(url));
