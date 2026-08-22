import { contextBridge, ipcRenderer } from 'electron';

import {
  CANVAS_CHANNELS,
  type CloseFlushResult,
  type JsonCanvasDocument,
  type YantraCanvasApi,
} from '../shared/canvas-api';

const yantraCanvas: YantraCanvasApi = {
  load: () => ipcRenderer.invoke(CANVAS_CHANNELS.LOAD),
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
  save: (document: JsonCanvasDocument) => ipcRenderer.invoke(CANVAS_CHANNELS.SAVE, document),
  status: () => ipcRenderer.invoke(CANVAS_CHANNELS.STATUS),
};

contextBridge.exposeInMainWorld('yantraCanvas', yantraCanvas);
