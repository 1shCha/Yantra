const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const CANVAS_FILE_NAME = 'default.canvas';
const CLOSE_FLUSH_TIMEOUT_MS = 3000;

let nextCloseFlushRequestId = 1;

function createEmptyJsonCanvasDocument() {
  return {
    nodes: [],
    edges: [],
  };
}

function getCanvasFilePath() {
  return path.join(app.getPath('userData'), CANVAS_FILE_NAME);
}

function assertJsonCanvasDocument(document) {
  if (
    !document ||
    typeof document !== 'object' ||
    !Array.isArray(document.nodes) ||
    !Array.isArray(document.edges)
  ) {
    throw new Error('Canvas document must contain nodes and edges arrays.');
  }
}

async function loadCanvasDocument() {
  const filePath = getCanvasFilePath();

  try {
    const file = await fs.readFile(filePath, 'utf8');
    const document = JSON.parse(file);
    assertJsonCanvasDocument(document);

    return {
      document,
      filePath,
      exists: true,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        document: createEmptyJsonCanvasDocument(),
        filePath,
        exists: false,
      };
    }

    throw error;
  }
}

async function saveCanvasDocument(document) {
  assertJsonCanvasDocument(document);

  const filePath = getCanvasFilePath();
  const temporaryPath = `${filePath}.tmp`;
  const content = `${JSON.stringify(document, null, 2)}\n`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);

  return {
    filePath,
    savedAt: new Date().toISOString(),
  };
}

function registerCanvasIpcHandlers() {
  ipcMain.handle('canvas:load', () => loadCanvasDocument());
  ipcMain.handle('canvas:save', (_event, document) => saveCanvasDocument(document));
  ipcMain.handle('canvas:status', () => ({
    filePath: getCanvasFilePath(),
  }));
}

function requestCanvasFlushBeforeClose(window) {
  if (window.webContents.isDestroyed()) {
    return Promise.resolve();
  }

  const requestId = nextCloseFlushRequestId;
  nextCloseFlushRequestId += 1;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.off('canvas:close-flush-complete', handleComplete);
      console.error('Timed out while waiting for canvas flush before close.');
      resolve();
    }, CLOSE_FLUSH_TIMEOUT_MS);

    function handleComplete(_event, completedRequestId, result) {
      if (completedRequestId !== requestId) {
        return;
      }

      clearTimeout(timeout);
      ipcMain.off('canvas:close-flush-complete', handleComplete);

      if (result?.error) {
        console.error('Unable to flush canvas before close.', result.error);
      }

      resolve();
    }

    ipcMain.on('canvas:close-flush-complete', handleComplete);
    window.webContents.send('canvas:flush-before-close', requestId);
  });
}

function installCloseFlushHandler(window) {
  let isCloseAllowed = false;

  window.on('close', (event) => {
    if (isCloseAllowed) {
      return;
    }

    event.preventDefault();

    requestCanvasFlushBeforeClose(window).finally(() => {
      if (window.isDestroyed()) {
        return;
      }

      isCloseAllowed = true;
      window.close();
    });
  });
}

async function loadRenderer(window, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await window.loadURL(DEV_SERVER_URL);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await window.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: 'Yantra',
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  installCloseFlushHandler(mainWindow);
  loadRenderer(mainWindow);
}

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
