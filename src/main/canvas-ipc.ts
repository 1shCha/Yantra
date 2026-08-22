import { ipcMain } from 'electron';

import { CANVAS_CHANNELS, type JsonCanvasDocument } from '../shared/canvas-api';
import { getCanvasFilePath, loadCanvasDocument, saveCanvasDocument } from './canvas-file';

export function registerCanvasIpcHandlers(): void {
  ipcMain.handle(CANVAS_CHANNELS.LOAD, () => loadCanvasDocument());
  ipcMain.handle(CANVAS_CHANNELS.SAVE, (_event, document: JsonCanvasDocument) =>
    saveCanvasDocument(document),
  );
  ipcMain.handle(CANVAS_CHANNELS.STATUS, () => ({
    filePath: getCanvasFilePath(),
  }));
}
