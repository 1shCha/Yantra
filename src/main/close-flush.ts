import { ipcMain, type BrowserWindow } from 'electron';
import { CANVAS_CHANNELS, type CloseFlushResult } from '../shared/canvas-api';
import { createCloseHandler, requestCloseFlush } from './close-policy';

let nextRequestId = 1;

export function installCloseFlushHandler(window: BrowserWindow): void {
  window.on('close', createCloseHandler({
    flush: () => {
      if (window.webContents.isDestroyed()) {
        return Promise.reject(new Error('Canvas renderer is unavailable.'));
      }
      return requestCloseFlush({
        send: (requestId) => window.webContents.send(CANVAS_CHANNELS.FLUSH_BEFORE_CLOSE, requestId),
        subscribe: (listener) => {
          const handler = (event: Electron.IpcMainEvent, requestId: number, result: CloseFlushResult) => {
            if (event.sender === window.webContents) listener(requestId, result);
          };
          ipcMain.on(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, handler);
          return () => { ipcMain.off(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, handler); };
        },
      }, nextRequestId++);
    },
    close: () => { if (!window.isDestroyed()) window.close(); },
    // Keep the draft and window open. User-facing choices are a separate UI checkpoint.
    failed: (error) => console.error('Close cancelled because saving did not complete.', error),
  }));
}
