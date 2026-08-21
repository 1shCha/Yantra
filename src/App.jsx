import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function formatSaveTime(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function useCanvasFilePersistence() {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const hasLoadedCanvasRef = useRef(false);
  const lastSavedSerializedRef = useRef(null);
  const saveInFlightRef = useRef(null);
  const [status, setStatus] = useState({
    error: null,
    filePath: '',
    lastSavedAt: null,
    state: 'loading',
  });

  const getSerializedCanvasDocument = useCallback(() => {
    const document = useCanvasStore.getState().getJsonCanvasDocument();

    return {
      document,
      serialized: JSON.stringify(document),
    };
  }, []);

  const saveIfDirty = useCallback(
    (canvasApi) => {
      if (!hasLoadedCanvasRef.current) {
        return Promise.resolve({ skipped: true });
      }

      const { document, serialized } = getSerializedCanvasDocument();

      if (serialized === lastSavedSerializedRef.current) {
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: null,
          state: 'clean',
        }));
        return Promise.resolve({ skipped: true });
      }

      setStatus((currentStatus) => ({
        ...currentStatus,
        error: null,
        state: 'saving',
      }));

      const savePromise = canvasApi.save(document).then((result) => {
        lastSavedSerializedRef.current = serialized;
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: null,
          lastSavedAt: result?.savedAt ?? new Date().toISOString(),
          state: 'clean',
        }));
        return result;
      });

      saveInFlightRef.current = savePromise;

      return savePromise.finally(() => {
        if (saveInFlightRef.current === savePromise) {
          saveInFlightRef.current = null;
        }
      }).catch((error) => {
        setStatus((currentStatus) => ({
          ...currentStatus,
          error: error instanceof Error ? error.message : String(error),
          state: 'error',
        }));
        throw error;
      });
    },
    [getSerializedCanvasDocument],
  );

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi) {
      console.warn('Yantra canvas file API is unavailable; filesystem persistence is disabled.');
      setStatus({
        error: 'Filesystem persistence is unavailable.',
        filePath: '',
        lastSavedAt: null,
        state: 'error',
      });
      return undefined;
    }

    let isActive = true;

    canvasApi
      .load()
      .then(({ document, filePath }) => {
        if (!isActive) {
          return;
        }

        useCanvasStore.getState().loadJsonCanvasDocument(document);
        hasLoadedCanvasRef.current = true;
        lastSavedSerializedRef.current = getSerializedCanvasDocument().serialized;
        setStatus({
          error: null,
          filePath: filePath ?? '',
          lastSavedAt: null,
          state: 'clean',
        });
      })
      .catch((error) => {
        console.error('Unable to load canvas document.', error);
        setStatus({
          error: error instanceof Error ? error.message : String(error),
          filePath: '',
          lastSavedAt: null,
          state: 'error',
        });
      });

    const unsubscribeBeforeClose = canvasApi.onBeforeClose?.(() => saveIfDirty(canvasApi));

    return () => {
      isActive = false;
      unsubscribeBeforeClose?.();
    };
  }, [getSerializedCanvasDocument, saveIfDirty]);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;

    if (!canvasApi || !hasLoadedCanvasRef.current) {
      return undefined;
    }

    const { serialized } = getSerializedCanvasDocument();

    if (serialized === lastSavedSerializedRef.current) {
      setStatus((currentStatus) => ({
        ...currentStatus,
        error: null,
        state: 'clean',
      }));
      return undefined;
    }

    setStatus((currentStatus) => ({
      ...currentStatus,
      error: null,
      state: 'dirty',
    }));

    const saveTimer = window.setTimeout(() => {
      saveIfDirty(canvasApi).catch((error) => {
        console.error('Unable to save canvas document.', error);
      });
    }, CANVAS_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [edges, getSerializedCanvasDocument, nodes, saveIfDirty]);

  return status;
}

function CanvasPersistenceStatus({ status }) {
  const label =
    status.state === 'loading'
      ? 'Loading canvas'
      : status.state === 'saving'
        ? 'Saving...'
        : status.state === 'dirty'
          ? 'Unsaved changes'
          : status.state === 'error'
            ? 'Save failed'
            : status.lastSavedAt
              ? `Saved ${formatSaveTime(status.lastSavedAt)}`
              : 'Canvas saved';
  const title = [
    status.filePath ? `File: ${status.filePath}` : '',
    status.lastSavedAt ? `Last saved: ${new Date(status.lastSavedAt).toLocaleString()}` : '',
    status.error ? `Error: ${status.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <aside
      className="canvas-persistence-status"
      data-state={status.state}
      title={title}
      aria-label={`Canvas persistence status: ${label}`}
    >
      <span className="canvas-persistence-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </aside>
  );
}

function Canvas() {
  const persistenceStatus = useCanvasFilePersistence();

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
