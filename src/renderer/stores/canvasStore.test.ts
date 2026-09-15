import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownFlowNode } from '../canvas/react-flow-mapping';
import { tiptapDocFromPlainText } from '../../shared/tiptap-document';
import { createCanvasStore } from './canvasStore';

const onCreateNode = vi.fn();
const onUpdateNodeDoc = vi.fn();
const useCanvasStore = createCanvasStore({ onCreateNode, onUpdateNodeDoc });
function reference(id: string, x: number, y: number): MarkdownFlowNode {
  return { id, type: 'markdownNode', position: { x, y }, width: 320, height: 220,
    data: { canvasType: 'text', documentId: `document-${id}` } };
}
function resetStore() {
  useCanvasStore.setState({ nodes: [reference('moving-node', 10, 20), reference('stationary-node', 400, 500)],
    edges: [{ id: 'edge-1', source: 'moving-node', target: 'stationary-node' }],
    groups: [], layerOrder: ['moving-node', 'stationary-node'], selectedNodeIds: [], selectedGroupId: null, editingNodeId: null });
}
function addReference() {
  const state = useCanvasStore.getState();
  useCanvasStore.setState({ nodes: [...state.nodes, reference('added-node', 800, 100)],
    layerOrder: [...state.layerOrder, 'added-node'] });
  useCanvasStore.getState().selectNode('added-node');
}

it('delegates creation and content updates to the document owner', () => {
  resetStore();
  const before = useCanvasStore.getState().nodes;
  const doc = tiptapDocFromPlainText('Updated');
  useCanvasStore.getState().createMarkdownNode({ x: 40, y: 60 });
  useCanvasStore.getState().updateNodeDoc('moving-node', doc);
  expect(onCreateNode).toHaveBeenCalledWith({ x: 40, y: 60 });
  expect(onUpdateNodeDoc).toHaveBeenCalledWith('moving-node', doc);
  expect(useCanvasStore.getState().nodes).toBe(before);
  expect(before.every((node) => node.data.doc === undefined)).toBe(true);
});

describe('node activation', () => {
  beforeEach(() => {
    resetStore();
  });

  it('allows a newly created node to be dragged without entering edit mode', () => {
    addReference();
    const nodeId = useCanvasStore.getState().selectedNodeIds[0]!;

    useCanvasStore.getState().activateNode(nodeId);
    useCanvasStore.getState().setNodePosition(nodeId, { x: 200, y: 300 });

    expect(useCanvasStore.getState().editingNodeId).toBeNull();
    expect(useCanvasStore.getState().selectedNodeIds).toEqual([nodeId]);
    expect(useCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.position)
      .toEqual({ x: 200, y: 300 });
  });

  it('keeps repeated presses as selection until editing is explicitly requested', () => {
    useCanvasStore.getState().activateNode('moving-node');
    useCanvasStore.getState().activateNode('moving-node');
    expect(useCanvasStore.getState().editingNodeId).toBeNull();

    useCanvasStore.getState().editNode('moving-node');
    expect(useCanvasStore.getState().editingNodeId).toBe('moving-node');
  });
});

describe('setNodePosition', () => {
  beforeEach(() => {
    resetStore();
  });

  it('updates the target node while preserving its neighbors', () => {
    useCanvasStore.getState().setNodePosition('moving-node', { x: 140, y: 290 });

    expect(useCanvasStore.getState().nodes).toMatchObject([
      {
        id: 'moving-node',
        position: { x: 140, y: 290 },
      },
      {
        id: 'stationary-node',
        position: { x: 400, y: 500 },
      },
    ]);
  });
});

describe('group lifecycle', () => {
  beforeEach(() => {
    resetStore();
    useCanvasStore.getState().selectNode('moving-node');
    useCanvasStore.getState().toggleNodeSelection('stationary-node');
    useCanvasStore.getState().groupSelectedNodes();
  });

  it('creates a non-nested group from selected nodes', () => {
    const state = useCanvasStore.getState();
    const group = state.groups[0];

    expect(group).toMatchObject({
      nodeIds: ['moving-node', 'stationary-node'],
    });
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.selectedGroupId).toBe(group?.id);

    state.selectNode('moving-node');
    state.toggleNodeSelection('stationary-node');
    state.groupSelectedNodes();

    expect(useCanvasStore.getState().groups).toHaveLength(1);
  });

  it('moves every member by the same delta', () => {
    const group = useCanvasStore.getState().groups[0];
    expect(group).toBeDefined();

    useCanvasStore.getState().moveGroupBy(group?.id ?? '', { x: 25, y: -10 });

    expect(useCanvasStore.getState().nodes).toMatchObject([
      {
        id: 'moving-node',
        position: { x: 35, y: 10 },
      },
      {
        id: 'stationary-node',
        position: { x: 425, y: 490 },
      },
    ]);
  });

  it('ungroups without removing member nodes', () => {
    useCanvasStore.getState().ungroupSelectedGroup();

    expect(useCanvasStore.getState().groups).toEqual([]);
    expect(useCanvasStore.getState().nodes).toHaveLength(2);
    expect(useCanvasStore.getState().selectedGroupId).toBeNull();
  });

  it('deletes a selected group with all members and incident edges', () => {
    useCanvasStore.getState().deleteSelectedGroup();

    expect(useCanvasStore.getState()).toMatchObject({
      nodes: [],
      edges: [],
      groups: [],
      selectedGroupId: null,
    });
  });

  it('dissolves a group when individual deletion leaves fewer than two members', () => {
    useCanvasStore.getState().selectNode('moving-node');
    useCanvasStore.getState().deleteSelectedNodes();

    expect(useCanvasStore.getState().nodes).toMatchObject([
      {
        id: 'stationary-node',
      },
    ]);
    expect(useCanvasStore.getState().groups).toEqual([]);
  });
});

describe('stacking order', () => {
  beforeEach(() => {
    resetStore();
  });

  it('raises a node above other nodes', () => {
    useCanvasStore.getState().raiseNodeStacking('moving-node');
    expect(useCanvasStore.getState().layerOrder).toEqual(['stationary-node', 'moving-node']);

    useCanvasStore.getState().raiseNodeStacking('stationary-node');
    expect(useCanvasStore.getState().layerOrder).toEqual(['moving-node', 'stationary-node']);
  });

  it('raises a group as one unit including its members', () => {
    useCanvasStore.getState().selectNode('moving-node');
    useCanvasStore.getState().toggleNodeSelection('stationary-node');
    useCanvasStore.getState().groupSelectedNodes();
    const groupId = useCanvasStore.getState().selectedGroupId;
    expect(groupId).not.toBeNull();
    expect(useCanvasStore.getState().layerOrder).toEqual([groupId]);

    addReference();
    const createdNodeId = useCanvasStore.getState().selectedNodeIds[0];
    expect(createdNodeId).toEqual(expect.any(String));
    expect(useCanvasStore.getState().layerOrder).toEqual([groupId, createdNodeId]);

    useCanvasStore.getState().raiseStackingUnit(groupId ?? '');
    expect(useCanvasStore.getState().layerOrder).toEqual([createdNodeId, groupId]);

    useCanvasStore.getState().raiseNodeStacking('moving-node');
    expect(useCanvasStore.getState().layerOrder).toEqual([createdNodeId, groupId]);
  });
});
