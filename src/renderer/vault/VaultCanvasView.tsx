import { VaultCanvasContext, VaultDocumentNode } from './VaultDocumentNode';
import { ReactFlowProvider } from '@xyflow/react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { CanvasSurface } from '../canvas/CanvasView';
import { CanvasStoreContext } from '../canvas/canvas-store-context';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import { createVaultCanvasSession } from './vault-canvas-session';

const nodeTypes = { markdownNode: VaultDocumentNode };

export const VaultCanvasView = memo(function VaultCanvasView({ workspace, canvasId, busy }: {
  workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string; busy: boolean;
}) {
  const [session] = useState(() => createVaultCanvasSession(workspace, canvasId));
  useEffect(() => session.connect(), [session]);
  const context = useMemo(() => ({ workspace, canvasId }), [workspace, canvasId]);
  const deleting = useStore(workspace, (state) => state.deletingCanvasId === canvasId);
  return <div className="vault-live-canvas" inert={busy || deleting}>
    <VaultCanvasContext.Provider value={context}>
      <CanvasStoreContext.Provider value={session.flow}>
        <ReactFlowProvider>
          <CanvasSurface nodeTypes={nodeTypes} defaultViewport={session.defaultViewport} onViewportChange={session.setViewport} />
        </ReactFlowProvider>
      </CanvasStoreContext.Provider>
    </VaultCanvasContext.Provider>
  </div>;
});
