const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yantraCanvas', {
  load: () => ipcRenderer.invoke('canvas:load'),
  save: (document) => ipcRenderer.invoke('canvas:save', document),
  status: () => ipcRenderer.invoke('canvas:status'),
});
