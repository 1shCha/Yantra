import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { createContext, memo, useContext } from 'react';
import { useStore } from 'zustand';
import { useCanvasState } from '../canvas/canvas-store-context';
import { MarkdownNode } from '../canvas/MarkdownNode';
import { MARKDOWN_NODE_MIN_HEIGHT, MARKDOWN_NODE_MIN_WIDTH, type MarkdownFlowNode } from '../canvas/react-flow-mapping';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';

export const VaultCanvasContext = createContext<{ workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string } | null>(null);

export const VaultDocumentNode = memo(function VaultDocumentNode(props: NodeProps<MarkdownFlowNode>) {
  const context = useContext(VaultCanvasContext);
  if (!context) throw new Error('Vault document node must be inside its canvas.');
  const { workspace, canvasId } = context;
  const documentId = props.data.documentId ?? '';
  const document = useStore(workspace, (state) => state.documents.get(documentId)?.file);
  const reloadRevision = useStore(workspace, (state) => state.documents.get(documentId)?.reloadRevision);
  const error = useStore(workspace, (state) => state.canvases.get(canvasId)?.documentErrors.get(documentId));
  const busy = useStore(workspace, (state) => state.busy || state.deletingDocumentIds.has(documentId));
  const titleError = useStore(workspace, (state) => state.titleErrors.get(documentId));
  const selectNode = useCanvasState((state) => state.selectNode);
  return <>
    {Object.values(Position).map((position) => <Handle key={`source-${position}`} id={position} type="source" position={position} isConnectable={false} />)}
    {Object.values(Position).map((position) => <Handle key={`target-${position}`} id={position} type="target" position={position} isConnectable={false} />)}
    {document ? <MarkdownNode key={reloadRevision} id={props.id} selected={props.selected} data={{ ...props.data, doc: document.doc }}
      editable={!busy} titleCommitError={titleError} onTitleCommit={() => workspace.getState().commitDocumentTitle(documentId)} />
      : <section className="markdown-node vault-live-missing-node" onPointerDown={() => selectNode(props.id)}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <NodeResizer isVisible minWidth={MARKDOWN_NODE_MIN_WIDTH} minHeight={MARKDOWN_NODE_MIN_HEIGHT}
          handleClassName="markdown-node__resize-handle" lineClassName="markdown-node__resize-line"
          onResizeStart={() => selectNode(props.id)} />
        <strong>Document unavailable</strong><p>{error ?? 'The referenced document could not be loaded.'}</p>
      </section>}
    <button className="vault-node-open nodrag nopan" aria-label="Open Document" title={document ? `Open ${document.title}` : 'Document unavailable'}
      disabled={!document || busy} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); void workspace.getState().openNodeDocument(canvasId, props.id); }}><FileText size={15} /></button>
  </>;
});

