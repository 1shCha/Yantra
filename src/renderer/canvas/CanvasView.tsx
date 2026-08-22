import { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';

import { REACT_FLOW_TEXT_NODE_TYPE } from '../../shared/json-canvas';
import { useCanvasStore } from '../stores/canvasStore';
import { CanvasPersistenceStatus, type PersistenceStatus } from './CanvasPersistenceStatus';
import { MarkdownNode } from './MarkdownNode';
import { SelectionToolbar } from './SelectionToolbar';

function isElementTarget(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

interface CanvasViewProps {
  persistenceStatus: PersistenceStatus;
}

export function CanvasView({ persistenceStatus }: CanvasViewProps) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const createMarkdownNode = useCanvasStore((state) => state.createMarkdownNode);
  const editNode = useCanvasStore((state) => state.editNode);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const deleteSelectedNodes = useCanvasStore((state) => state.deleteSelectedNodes);
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      [REACT_FLOW_TEXT_NODE_TYPE]: MarkdownNode,
    }),
    [],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isElementTarget(event.target)) {
        return;
      }

      if (
        event.target.closest('.react-flow__node') ||
        event.target.closest('.react-flow__controls')
      ) {
        return;
      }

      const flowPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      createMarkdownNode(flowPosition);
    },
    [createMarkdownNode, screenToFlowPosition],
  );

  const nodesWithInteractionState = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: selectedNodeIds.includes(node.id),
      })),
    [nodes, selectedNodeIds],
  );

  const handleNodeDoubleClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.stopPropagation();
      editNode(node.id);
    },
    [editNode],
  );

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  return (
    <main className="app-shell">
      <SelectionToolbar
        selectedNodeCount={selectedNodeIds.length}
        onDeleteSelectedNodes={deleteSelectedNodes}
      />
      <CanvasPersistenceStatus status={persistenceStatus} />
      <ReactFlow
        nodes={nodesWithInteractionState}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onDoubleClick={handleCanvasDoubleClick}
        fitView
        minZoom={0.2}
        maxZoom={2}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag={false}
        panOnScroll
        selectionOnDrag
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
      >
        <Background variant={BackgroundVariant.Lines} gap={18} size={1} />
        <Controls position="bottom-right" />
      </ReactFlow>
    </main>
  );
}
