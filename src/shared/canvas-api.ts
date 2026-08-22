import type { JsonCanvasDocument } from './json-canvas';

export type { CanvasEnd, CanvasSide, JsonCanvasDocument, JsonCanvasEdge, JsonCanvasNode } from './json-canvas';

export interface CanvasLoadResult {
  document: JsonCanvasDocument;
  filePath: string;
  exists: boolean;
}

export interface CanvasSaveResult {
  filePath: string;
  savedAt: string;
}

export interface CanvasStatusResult {
  filePath: string;
}

export interface CloseFlushResult {
  ok?: boolean;
  error?: string;
}

export interface YantraCanvasApi {
  load: () => Promise<CanvasLoadResult>;
  save: (document: JsonCanvasDocument) => Promise<CanvasSaveResult>;
  status: () => Promise<CanvasStatusResult>;
  onBeforeClose: (callback: () => void | Promise<void>) => () => void;
}

export const CANVAS_CHANNELS = {
  LOAD: 'canvas:load',
  SAVE: 'canvas:save',
  STATUS: 'canvas:status',
  FLUSH_BEFORE_CLOSE: 'canvas:flush-before-close',
  CLOSE_FLUSH_COMPLETE: 'canvas:close-flush-complete',
} as const;

declare global {
  interface Window {
    yantraCanvas?: YantraCanvasApi;
  }
}
