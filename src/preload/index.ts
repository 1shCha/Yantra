import { contextBridge, ipcRenderer } from 'electron';
import { VAULT_CHANNELS, type YantraVaultApi } from '../shared/vault-api';
import { VAULT_TRACE_CHANNEL } from '../shared/vault-trace';

declare const __VAULT_DIAGNOSTICS__: boolean;
if (__VAULT_DIAGNOSTICS__) contextBridge.exposeInMainWorld('yantraVaultTrace', {
  snapshot: () => ipcRenderer.invoke(VAULT_TRACE_CHANNEL),
  clear: () => ipcRenderer.invoke(VAULT_TRACE_CHANNEL, true).then(() => undefined),
});

import {
  CANVAS_CHANNELS,
  type CloseFlushResult,
  type YantraCanvasApi,
} from '../shared/canvas-api';

const yantraCanvas: YantraCanvasApi = {
  onBeforeClose: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: number) => {
      Promise.resolve()
        .then(callback)
        .then(
          () => {
            ipcRenderer.send(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, requestId, {
              ok: true,
            } satisfies CloseFlushResult);
          },
          (error) => {
            ipcRenderer.send(CANVAS_CHANNELS.CLOSE_FLUSH_COMPLETE, requestId, {
              error: error instanceof Error ? error.message : String(error),
            } satisfies CloseFlushResult);
          },
        );
    };

    ipcRenderer.on(CANVAS_CHANNELS.FLUSH_BEFORE_CLOSE, listener);

    return () => {
      ipcRenderer.off(CANVAS_CHANNELS.FLUSH_BEFORE_CLOSE, listener);
    };
  },
  onFullscreenChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => {
      callback(isFullscreen);
    };

    ipcRenderer.on('window:fullscreen-change', listener);

    return () => {
      ipcRenderer.off('window:fullscreen-change', listener);
    };
  },
};

contextBridge.exposeInMainWorld('yantraCanvas', yantraCanvas);

const yantraVault: YantraVaultApi = {
  refresh: (sessionId) => ipcRenderer.invoke(VAULT_CHANNELS.REFRESH, sessionId),
  deleteEntry: (sessionId, path) => ipcRenderer.invoke(VAULT_CHANNELS.DELETE_ENTRY, sessionId, path),
  retryRecovery: (sessionId) => ipcRenderer.invoke(VAULT_CHANNELS.RETRY_RECOVERY, sessionId),
  createFolder: (sessionId, folder, name) => ipcRenderer.invoke(VAULT_CHANNELS.CREATE_FOLDER, sessionId, folder, name),
  renameEntry: (sessionId, path, name, documentTitle) => ipcRenderer.invoke(VAULT_CHANNELS.RENAME_ENTRY, sessionId, path, name, documentTitle),
  moveEntry: (sessionId, path, folder) => ipcRenderer.invoke(VAULT_CHANNELS.MOVE_ENTRY, sessionId, path, folder),
  readCanvas: (sessionId, path, mode) => ipcRenderer.invoke(VAULT_CHANNELS.READ_CANVAS, sessionId, path, mode),
  createCanvas: (sessionId, folder) => ipcRenderer.invoke(VAULT_CHANNELS.CREATE_CANVAS, sessionId, folder),
  saveCanvas: (sessionId, canvas, overwrite) => ipcRenderer.invoke(VAULT_CHANNELS.SAVE_CANVAS, sessionId, canvas, overwrite),
  createNodeDocument: (sessionId) => ipcRenderer.invoke(VAULT_CHANNELS.CREATE_NODE_DOCUMENT, sessionId),
  restore: () => ipcRenderer.invoke(VAULT_CHANNELS.RESTORE),
  choose: (create) => ipcRenderer.invoke(VAULT_CHANNELS.CHOOSE, create),
  readDocument: (sessionId, path, mode) => ipcRenderer.invoke(VAULT_CHANNELS.READ_DOCUMENT, sessionId, path, mode),
  createDocument: (sessionId, folder) => ipcRenderer.invoke(VAULT_CHANNELS.CREATE_DOCUMENT, sessionId, folder),
  saveDocument: (sessionId, document, overwrite) => ipcRenderer.invoke(VAULT_CHANNELS.SAVE_DOCUMENT, sessionId, document, overwrite),
};

contextBridge.exposeInMainWorld('yantraVault', yantraVault);
