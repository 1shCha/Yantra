import { describe, expect, it } from 'vitest';

import {
  decodeJsonCanvasDocument,
  encodeJsonCanvasDocument,
  JSON_CANVAS_TEXT_NODE_TYPE,
} from './json-canvas';
import { tiptapDocFromPlainText } from './tiptap-document';

describe('decodeJsonCanvasDocument', () => {
  it('parses a strict JSON Canvas file', () => {
    const raw = JSON.stringify({
      nodes: [
        {
          id: 'node-1',
          type: JSON_CANVAS_TEXT_NODE_TYPE,
          x: 10,
          y: 20,
          width: 320,
          height: 220,
          text: 'Hello',
          color: 'red',
        },
      ],
      edges: [
        {
          id: 'edge-1',
          fromNode: 'node-1',
          toNode: 'node-2',
          fromSide: 'right',
          toSide: 'left',
        },
      ],
    });

    const document = decodeJsonCanvasDocument(raw);

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]).toMatchObject({
      id: 'node-1',
      type: JSON_CANVAS_TEXT_NODE_TYPE,
      x: 10,
      y: 20,
      doc: tiptapDocFromPlainText('Hello'),
      color: 'red',
    });
    expect(document.edges[0]?.fromNode).toBe('node-1');
  });

  it('accepts React Flow-shaped nodes and numeric string coordinates', () => {
    const raw = JSON.stringify({
      nodes: [
        {
          type: 'markdownNode',
          position: { x: '100', y: '50' },
          data: { content: 'From data.content' },
          style: { width: '400', height: '300' },
        },
      ],
      edges: [],
    });

    const document = decodeJsonCanvasDocument(raw);

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]).toMatchObject({
      type: JSON_CANVAS_TEXT_NODE_TYPE,
      x: 100,
      y: 50,
      width: 400,
      height: 300,
      doc: tiptapDocFromPlainText('From data.content'),
    });
    expect(document.nodes[0]?.id).toEqual(expect.any(String));
  });

  it('invents an id when missing and reads text from data.text', () => {
    const raw = JSON.stringify({
      nodes: [
        {
          type: JSON_CANVAS_TEXT_NODE_TYPE,
          x: 0,
          y: 0,
          data: { text: 'Nested text' },
        },
      ],
      edges: [],
    });

    const document = decodeJsonCanvasDocument(raw);

    expect(document.nodes[0]?.doc).toEqual(tiptapDocFromPlainText('Nested text'));
    expect(document.nodes[0]?.id).toEqual(expect.any(String));
  });

  it('drops malformed edges and unknown node types', () => {
    const raw = JSON.stringify({
      nodes: [{ type: 'image', x: 0, y: 0 }],
      edges: [{ fromNode: 'a' }, { source: 'a', target: 'b' }],
    });

    const document = decodeJsonCanvasDocument(raw);

    expect(document.nodes).toHaveLength(0);
    expect(document.edges).toHaveLength(1);
    expect(document.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'b' });
  });

  it('returns empty arrays for a missing canvas file payload', () => {
    const document = decodeJsonCanvasDocument(JSON.stringify({}));

    expect(document).toEqual({ nodes: [], edges: [], groups: [], layerOrder: [] });
  });

  it('sanitizes persistent group membership deterministically', () => {
    const nodes = ['node-a', 'node-b', 'node-c', 'node-d', 'node-e', 'node-f'].map((id, index) => ({
      id,
      type: JSON_CANVAS_TEXT_NODE_TYPE,
      x: index * 100,
      y: 0,
      width: 80,
      height: 60,
      text: id,
    }));

    const document = decodeJsonCanvasDocument(
      JSON.stringify({
        nodes,
        edges: [],
        groups: [
          {
            id: 'group-1',
            nodeIds: ['node-a', 'node-a', 'node-b', 'missing-node'],
          },
          {
            id: 'group-2',
            nodeIds: ['node-b', 'node-c', 'node-d'],
          },
          {
            id: 'discarded-group',
            nodeIds: ['node-d'],
          },
          {
            id: 'group-1',
            nodeIds: ['node-e', 'node-f'],
          },
        ],
      }),
    );

    expect(document.groups).toEqual([
      {
        id: 'group-1',
        nodeIds: ['node-a', 'node-b'],
      },
      {
        id: 'group-2',
        nodeIds: ['node-c', 'node-d'],
      },
    ]);
    expect(document.layerOrder).toEqual(['group-1', 'group-2', 'node-e', 'node-f']);
  });

  it('restores a saved layer order and ignores stale ids', () => {
    const document = decodeJsonCanvasDocument(
      JSON.stringify({
        nodes: [
          {
            id: 'node-a',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 0,
            y: 0,
            width: 80,
            height: 60,
            text: 'a',
          },
          {
            id: 'node-b',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 100,
            y: 0,
            width: 80,
            height: 60,
            text: 'b',
          },
          {
            id: 'node-c',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 200,
            y: 0,
            width: 80,
            height: 60,
            text: 'c',
          },
        ],
        edges: [],
        groups: [{ id: 'group-1', nodeIds: ['node-a', 'node-b'] }],
        layerOrder: ['missing', 'node-c', 'group-1', 'node-c'],
      }),
    );

    expect(document.layerOrder).toEqual(['node-c', 'group-1']);
  });
});

describe('encodeJsonCanvasDocument', () => {
  it('accepts a normalized document from decode', () => {
    const document = decodeJsonCanvasDocument(
      JSON.stringify({
        nodes: [
          {
            id: 'node-1',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 1,
            y: 2,
            text: 'first',
          },
          {
            id: 'node-2',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 301,
            y: 202,
            text: 'second',
          },
        ],
        edges: [],
        groups: [{ id: 'group-1', nodeIds: ['node-1', 'node-2'] }],
      }),
    );

    expect(encodeJsonCanvasDocument(document)).toEqual(document);
  });

  it('persists a TipTap document with marks instead of a text string', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
        },
      ],
    };
    const document = decodeJsonCanvasDocument(
      JSON.stringify({
        nodes: [
          {
            id: 'node-1',
            type: JSON_CANVAS_TEXT_NODE_TYPE,
            x: 0,
            y: 0,
            width: 320,
            height: 220,
            doc,
          },
        ],
        edges: [],
      }),
    );

    expect(document.nodes[0]?.doc).toEqual(doc);
    expect(encodeJsonCanvasDocument(document).nodes[0]?.doc).toEqual(doc);
  });
});
