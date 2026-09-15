import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from '@xyflow/react';
import { create } from 'zustand';

import {
  moveUnitToFront,
  reconcileLayerOrder,
  stackingUnitIdForNode,
} from '../../shared/stacking-order';
import { type TiptapDoc } from '../../shared/tiptap-document';
import {
  type CanvasGroup,
  type MarkdownFlowEdge,
  type MarkdownFlowNode,
} from '../canvas/react-flow-mapping';

export interface CanvasState {
  nodes: MarkdownFlowNode[];
  edges: MarkdownFlowEdge[];
  groups: CanvasGroup[];
  layerOrder: string[];
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
  updateNodeDoc: (nodeId: string, doc: TiptapDoc) => void;
  selectNode: (nodeId: string) => void;
  toggleNodeSelection: (nodeId: string) => void;
  editNode: (nodeId: string) => void;
  activateNode: (nodeId: string, options?: { isMultiSelect?: boolean }) => void;
  clearSelection: () => void;
  groupSelectedNodes: () => void;
  selectGroup: (groupId: string) => void;
  ungroupSelectedGroup: () => void;
  moveGroupBy: (groupId: string, delta: { x: number; y: number }) => void;
  raiseNodeStacking: (nodeId: string) => void;
  raiseStackingUnit: (unitId: string) => void;
  deleteSelectedNodes: () => void;
  deleteSelectedGroup: () => void;
}

function applySelectedNodeIds(nodes: MarkdownFlowNode[], selectedNodeIds: string[]): MarkdownFlowNode[] {
  const selectedNodeIdSet = new Set(selectedNodeIds);

  return nodes.map((node) => {
    const selected = selectedNodeIdSet.has(node.id);
    return Boolean(node.selected) === selected ? node : { ...node, selected };
  });
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

function layerOrderFor(
  layerOrder: readonly string[],
  nodes: readonly MarkdownFlowNode[],
  groups: readonly CanvasGroup[],
): string[] {
  return reconcileLayerOrder(
    layerOrder,
    nodes.map((node) => node.id),
    groups,
  );
}

function replaceGroupWithMembers(
  layerOrder: readonly string[],
  group: CanvasGroup,
): string[] {
  const nextLayerOrder: string[] = [];
  let didReplaceGroup = false;

  for (const unitId of layerOrder) {
    if (unitId !== group.id) {
      nextLayerOrder.push(unitId);
      continue;
    }

    didReplaceGroup = true;
    nextLayerOrder.push(...group.nodeIds);
  }

  if (!didReplaceGroup) {
    nextLayerOrder.push(...group.nodeIds);
  }

  return nextLayerOrder;
}

interface CanvasStoreOptions {
  onCreateNode: (position: { x: number; y: number }) => void;
  onUpdateNodeDoc: (nodeId: string, doc: TiptapDoc) => void;
  allowRemoval?: boolean;
  onDeleteNodes?: (nodeIds: string[]) => void;
}

export const createCanvasStore = (options: CanvasStoreOptions) => create<CanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  groups: [],
  layerOrder: [],
  selectedNodeIds: [],
  selectedGroupId: null,
  editingNodeId: null,

  onNodesChange: (changes) => {
    const currentState = get();
    const canMoveNodes = currentState.selectedNodeIds.length <= 1;
    const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (options.allowRemoval !== false && options.onDeleteNodes && removedIds.length) options.onDeleteNodes(removedIds);
    const nodeChanges = changes.filter((change) => {
      if (options.onDeleteNodes && change.type === 'remove') return false;
      if (options.allowRemoval === false && change.type === 'remove') return false;
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
      layerOrder: layerOrderFor(currentState.layerOrder, nodes, currentState.groups),
      selectedNodeIds,
      selectedGroupId: hasSelectionChange ? null : currentState.selectedGroupId,
      editingNodeId,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(options.allowRemoval === false ? changes.filter((change) => change.type !== 'remove') : changes, get().edges),
    });
  },

  createMarkdownNode: options.onCreateNode,

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

  updateNodeDoc: options.onUpdateNodeDoc,

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
    const groups = [...currentState.groups, group];
    const selectedNodeIdSet = new Set(selectedNodeIds);

    set({
      nodes: applySelectedNodeIds(currentState.nodes, []),
      groups,
      layerOrder: layerOrderFor(
        moveUnitToFront(
          currentState.layerOrder.filter((unitId) => !selectedNodeIdSet.has(unitId)),
          group.id,
        ),
        currentState.nodes,
        groups,
      ),
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
    const currentState = get();
    const selectedGroupId = currentState.selectedGroupId;
    if (selectedGroupId === null) {
      return;
    }

    const selectedGroup = currentState.groups.find((group) => group.id === selectedGroupId);
    const groups = currentState.groups.filter((group) => group.id !== selectedGroupId);

    set({
      groups,
      layerOrder:
        selectedGroup === undefined
          ? layerOrderFor(currentState.layerOrder, currentState.nodes, groups)
          : layerOrderFor(
              replaceGroupWithMembers(currentState.layerOrder, selectedGroup),
              currentState.nodes,
              groups,
            ),
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

  raiseStackingUnit: (unitId) => {
    const currentState = get();
    if (currentState.layerOrder[currentState.layerOrder.length - 1] === unitId) {
      return;
    }

    set({
      layerOrder: layerOrderFor(
        moveUnitToFront(currentState.layerOrder, unitId),
        currentState.nodes,
        currentState.groups,
      ),
    });
  },

  raiseNodeStacking: (nodeId) => {
    const currentState = get();
    currentState.raiseStackingUnit(stackingUnitIdForNode(nodeId, currentState.groups));
  },

  deleteSelectedNodes: () => {
    if (options.allowRemoval === false) return;
    const currentState = get();
    const selectedNodeIds = new Set(currentState.selectedNodeIds);

    if (selectedNodeIds.size === 0) {
      return;
    }

    if (options.onDeleteNodes) { options.onDeleteNodes([...selectedNodeIds]); return; }

    const nodes = currentState.nodes.filter((node) => !selectedNodeIds.has(node.id));
    const groups = removeNodeIdsFromGroups(currentState.groups, selectedNodeIds);

    set({
      nodes,
      edges: currentState.edges.filter(
        (edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
      ),
      groups,
      layerOrder: layerOrderFor(currentState.layerOrder, nodes, groups),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

  deleteSelectedGroup: () => {
    if (options.allowRemoval === false) return;
    const currentState = get();
    const selectedGroup = currentState.groups.find(
      (group) => group.id === currentState.selectedGroupId,
    );
    if (selectedGroup === undefined) {
      return;
    }

    if (options.onDeleteNodes) { options.onDeleteNodes(selectedGroup.nodeIds); return; }

    const memberNodeIds = new Set(selectedGroup.nodeIds);
    const nodes = currentState.nodes.filter((node) => !memberNodeIds.has(node.id));
    const groups = currentState.groups.filter((group) => group.id !== selectedGroup.id);

    set({
      nodes,
      edges: currentState.edges.filter(
        (edge) => !memberNodeIds.has(edge.source) && !memberNodeIds.has(edge.target),
      ),
      groups,
      layerOrder: layerOrderFor(currentState.layerOrder, nodes, groups),
      selectedNodeIds: [],
      selectedGroupId: null,
      editingNodeId: null,
    });
  },

}));
