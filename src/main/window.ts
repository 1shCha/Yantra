import path from 'node:path';

import { app, BrowserWindow, shell } from 'electron';

import { installCloseFlushHandler } from './close-flush';

import { loadRenderer } from './renderer-loader';

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: 'Yantra',
    transparent: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const publishFullscreenState = () => {
    mainWindow.webContents.send('window:fullscreen-change', mainWindow.isFullScreen());
  };

  mainWindow.on('enter-full-screen', publishFullscreenState);
  mainWindow.on('leave-full-screen', publishFullscreenState);

  installCloseFlushHandler(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
  });
  void loadRenderer(mainWindow, { isPackaged: app.isPackaged, development: process.env.YANTRA_DEV_SERVER === '1',
    filePath: path.join(__dirname, '..', 'dist', 'index.html') });
}
