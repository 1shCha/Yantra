// Window lifecycle bridge retained for the vault workspace; storage uses vault-api.
export interface CloseFlushResult {
  ok?: boolean;
  error?: string;
}

export interface YantraCanvasApi {
  onBeforeClose: (callback: () => void | Promise<void>) => () => void;
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
}

export const CANVAS_CHANNELS = {
  FLUSH_BEFORE_CLOSE: 'canvas:flush-before-close',
  CLOSE_FLUSH_COMPLETE: 'canvas:close-flush-complete',
} as const;

declare global {
  interface Window {
    yantraCanvas?: YantraCanvasApi;
  }
}
