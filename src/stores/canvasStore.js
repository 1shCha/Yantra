import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;
const JSON_CANVAS_TEXT_NODE_TYPE = 'text';
const REACT_FLOW_TEXT_NODE_TYPE = 'markdownNode';

function createJsonCanvasTextNodeAt(position) {
  return {
    id: crypto.randomUUID(),
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(position.x - NODE_WIDTH / 2),
    y: toCanvasInteger(position.y - NODE_HEIGHT / 2),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    text: '',
  };
}

function createMarkdownNodeAt(position) {
  return jsonCanvasNodeToReactFlowNode(createJsonCanvasTextNodeAt(position));
}

function toCanvasInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function getNodeWidth(node) {
  return toCanvasInteger(
    Number(node.style?.width ?? node.width ?? node.measured?.width),
    NODE_WIDTH,
  );
}

function getNodeHeight(node) {
  return toCanvasInteger(
    Number(node.style?.height ?? node.height ?? node.measured?.height),
    NODE_HEIGHT,
  );
}

function getNodeText(node) {
  if (typeof node.text === 'string') {
    return node.text;
  }

  if (typeof node.data?.text === 'string') {
    return node.data.text;
  }

  if (typeof node.data?.content === 'string') {
    return node.data.content;
  }

  return '';
}

function normalizeJsonCanvasTextNode(node) {
  return {
    id: typeof node.id === 'string' ? node.id : crypto.randomUUID(),
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(Number(node.x ?? node.position?.x)),
    y: toCanvasInteger(Number(node.y ?? node.position?.y)),
    width: toCanvasInteger(Number(node.width ?? node.style?.width), NODE_WIDTH),
    height: toCanvasInteger(Number(node.height ?? node.style?.height), NODE_HEIGHT),
    text: getNodeText(node),
    ...(typeof node.color === 'string' ? { color: node.color } : {}),
  };
}

function jsonCanvasNodeToReactFlowNode(node) {
  const canvasNode = normalizeJsonCanvasTextNode(node);

  return {
    id: canvasNode.id,
    type: REACT_FLOW_TEXT_NODE_TYPE,
    position: {
      x: canvasNode.x,
      y: canvasNode.y,
    },
    data: {
      canvasType: canvasNode.type,
      text: canvasNode.text,
      content: canvasNode.text,
      ...(canvasNode.color ? { color: canvasNode.color } : {}),
    },
    style: {
      width: canvasNode.width,
      height: canvasNode.height,
    },
  };
}

function reactFlowNodeToJsonCanvasNode(node) {
  const canvasNode = {
    id: node.id,
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(node.position?.x),
    y: toCanvasInteger(node.position?.y),
    width: getNodeWidth(node),
    height: getNodeHeight(node),
    text: getNodeText(node),
  };

  const color = node.data?.color;
  if (typeof color === 'string') {
    canvasNode.color = color;
  }

  return canvasNode;
}

function normalizeJsonCanvasEdge(edge) {
  const fromNode = typeof edge.fromNode === 'string' ? edge.fromNode : edge.source;
  const toNode = typeof edge.toNode === 'string' ? edge.toNode : edge.target;

  if (typeof fromNode !== 'string' || typeof toNode !== 'string') {
    return null;
  }

  return {
    id: typeof edge.id === 'string' ? edge.id : crypto.randomUUID(),
    fromNode,
    toNode,
    ...(isCanvasSide(edge.fromSide) ? { fromSide: edge.fromSide } : {}),
    ...(isCanvasSide(edge.toSide) ? { toSide: edge.toSide } : {}),
    ...(isCanvasEnd(edge.fromEnd) ? { fromEnd: edge.fromEnd } : {}),
    ...(isCanvasEnd(edge.toEnd) ? { toEnd: edge.toEnd } : {}),
    ...(typeof edge.color === 'string' ? { color: edge.color } : {}),
    ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
  };
}

function jsonCanvasEdgeToReactFlowEdge(edge) {
  const canvasEdge = normalizeJsonCanvasEdge(edge);

  if (!canvasEdge) {
    return null;
  }

  return {
    id: canvasEdge.id,
    source: canvasEdge.fromNode,
    target: canvasEdge.toNode,
    ...(canvasEdge.label ? { label: canvasEdge.label } : {}),
    data: {
      ...(canvasEdge.fromSide ? { fromSide: canvasEdge.fromSide } : {}),
      ...(canvasEdge.toSide ? { toSide: canvasEdge.toSide } : {}),
      ...(canvasEdge.fromEnd ? { fromEnd: canvasEdge.fromEnd } : {}),
      ...(canvasEdge.toEnd ? { toEnd: canvasEdge.toEnd } : {}),
      ...(canvasEdge.color ? { color: canvasEdge.color } : {}),
    },
  };
}

function reactFlowEdgeToJsonCanvasEdge(edge) {
  const canvasEdge = normalizeJsonCanvasEdge({
    id: edge.id,
    fromNode: edge.source,
    toNode: edge.target,
    fromSide: edge.data?.fromSide,
    toSide: edge.data?.toSide,
    fromEnd: edge.data?.fromEnd,
    toEnd: edge.data?.toEnd,
    color: edge.data?.color,
    label: edge.label,
  });

  return canvasEdge;
}

function isCanvasSide(value) {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function isCanvasEnd(value) {
  return value === 'none' || value === 'arrow';
}

function toJsonCanvasDocument(state) {
  return {
    nodes: state.nodes.map(reactFlowNodeToJsonCanvasNode),
    edges: state.edges.map(reactFlowEdgeToJsonCanvasEdge).filter(Boolean),
  };
}

function hydrateNodes(nodes) {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes
    .filter((node) => node && typeof node === 'object')
    .map((node) => {
      if (node.type === REACT_FLOW_TEXT_NODE_TYPE || node.position || node.data) {
        return jsonCanvasNodeToReactFlowNode(reactFlowNodeToJsonCanvasNode(node));
      }

      if (node.type === JSON_CANVAS_TEXT_NODE_TYPE) {
        return jsonCanvasNodeToReactFlowNode(node);
      }

      return null;
    })
    .filter(Boolean);
}

function hydrateEdges(edges) {
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges
    .filter((edge) => edge && typeof edge === 'object')
    .map(jsonCanvasEdgeToReactFlowEdge)
    .filter(Boolean);
}

export const useCanvasStore = create((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  editingNodeId: null,

  onNodesChange: (changes) => {
    const currentState = get();
    const canMoveNodes = currentState.selectedNodeIds.length <= 1;
    const nodeChanges = changes.filter((change) => {
      if (change.type === 'select') {
        return false;
      }

      if (!canMoveNodes && change.type === 'position') {
        return false;
      }

      return true;
    });
    const nodes = applyNodeChanges(nodeChanges, currentState.nodes);
    const editingNodeId = currentState.selectedNodeIds.includes(currentState.editingNodeId)
      ? currentState.editingNodeId
      : null;

    set({
      nodes,
      editingNodeId,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  createMarkdownNode: (position) => {
    const node = createMarkdownNodeAt(position);

    set({
      nodes: [
        ...get().nodes.map((existingNode) => ({
          ...existingNode,
          selected: false,
        })),
        {
          ...node,
          selected: true,
        },
      ],
      selectedNodeIds: [node.id],
      editingNodeId: null,
    });
  },

  updateNodeContent: (nodeId, content) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                text: content,
                content,
              },
            }
          : node,
      ),
    });
  },

  selectNode: (nodeId) => {
    set({
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: node.id === nodeId,
      })),
      selectedNodeIds: [nodeId],
      editingNodeId: null,
    });
  },

  toggleNodeSelection: (nodeId) => {
    const selectedNodeIds = new Set(get().selectedNodeIds);

    if (selectedNodeIds.has(nodeId)) {
      selectedNodeIds.delete(nodeId);
    } else {
      selectedNodeIds.add(nodeId);
    }

    set({
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: selectedNodeIds.has(node.id),
      })),
      selectedNodeIds: Array.from(selectedNodeIds),
      editingNodeId: null,
    });
  },

  editNode: (nodeId) => {
    set({
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: node.id === nodeId,
      })),
      selectedNodeIds: [nodeId],
      editingNodeId: nodeId,
    });
  },

  clearSelection: () => {
    set({
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: false,
      })),
      selectedNodeIds: [],
      editingNodeId: null,
    });
  },

  deleteSelectedNodes: () => {
    const selectedNodeIds = new Set(get().selectedNodeIds);

    if (selectedNodeIds.size === 0) {
      return;
    }

    set({
      nodes: get().nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: get().edges.filter(
        (edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
      ),
      selectedNodeIds: [],
      editingNodeId: null,
    });
  },

  getJsonCanvasDocument: () => toJsonCanvasDocument(get()),

  loadJsonCanvasDocument: (document) => {
    set({
      nodes: hydrateNodes(document?.nodes),
      edges: hydrateEdges(document?.edges),
      selectedNodeIds: [],
      editingNodeId: null,
    });
  },
}));
