import { app, BrowserWindow } from 'electron';

import { registerCanvasIpcHandlers } from './canvas-ipc';
import { createWindow } from './window';

app.whenReady().then(() => {
  registerCanvasIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
