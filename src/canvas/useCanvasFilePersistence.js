import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../stores/canvasStore.js';

const CANVAS_SAVE_DEBOUNCE_MS = 750;

export function useCanvasFilePersistence() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const hasLoadedCanvasRef = useRef(false);
  const lastSavedSerializedRef = useRef(null);
  const saveInFlightRef = useRef(null);
  const [status, setStatus] = useState({
    error: null,
    filePath: '',
    lastSavedAt: null,
    state: 'loading',
  });

  const getSerializedCanvasDocument = useCallback(() => {
    const document = useCanvasStore.getState().getJsonCanvasDocument();

    return {
      document,
      serialized: JSON.stringify(document),
    };
  }, []);

  const saveIfDirty = useCallback(
    (canvasApi) => {
      if (!hasLoadedCanvasRef.current) {
        return Promise.resolve({ skipped: true });
      }

      const { document, serialized } = getSerializedCanvasDocument();

      if (serialized === lastSavedSerializedRef.current) {
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: null,
          state: 'clean',
        }));
        return Promise.resolve({ skipped: true });
      }

      setStatus((currentStatus) => ({
        ...currentStatus,
        error: null,
        state: 'saving',
      }));

      const savePromise = canvasApi.save(document).then((result) => {
        lastSavedSerializedRef.current = serialized;
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: null,
          lastSavedAt: result?.savedAt ?? new Date().toISOString(),
          state: 'clean',
        }));
        return result;
      });

      saveInFlightRef.current = savePromise;

      return savePromise.finally(() => {
        if (saveInFlightRef.current === savePromise) {
          saveInFlightRef.current = null;
        }
      }).catch((error) => {
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: error instanceof Error ? error.message : String(error),
          state: 'error',
        }));
        throw error;
      });
    },
    [getSerializedCanvasDocument],
  );

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi) {
      console.warn('Yantra canvas file API is unavailable; filesystem persistence is disabled.');
      setStatus({
        error: 'Filesystem persistence is unavailable.',
        filePath: '',
        lastSavedAt: null,
        state: 'error',
      });
      return undefined;
    }

    let isActive = true;

    canvasApi
      .load()
      .then(({ document, filePath }) => {
        if (!isActive) {
          return;
        }

        useCanvasStore.getState().loadJsonCanvasDocument(document);
        hasLoadedCanvasRef.current = true;
        lastSavedSerializedRef.current = getSerializedCanvasDocument().serialized;
        setStatus({
          error: null,
          filePath: filePath ?? '',
          lastSavedAt: null,
          state: 'clean',
        });
      })
      .catch((error) => {
        console.error('Unable to load canvas document.', error);
        setStatus({
          error: error instanceof Error ? error.message : String(error),
          filePath: '',
          lastSavedAt: null,
          state: 'error',
        });
      });

    const unsubscribeBeforeClose = canvasApi.onBeforeClose?.(() => saveIfDirty(canvasApi));

    return () => {
      isActive = false;
      unsubscribeBeforeClose?.();
    };
  }, [getSerializedCanvasDocument, saveIfDirty]);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi || !hasLoadedCanvasRef.current) {
      return undefined;
    }

    const { serialized } = getSerializedCanvasDocument();

    if (serialized === lastSavedSerializedRef.current) {
      setStatus((currentStatus) => ({
        ...currentStatus,
        error: null,
        state: 'clean',
      }));
      return undefined;
    }

    setStatus((currentStatus) => ({
      ...currentStatus,
      error: null,
      state: 'dirty',
    }));

    const saveTimer = window.setTimeout(() => {
      saveIfDirty(canvasApi).catch((error) => {
        console.error('Unable to save canvas document.', error);
      });
    }, CANVAS_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [edges, getSerializedCanvasDocument, nodes, saveIfDirty]);

  return status;
}
