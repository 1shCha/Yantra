import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { useCanvasStore, type CanvasState, type createCanvasStore } from '../stores/canvasStore';

export const CanvasStoreContext = createContext<ReturnType<typeof createCanvasStore> | null>(null);

export function useCanvasState<T>(selector: (state: CanvasState) => T): T {
  return useStore(useContext(CanvasStoreContext) ?? useCanvasStore, selector);
}
