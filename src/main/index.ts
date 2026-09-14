import { app, BrowserWindow } from 'electron';

import { registerVaultIpcHandlers } from './vault-ipc';
import { createWindow } from './window';

app.whenReady().then(() => {
  registerVaultIpcHandlers();
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
