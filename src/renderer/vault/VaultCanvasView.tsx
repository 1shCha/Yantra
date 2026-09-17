import { VaultCanvasContext } from './VaultCanvasContext';
import { VaultDocumentNode } from './VaultDocumentNode';
import { ReactFlowProvider } from '@xyflow/react';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { CanvasSurface } from '../canvas/CanvasView';
import { CanvasStoreContext } from '../canvas/canvas-store-context';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import { createVaultCanvasSession } from './vault-canvas-session';

const MemoCanvasSurface = memo(CanvasSurface);
const nodeTypes = { markdownNode: VaultDocumentNode };

function VaultCanvasLock({ workspace, canvasId, active, children }: {
  workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string; active: boolean; children: ReactNode;
}) {
  const locked = useStore(workspace, (state) => state.busy || state.deletingCanvasId === canvasId || !active);
  return <div className="vault-live-canvas" inert={locked}>{children}</div>;
}

export const VaultCanvasView = memo(function VaultCanvasView({ workspace, canvasId, active = true }: {
  workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string; active?: boolean;
}) {
  const [session] = useState(() => createVaultCanvasSession(workspace, canvasId));
  useEffect(() => session.connect(), [session]);
  const context = useMemo(() => ({ workspace, canvasId }), [workspace, canvasId]);
  return <VaultCanvasLock workspace={workspace} canvasId={canvasId} active={active}>
    <VaultCanvasContext.Provider value={context}>
      <CanvasStoreContext.Provider value={session.flow}>
        <ReactFlowProvider>
          <MemoCanvasSurface active={active} flowId={`canvas-${canvasId}`} nodeTypes={nodeTypes} defaultViewport={session.defaultViewport}
            onViewportChange={session.setViewport} onViewportChangeEnd={session.finishViewportMove} />
        </ReactFlowProvider>
      </CanvasStoreContext.Provider>
    </VaultCanvasContext.Provider>
  </VaultCanvasLock>;
});
