import { Handle, NodeResizer, Position, ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { CanvasSurface } from '../canvas/CanvasView';
import { CanvasStoreContext, useCanvasState } from '../canvas/canvas-store-context';
import { MarkdownNode } from '../canvas/MarkdownNode';
import { MARKDOWN_NODE_MIN_HEIGHT, MARKDOWN_NODE_MIN_WIDTH, type MarkdownFlowNode } from '../canvas/react-flow-mapping';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import { createVaultCanvasSession } from './vault-canvas-session';

const VaultCanvasContext = createContext<{ workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string } | null>(null);

function VaultDocumentNode(props: NodeProps<MarkdownFlowNode>) {
  const context = useContext(VaultCanvasContext);
  if (!context) throw new Error('Vault document node must be inside its canvas.');
  const { workspace, canvasId } = context;
  const documentId = props.data.documentId ?? '';
  const document = useStore(workspace, (state) => state.documents.get(documentId));
  const error = useStore(workspace, (state) => state.canvases.get(canvasId)?.documentErrors.get(documentId));
  const busy = useStore(workspace, (state) => state.busy);
  const titleError = useStore(workspace, (state) => state.titleErrors.get(documentId));
  const selectNode = useCanvasState((state) => state.selectNode);
  return <>
    {Object.values(Position).map((position) => <Handle key={`source-${position}`} id={position} type="source" position={position} isConnectable={false} />)}
    {Object.values(Position).map((position) => <Handle key={`target-${position}`} id={position} type="target" position={position} isConnectable={false} />)}
    {document ? <MarkdownNode key={document.reloadRevision} id={props.id} selected={props.selected} data={{ ...props.data, doc: document.file.doc }}
      editable={!busy} titleCommitError={titleError} onTitleCommit={() => workspace.getState().commitDocumentTitle(documentId)} />
      : <section className="markdown-node vault-live-missing-node" onPointerDown={() => selectNode(props.id)}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <NodeResizer isVisible minWidth={MARKDOWN_NODE_MIN_WIDTH} minHeight={MARKDOWN_NODE_MIN_HEIGHT}
          handleClassName="markdown-node__resize-handle" lineClassName="markdown-node__resize-line"
          onResizeStart={() => selectNode(props.id)} />
        <strong>Document unavailable</strong><p>{error ?? 'The referenced document could not be loaded.'}</p>
      </section>}
    <button className="vault-node-open nodrag nopan" aria-label="Open Document" title={document ? `Open ${document.file.title}` : 'Document unavailable'}
      disabled={!document || busy} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); void workspace.getState().openNodeDocument(canvasId, props.id); }}><FileText size={15} /></button>
  </>;
}

const nodeTypes = { markdownNode: VaultDocumentNode };

export function VaultCanvasView({ workspace, canvasId, busy }: {
  workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string; busy: boolean;
}) {
  const [session] = useState(() => createVaultCanvasSession(workspace, canvasId));
  useEffect(() => session.connect(), [session]);
  return <div className="vault-live-canvas" inert={busy}>
    <VaultCanvasContext.Provider value={{ workspace, canvasId }}>
      <CanvasStoreContext.Provider value={session.flow}>
        <ReactFlowProvider>
          <CanvasSurface nodeTypes={nodeTypes} allowRemoval={false} defaultViewport={session.defaultViewport} onViewportChange={session.setViewport} />
        </ReactFlowProvider>
      </CanvasStoreContext.Provider>
    </VaultCanvasContext.Provider>
  </div>;
}
