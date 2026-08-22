import { describe, expect, it } from 'vitest';

import {
  decodeJsonCanvasDocument,
  encodeJsonCanvasDocument,
  JSON_CANVAS_TEXT_NODE_TYPE,
} from './json-canvas';

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
      text: 'Hello',
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
      text: 'From data.content',
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

    expect(document.nodes[0]?.text).toBe('Nested text');
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

    expect(document).toEqual({ nodes: [], edges: [] });
  });
});

describe('encodeJsonCanvasDocument', () => {
  it('accepts a normalized document from decode', () => {
    const document = decodeJsonCanvasDocument(
      JSON.stringify({
        nodes: [{ type: JSON_CANVAS_TEXT_NODE_TYPE, x: 1, y: 2, text: 'ok' }],
        edges: [],
      }),
    );

    expect(encodeJsonCanvasDocument(document)).toEqual(document);
  });
});
