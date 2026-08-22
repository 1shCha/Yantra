import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import {
  createMarkdownNodeAt,
  hydrateEdges,
  hydrateNodes,
  toJsonCanvasDocument,
} from '../canvas/jsonCanvas.js';

function applySelectedNodeIds(nodes, selectedNodeIds) {
  const selectedNodeIdSet = new Set(selectedNodeIds);

  return nodes.map((node) => ({
    ...node,
    selected: selectedNodeIdSet.has(node.id),
  }));
}

function getNodeIdsWithToggledSelection(selectedNodeIds, nodeId) {
  const nextSelectedNodeIds = new Set(selectedNodeIds);

  if (nextSelectedNodeIds.has(nodeId)) {
    nextSelectedNodeIds.delete(nodeId);
  } else {
    nextSelectedNodeIds.add(nodeId);
  }

  return Array.from(nextSelectedNodeIds);
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
      if (!canMoveNodes && change.type === 'position') {
        return false;
      }

      return true;
    });
    const nodes = applyNodeChanges(nodeChanges, currentState.nodes);
    const hasSelectionChange = nodeChanges.some((change) => change.type === 'select');
    const selectedNodeIds = hasSelectionChange
      ? nodes.filter((node) => node.selected).map((node) => node.id)
      : currentState.selectedNodeIds;
    const editingNodeId = selectedNodeIds.includes(currentState.editingNodeId)
      ? currentState.editingNodeId
      : null;

    set({
      nodes,
      selectedNodeIds,
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
    const selectedNodeIds = [nodeId];

    set({
      nodes: applySelectedNodeIds(get().nodes, selectedNodeIds),
      selectedNodeIds,
      editingNodeId: null,
    });
  },

  toggleNodeSelection: (nodeId) => {
    const selectedNodeIds = getNodeIdsWithToggledSelection(get().selectedNodeIds, nodeId);

    set({
      nodes: applySelectedNodeIds(get().nodes, selectedNodeIds),
      selectedNodeIds,
      editingNodeId: null,
    });
  },

  editNode: (nodeId) => {
    const selectedNodeIds = [nodeId];

    set({
      nodes: applySelectedNodeIds(get().nodes, selectedNodeIds),
      selectedNodeIds,
      editingNodeId: nodeId,
    });
  },

  activateNode: (nodeId, { isMultiSelect = false } = {}) => {
    const currentState = get();

    if (isMultiSelect) {
      const selectedNodeIds = getNodeIdsWithToggledSelection(
        currentState.selectedNodeIds,
        nodeId,
      );

      set({
        nodes: applySelectedNodeIds(currentState.nodes, selectedNodeIds),
        selectedNodeIds,
        editingNodeId: null,
      });
      return;
    }

    if (currentState.selectedNodeIds.length === 1 && currentState.selectedNodeIds[0] === nodeId) {
      const selectedNodeIds = [nodeId];

      set({
        nodes: applySelectedNodeIds(currentState.nodes, selectedNodeIds),
        selectedNodeIds,
        editingNodeId: nodeId,
      });
      return;
    }

    const selectedNodeIds = [nodeId];

    set({
      nodes: applySelectedNodeIds(currentState.nodes, selectedNodeIds),
      selectedNodeIds,
      editingNodeId: null,
    });
  },

  clearSelection: () => {
    set({
      nodes: applySelectedNodeIds(get().nodes, []),
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
