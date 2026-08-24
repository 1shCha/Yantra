import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from '@xyflow/react';
import { create } from 'zustand';

import type { JsonCanvasDocument } from '../../shared/json-canvas';
import {
  createMarkdownNodeAt,
  hydrateEdges,
  hydrateGroups,
  hydrateNodes,
  toJsonCanvasDocument,
  type CanvasGroup,
  type MarkdownFlowEdge,
  type MarkdownFlowNode,
} from '../canvas/react-flow-mapping';

interface CanvasState {
  nodes: MarkdownFlowNode[];
  edges: MarkdownFlowEdge[];
  groups: CanvasGroup[];
  selectedNodeIds: string[];
  selectedGroupId: string | null;
  editingNodeId: string | null;
  onNodesChange: (changes: NodeChange<MarkdownFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<MarkdownFlowEdge>[]) => void;
  createMarkdownNode: (position: { x: number; y: number }) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodeGeometry: (
    nodeId: string,
    geometry: { x: number; y: number; width: number; height: number },
  ) => void;
  updateNodeContent: (nodeId: string, content: string) => void;
  selectNode: (nodeId: string) => void;
  toggleNodeSelection: (nodeId: string) => void;
  editNode: (nodeId: string) => void;
  activateNode: (nodeId: string, options?: { isMultiSelect?: boolean }) => void;
  clearSelection: () => void;
  groupSelectedNodes: () => void;
  selectGroup: (groupId: string) => void;
  ungroupSelectedGroup: () => void;
  moveGroupBy: (groupId: string, delta: { x: number; y: number }) => void;
  deleteSelectedNodes: () => void;
  deleteSelectedGroup: () => void;
  getJsonCanvasDocument: () => JsonCanvasDocument;
  loadJsonCanvasDocument: (document: JsonCanvasDocument | null | undefined) => void;
}

function applySelectedNodeIds(nodes: MarkdownFlowNode[], selectedNodeIds: string[]): MarkdownFlowNode[] {
  const selectedNodeIdSet = new Set(selectedNodeIds);

  return nodes.map((node) => ({
    ...node,
    selected: selectedNodeIdSet.has(node.id),
  }));
}

function getNodeIdsWithToggledSelection(selectedNodeIds: string[], nodeId: string): string[] {
  const nextSelectedNodeIds = new Set(selectedNodeIds);

  if (nextSelectedNodeIds.has(nodeId)) {
    nextSelectedNodeIds.delete(nodeId);
  } else {
    nextSelectedNodeIds.add(nodeId);
  }

  return Array.from(nextSelectedNodeIds);
}

function removeNodeIdsFromGroups(
  groups: CanvasGroup[],
  removedNodeIds: ReadonlySet<string>,
): CanvasGroup[] {
  return groups.flatMap((group) => {
    const nodeIds = group.nodeIds.filter((nodeId) => !removedNodeIds.has(nodeId));

    return nodeIds.length < 2
      ? []
      : [
          {
            ...group,
            nodeIds,
          },
        ];
  });
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  groups: [],
  selectedNodeIds: [],
  selectedGroupId: null,
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
    const editingNodeId = selectedNodeIds.includes(currentState.editingNodeId ?? '')
      ? currentState.editingNodeId
      : null;

    set({
      nodes,
      selectedNodeIds,
      selectedGroupId: hasSelectionChange ? null : currentState.selectedGroupId,
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
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  setNodePosition: (nodeId, position) => {
    set({
      nodes: get().nodes.map((node) => {
        if (
          node.id !== nodeId ||
          (node.position.x === position.x && node.position.y === position.y)
        ) {
          return node;
        }

        return {
          ...node,
          position,
        };
      }),
    });
  },

  setNodeGeometry: (nodeId, geometry) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        if (
          node.position.x === geometry.x &&
          node.position.y === geometry.y &&
          node.width === geometry.width &&
          node.height === geometry.height &&
          node.style?.width === geometry.width &&
          node.style?.height === geometry.height
        ) {
          return node;
        }

        return {
          ...node,
          position: {
            x: geometry.x,
            y: geometry.y,
          },
          width: geometry.width,
          height: geometry.height,
          measured: {
            width: geometry.width,
            height: geometry.height,
          },
          style: {
            ...node.style,
            width: geometry.width,
            height: geometry.height,
          },
        };
      }),
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
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  toggleNodeSelection: (nodeId) => {
    const selectedNodeIds = getNodeIdsWithToggledSelection(get().selectedNodeIds, nodeId);

    set({
      nodes: applySelectedNodeIds(get().nodes, selectedNodeIds),
      selectedNodeIds,
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  editNode: (nodeId) => {
    const selectedNodeIds = [nodeId];

    set({
      nodes: applySelectedNodeIds(get().nodes, selectedNodeIds),
      selectedNodeIds,
      selectedGroupId: null,
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
        selectedGroupId: null,
        editingNodeId: null,
      });
      return;
    }

    if (currentState.selectedNodeIds.length === 1 && currentState.selectedNodeIds[0] === nodeId) {
      const selectedNodeIds = [nodeId];

      set({
        nodes: applySelectedNodeIds(currentState.nodes, selectedNodeIds),
        selectedNodeIds,
        selectedGroupId: null,
        editingNodeId: nodeId,
      });
      return;
    }

    const selectedNodeIds = [nodeId];

    set({
      nodes: applySelectedNodeIds(currentState.nodes, selectedNodeIds),
      selectedNodeIds,
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  clearSelection: () => {
    set({
      nodes: applySelectedNodeIds(get().nodes, []),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  groupSelectedNodes: () => {
    const currentState = get();
    const availableNodeIds = new Set(currentState.nodes.map((node) => node.id));
    const selectedNodeIds = Array.from(new Set(currentState.selectedNodeIds)).filter((nodeId) =>
      availableNodeIds.has(nodeId),
    );
    const groupedNodeIds = new Set(
      currentState.groups.flatMap((group) => group.nodeIds),
    );

    if (
      selectedNodeIds.length < 2 ||
      selectedNodeIds.some((nodeId) => groupedNodeIds.has(nodeId))
    ) {
      return;
    }

    const group = {
      id: crypto.randomUUID(),
      nodeIds: selectedNodeIds,
    };

    set({
      nodes: applySelectedNodeIds(currentState.nodes, []),
      groups: [...currentState.groups, group],
      selectedNodeIds: [],
      selectedGroupId: group.id,
      editingNodeId: null,
    });
  },

  selectGroup: (groupId) => {
    const currentState = get();
    if (!currentState.groups.some((group) => group.id === groupId)) {
      return;
    }

    set({
      nodes: applySelectedNodeIds(currentState.nodes, []),
      selectedNodeIds: [],
      selectedGroupId: groupId,
      editingNodeId: null,
    });
  },

  ungroupSelectedGroup: () => {
    const selectedGroupId = get().selectedGroupId;
    if (selectedGroupId === null) {
      return;
    }

    set({
      groups: get().groups.filter((group) => group.id !== selectedGroupId),
      selectedGroupId: null,
    });
  },

  moveGroupBy: (groupId, delta) => {
    if (
      !Number.isFinite(delta.x) ||
      !Number.isFinite(delta.y) ||
      (delta.x === 0 && delta.y === 0)
    ) {
      return;
    }

    const currentState = get();
    const group = currentState.groups.find((candidate) => candidate.id === groupId);
    if (group === undefined) {
      return;
    }

    const memberNodeIds = new Set(group.nodeIds);
    set({
      nodes: currentState.nodes.map((node) =>
        memberNodeIds.has(node.id)
          ? {
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y,
              },
            }
          : node,
      ),
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
      groups: removeNodeIdsFromGroups(get().groups, selectedNodeIds),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  deleteSelectedGroup: () => {
    const currentState = get();
    const selectedGroup = currentState.groups.find(
      (group) => group.id === currentState.selectedGroupId,
    );
    if (selectedGroup === undefined) {
      return;
    }

    const memberNodeIds = new Set(selectedGroup.nodeIds);
    set({
      nodes: currentState.nodes.filter((node) => !memberNodeIds.has(node.id)),
      edges: currentState.edges.filter(
        (edge) => !memberNodeIds.has(edge.source) && !memberNodeIds.has(edge.target),
      ),
      groups: currentState.groups.filter((group) => group.id !== selectedGroup.id),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  getJsonCanvasDocument: () => toJsonCanvasDocument(get()),

  loadJsonCanvasDocument: (document) => {
    const nodes = hydrateNodes(document?.nodes);

    set({
      nodes,
      edges: hydrateEdges(document?.edges),
      groups: hydrateGroups(document?.groups, nodes),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },
}));
