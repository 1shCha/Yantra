import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;

function withoutSelection(node) {
  const { selected, ...rest } = node;
  return rest;
}

function createMarkdownNodeAt(position) {
  return {
    id: crypto.randomUUID(),
    type: 'markdownNode',
    position: {
      x: position.x - NODE_WIDTH / 2,
      y: position.y - NODE_HEIGHT / 2,
    },
    data: {
      content: '',
    },
    style: {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    },
  };
}

export const useCanvasStore = create(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      editingNodeId: null,

      onNodesChange: (changes) => {
        const currentState = get();
        const canMoveNodes = currentState.selectedNodeIds.length <= 1;
        const nodeChanges = canMoveNodes
          ? changes
          : changes.filter((change) => change.type !== 'position');
        const nodes = applyNodeChanges(nodeChanges, currentState.nodes);
        const hasSelectionChanges = changes.some((change) => change.type === 'select');
        const selectedNodeIds = hasSelectionChanges
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
    }),
    {
      name: 'yantra-canvas',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        nodes: state.nodes.map(withoutSelection),
        edges: state.edges,
      }),
    },
  ),
);
