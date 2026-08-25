import path from 'node:path';

import { BrowserWindow } from 'electron';

import { installCloseFlushHandler } from './close-flush';

const DEV_SERVER_URL = 'http://127.0.0.1:5173';

async function loadRenderer(window: BrowserWindow, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await window.loadURL(DEV_SERVER_URL);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: 'Yantra',
    transparent: false,
    backgroundColor: '#fafcff',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  installCloseFlushHandler(mainWindow);
  void loadRenderer(mainWindow);
}
