const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData:    ()        => ipcRenderer.invoke('load-data'),
  saveData:    (data)    => ipcRenderer.invoke('save-data', data),
  getDataPath: ()        => ipcRenderer.invoke('get-data-path'),
  openUrl:     (url)     => ipcRenderer.invoke('open-url', url)
});
