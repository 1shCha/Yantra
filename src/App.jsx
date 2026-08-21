import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from '@xyflow/react';
import { MarkdownNode } from './MarkdownNode.jsx';
import { useCanvasStore } from './stores/canvasStore.js';

const CANVAS_SAVE_DEBOUNCE_MS = 750;

function useCanvasFilePersistence() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const hasLoadedCanvasRef = useRef(false);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi) {
      console.warn('Yantra canvas file API is unavailable; filesystem persistence is disabled.');
      return undefined;
    }

    let isActive = true;

    const scheduleSave = () => {
      const document = useCanvasStore.getState().getJsonCanvasDocument();

      canvasApi.save(document).catch((error) => {
        console.error('Unable to save canvas document.', error);
      });
    };

    canvasApi
      .load()
      .then(({ document }) => {
        if (!isActive) {
          return;
        }

        useCanvasStore.getState().loadJsonCanvasDocument(document);
        hasLoadedCanvasRef.current = true;
        window.setTimeout(scheduleSave, CANVAS_SAVE_DEBOUNCE_MS);
      })
      .catch((error) => {
        console.error('Unable to load canvas document.', error);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi || !hasLoadedCanvasRef.current) {
      return undefined;
    }

    const saveTimer = window.setTimeout(() => {
      const document = useCanvasStore.getState().getJsonCanvasDocument();

      canvasApi.save(document).catch((error) => {
        console.error('Unable to save canvas document.', error);
      });
    }, CANVAS_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [nodes, edges]);
}

function Canvas() {
  useCanvasFilePersistence();

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

  const handleNodeDoubleClick = useCallback((event, node) => {
    event.stopPropagation();
    editNode(node.id);
  }, [editNode]);

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const selectedNodeCount = selectedNodeIds.length;

  return (
    <main className="app-shell">
      {selectedNodeCount > 0 && (
        <aside className="selection-toolbar" aria-label="Selected node actions">
          <span className="selection-toolbar__count">
            {selectedNodeCount} selected
          </span>
          <button
            className="selection-toolbar__delete"
            type="button"
            onClick={deleteSelectedNodes}
          >
            Delete
          </button>
        </aside>
      )}
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
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
      >
        <Background variant="lines" gap={18} size={1} />
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
