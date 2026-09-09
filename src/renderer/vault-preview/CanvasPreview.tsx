import { useMemo } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { ExternalLink, FileQuestion } from 'lucide-react';
import { GroupOutlines } from '../canvas/GroupOutlines';
import { renderTiptapDocToHtml } from '../editor/tiptap-schema';
import type { MarkdownFlowNode } from '../canvas/react-flow-mapping';
import { getStackingZIndices } from '../../shared/stacking-order';
import { PreviewFileHeader } from './PreviewFileHeader';
import { readingNotes, questions, nextSteps } from './preview-documents';

const nodes: MarkdownFlowNode[] = [
  { id: 'reading', type: 'markdownNode', position: { x: 0, y: 0 }, width: 320, height: 420, style: { width: 320, height: 420 }, data: { canvasType: 'text', doc: readingNotes } },
  { id: 'questions', type: 'markdownNode', position: { x: 390, y: 30 }, width: 270, height: 220, style: { width: 270, height: 220 }, data: { canvasType: 'text', doc: questions } },
  { id: 'next', type: 'markdownNode', position: { x: 390, y: 310 }, width: 270, height: 170, style: { width: 270, height: 170 }, data: { canvasType: 'text', doc: nextSteps } },
];
const groups = [{ id: 'reading-group', nodeIds: ['reading', 'questions'] }];
const stacking = getStackingZIndices(['reading-group', 'next'], groups);
const previewNodes = nodes.map((node) => ({ ...node, zIndex: stacking.nodeZIndexById.get(node.id) ?? 0 }));
const edges = [
  { id: 'question-edge', source: 'reading', target: 'questions', label: 'raises' },
  { id: 'next-edge', source: 'questions', target: 'next' },
];
function inertAction() {}

function PreviewNode({ data }: NodeProps<MarkdownFlowNode>) {
  const html = useMemo(() => renderTiptapDocToHtml(data.doc), [data.doc]);
  if (data.missing === true) {
    return <article className="markdown-node vault-missing-node"><FileQuestion size={24} /><strong>Document missing</strong><span>Reading notes.yantra_doc</span><p>The referenced file could not be found.</p><button disabled title="Document unavailable">Open Document</button></article>;
  }
  return (
    <article className="markdown-node vault-preview-node">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="markdown-node__body" onClickCapture={(event) => { event.preventDefault(); }}>
        <div className="markdown-node__preview" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <button className="vault-preview-node__open nodrag nopan" title="Open Document" aria-label="Open Document"><ExternalLink size={14} /></button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
}
const nodeTypes = { markdownNode: PreviewNode };

export function CanvasPreview({ missingDocument = false }: { missingDocument?: boolean }) {
  const displayedNodes = useMemo(() => previewNodes.map((node) => missingDocument && node.id === 'reading' ? { ...node, data: { ...node.data, missing: true } } : node), [missingDocument]);
  return (
    <section className="vault-canvas-view">
      <PreviewFileHeader title="Overview" folder="My vault" kind="canvas" />
      <div className="vault-canvas-stage">
        <ReactFlowProvider>
          <ReactFlow
            nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            nodesFocusable={false} edgesFocusable={false} deleteKeyCode={null}
            panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
            fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.1} maxZoom={1}
            zIndexMode="manual" proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Lines} gap={32} size={1} color="rgba(32, 32, 29, 0.1)" />
            <GroupOutlines groups={groups} nodes={nodes} selectedGroupId={null}
              groupOutlineZIndexById={stacking.groupOutlineZIndexById}
              onGroupPointerDown={inertAction} onGroupPointerMove={inertAction}
              onGroupPointerUp={inertAction} onSelectGroup={inertAction} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </section>
  );
}
