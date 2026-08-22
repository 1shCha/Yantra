import { ipcMain, type BrowserWindow } from 'electron';

import { CANVAS_CHANNELS, type CloseFlushResult } from '../shared/canvas-api';

const CLOSE_FLUSH_TIMEOUT_MS = 3000;

let nextCloseFlushRequestId = 1;

function requestCanvasFlushBeforeClose(window: BrowserWindow): Promise<void> {
  if (window.webContents.isDestroyed()) {
    return Promise.resolve();
  }

  const requestId = nextCloseFlushRequestId;
  nextCloseFlushRequestId += 1;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.off(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, handleComplete);
      console.error('Timed out while waiting for canvas flush before close.');
      resolve();
    }, CLOSE_FLUSH_TIMEOUT_MS);

    function handleComplete(
      _event: Electron.IpcMainEvent,
      completedRequestId: number,
      result: CloseFlushResult,
    ): void {
      if (completedRequestId !== requestId) {
        return;
      }

      clearTimeout(timeout);
      ipcMain.off(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, handleComplete);

      if (result.error) {
        console.error('Unable to flush canvas before close.', result.error);
      }

      resolve();
    }

    ipcMain.on(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, handleComplete);
    window.webContents.send(CANVAS_CHANNELS.FLUSH_BEFORE_CLOSE, requestId);
  });
}

export function installCloseFlushHandler(window: BrowserWindow): void {
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
