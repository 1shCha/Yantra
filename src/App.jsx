import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import { MarkdownNode } from './MarkdownNode.jsx';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;

function Canvas() {
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [editingNodeId, setEditingNodeId] = useState(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      markdownNode: MarkdownNode,
    }),
    [],
  );

  const onNodesChange = useCallback((changes) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, []);

  const updateNodeContent = useCallback((nodeId, content) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                content,
              },
            }
          : node,
      ),
    );
  }, []);

  const createMarkdownNode = useCallback(
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
      const id = crypto.randomUUID();

      setNodes((currentNodes) => [
        ...currentNodes,
        {
          id,
          type: 'markdownNode',
          position: {
            x: flowPosition.x - NODE_WIDTH / 2,
            y: flowPosition.y - NODE_HEIGHT / 2,
          },
          data: {
            content: '',
            onContentChange: updateNodeContent,
          },
          style: {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          },
        },
      ]);
      setSelectedNodeId(id);
      setEditingNodeId(null);
    },
    [screenToFlowPosition, updateNodeContent],
  );

  const nodesWithInteractionState = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          isEditing: node.id === editingNodeId,
        },
      })),
    [editingNodeId, nodes, selectedNodeId],
  );

  const handleNodeClick = useCallback(
    (event, node) => {
      if (selectedNodeId === node.id) {
        setEditingNodeId(node.id);
        return;
      }

      setSelectedNodeId(node.id);
      setEditingNodeId(null);
    },
    [selectedNodeId],
  );

  const handleNodeDoubleClick = useCallback((event, node) => {
    event.stopPropagation();
    setSelectedNodeId(node.id);
    setEditingNodeId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setEditingNodeId(null);
  }, []);

  return (
    <main className="app-shell">
      <ReactFlow
        nodes={nodesWithInteractionState}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onDoubleClick={createMarkdownNode}
        fitView
        minZoom={0.2}
        maxZoom={2}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag={false}
        panOnScroll
        selectionOnDrag
      >
        <Background variant="dots" gap={18} size={1} />
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
