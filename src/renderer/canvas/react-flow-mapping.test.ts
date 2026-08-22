import { describe, expect, it } from 'vitest';

import { REACT_FLOW_TEXT_NODE_TYPE, JSON_CANVAS_TEXT_NODE_TYPE } from '../../shared/json-canvas';
import { toJsonCanvasDocument, type MarkdownFlowNode } from './react-flow-mapping';

function createFlowNode(overrides: Partial<MarkdownFlowNode> = {}): MarkdownFlowNode {
  return {
    id: 'node-1',
    type: REACT_FLOW_TEXT_NODE_TYPE,
    position: { x: 10, y: 20 },
    data: {
      canvasType: JSON_CANVAS_TEXT_NODE_TYPE,
      text: 'Hello',
      content: 'Hello',
    },
    style: {
      width: 320,
      height: 220,
    },
    ...overrides,
  };
}

describe('toJsonCanvasDocument', () => {
  it('persists resized dimensions from measured width and height', () => {
    const document = toJsonCanvasDocument({
      nodes: [
        createFlowNode({
          measured: { width: 480, height: 360 },
        }),
      ],
      edges: [],
    });

    expect(document.nodes[0]).toMatchObject({
      width: 480,
      height: 360,
    });
  });

  it('prefers measured dimensions over stale style values after resize', () => {
    const document = toJsonCanvasDocument({
      nodes: [
        createFlowNode({
          measured: { width: 410, height: 290 },
          style: { width: 320, height: 220 },
        }),
      ],
      edges: [],
    });

    expect(document.nodes[0]?.width).toBe(410);
    expect(document.nodes[0]?.height).toBe(290);
  });
});
