import { createContext, useContext, type ReactNode } from 'react';

import type { AlignmentResult } from './alignment-guides';

export interface NodeGeometry {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CanvasAlignmentContextValue {
  applyResizeAlignment: (
    nodeId: string,
    geometry: NodeGeometry,
  ) => { geometry: NodeGeometry; guides: AlignmentResult | null };
  clearAlignmentGuides: () => void;
  setResizeStartBounds: (nodeId: string, geometry: NodeGeometry) => void;
}

const CanvasAlignmentContext = createContext<CanvasAlignmentContextValue | null>(null);

export function CanvasAlignmentProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: CanvasAlignmentContextValue;
}) {
  return (
    <CanvasAlignmentContext.Provider value={value}>{children}</CanvasAlignmentContext.Provider>
  );
}

export function useCanvasAlignment(): CanvasAlignmentContextValue {
  const context = useContext(CanvasAlignmentContext);
  if (context === null) {
    throw new Error('useCanvasAlignment must be used within CanvasAlignmentProvider');
  }

  return context;
}
