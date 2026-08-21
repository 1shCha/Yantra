const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yantraCanvas', {
  load: () => ipcRenderer.invoke('canvas:load'),
  onBeforeClose: (callback) => {
    const listener = (_event, requestId) => {
      Promise.resolve()
        .then(callback)
        .then(
          () => {
            ipcRenderer.send('canvas:close-flush-complete', requestId, { ok: true });
          },
          (error) => {
            ipcRenderer.send('canvas:close-flush-complete', requestId, {
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
    };

    ipcRenderer.on('canvas:flush-before-close', listener);

    return () => {
      ipcRenderer.off('canvas:flush-before-close', listener);
    };
  },
  save: (document) => ipcRenderer.invoke('canvas:save', document),
  status: () => ipcRenderer.invoke('canvas:status'),
});
