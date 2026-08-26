import path from 'node:path';

import { BrowserWindow, shell } from 'electron';

import { installCloseFlushHandler } from './close-flush';

const DEV_SERVER_URL = 'http://127.0.0.1:5173';

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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
  void loadRenderer(mainWindow);
}
