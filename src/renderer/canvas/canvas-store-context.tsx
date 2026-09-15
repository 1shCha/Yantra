import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { type CanvasState, type createCanvasStore } from '../stores/canvasStore';

export const CanvasStoreContext = createContext<ReturnType<typeof createCanvasStore> | null>(null);

export function useCanvasStoreApi() {
  const store = useContext(CanvasStoreContext);
  if (store === null) throw new Error('Canvas requires a CanvasStoreContext provider.');
  return store;
}

export function useCanvasState<T>(selector: (state: CanvasState) => T): T {
  return useStore(useCanvasStoreApi(), selector);
}
