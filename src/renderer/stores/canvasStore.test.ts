import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decodeJsonCanvasDocument,
  JSON_CANVAS_TEXT_NODE_TYPE,
  type JsonCanvasDocument,
} from '../../shared/json-canvas';
import { useCanvasStore } from './canvasStore';

const initialDocument = {
  nodes: [
    {
      id: 'moving-node',
      type: JSON_CANVAS_TEXT_NODE_TYPE,
      x: 10,
      y: 20,
      width: 320,
      height: 220,
      text: 'Moving',
    },
    {
      id: 'stationary-node',
      type: JSON_CANVAS_TEXT_NODE_TYPE,
      x: 400,
      y: 500,
      width: 320,
      height: 220,
      text: 'Stationary',
    },
  ],
  edges: [
    {
      id: 'edge-1',
      fromNode: 'moving-node',
      toNode: 'stationary-node',
    },
  ],
  groups: [],
} satisfies JsonCanvasDocument;

describe('setNodePosition', () => {
  beforeEach(() => {
    useCanvasStore.getState().loadJsonCanvasDocument(initialDocument);
  });

  afterEach(() => {
    useCanvasStore.getState().loadJsonCanvasDocument(null);
  });

  it('updates only the target node and serializes the snapped position', () => {
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
    expect(useCanvasStore.getState().getJsonCanvasDocument().nodes).toMatchObject([
      {
        id: 'moving-node',
        x: 140,
        y: 290,
      },
      {
        id: 'stationary-node',
        x: 400,
        y: 500,
      },
    ]);
  });
});

describe('group lifecycle', () => {
  beforeEach(() => {
    useCanvasStore.getState().loadJsonCanvasDocument(initialDocument);
    useCanvasStore.getState().selectNode('moving-node');
    useCanvasStore.getState().toggleNodeSelection('stationary-node');
    useCanvasStore.getState().groupSelectedNodes();
  });

  afterEach(() => {
    useCanvasStore.getState().loadJsonCanvasDocument(null);
  });

  it('sanitizes overlapping memberships during direct document loading', () => {
    useCanvasStore.getState().loadJsonCanvasDocument({
      ...initialDocument,
      groups: [
        {
          id: 'first-group',
          nodeIds: ['moving-node', 'stationary-node'],
        },
        {
          id: 'overlapping-group',
          nodeIds: ['stationary-node', 'moving-node'],
        },
      ],
    });

    expect(useCanvasStore.getState().groups).toEqual([
      {
        id: 'first-group',
        nodeIds: ['moving-node', 'stationary-node'],
      },
    ]);
  });

  it('creates and persists a non-nested group from selected nodes', () => {
    const state = useCanvasStore.getState();
    const group = state.groups[0];

    expect(group).toMatchObject({
      nodeIds: ['moving-node', 'stationary-node'],
    });
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.selectedGroupId).toBe(group?.id);
    expect(state.getJsonCanvasDocument().groups).toEqual(state.groups);

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

  it('restores groups, moved members, and edges after a serialized reload', () => {
    const groupId = useCanvasStore.getState().selectedGroupId;
    expect(groupId).not.toBeNull();
    useCanvasStore.getState().moveGroupBy(groupId ?? '', { x: 40, y: 25 });

    const savedDocument = useCanvasStore.getState().getJsonCanvasDocument();
    const reloadedDocument = decodeJsonCanvasDocument(JSON.stringify(savedDocument));
    useCanvasStore.getState().loadJsonCanvasDocument(reloadedDocument);

    expect(useCanvasStore.getState()).toMatchObject({
      groups: [
        {
          id: groupId,
          nodeIds: ['moving-node', 'stationary-node'],
        },
      ],
      nodes: [
        {
          id: 'moving-node',
          position: { x: 50, y: 45 },
        },
        {
          id: 'stationary-node',
          position: { x: 440, y: 525 },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'moving-node',
          target: 'stationary-node',
        },
      ],
      selectedGroupId: null,
    });
  });
});
