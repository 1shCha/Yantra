import { useCallback, useMemo } from 'react';
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react';
import { MarkdownNode } from './MarkdownNode.jsx';
import { useCanvasStore } from './stores/canvasStore.js';
import { ScatterGridBackground } from './ScatterGridBackground.jsx';

function Canvas() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const createMarkdownNode = useCanvasStore((state) => state.createMarkdownNode);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const editNode = useCanvasStore((state) => state.editNode);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      markdownNode: MarkdownNode,
    }),
    [],
  );

  const handleCanvasDoubleClick = useCallback(
    (event) => {
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

  const handleNodeClick = useCallback(
    (event, node) => {
      if (selectedNodeIds.length === 1 && selectedNodeIds[0] === node.id) {
        editNode(node.id);
        return;
      }

      selectNode(node.id);
    },
    [editNode, selectNode, selectedNodeIds],
  );

  const handleNodeDoubleClick = useCallback((event, node) => {
    event.stopPropagation();
    editNode(node.id);
  }, [editNode]);

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  return (
    <main className="app-shell">
      <div className="ambient-background" />
      <ScatterGridBackground />
      <ReactFlow
        nodes={nodesWithInteractionState}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
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
        selectionMode={SelectionMode.Partial}
      >
        <Controls position="bottom-right" />
      </ReactFlow>
    </main>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
