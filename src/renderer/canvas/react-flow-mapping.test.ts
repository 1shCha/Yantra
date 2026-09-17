import { describe, expect, it } from 'vitest';
import { getFlowNodeWidth, getFlowNodeHeight, hydrateEdges, jsonCanvasEdgeFromFlowEdge, type MarkdownFlowNode } from './react-flow-mapping';

function node(overrides: Partial<MarkdownFlowNode> = {}): MarkdownFlowNode {
  return { id: 'node', type: 'markdownNode', position: { x: 10, y: 20 },
    data: { canvasType: 'text', documentId: 'document' }, style: { width: 320, height: 220 }, ...overrides };
}
describe('flow dimensions', () => {
  it('prefers measurements after resizing over stale width and style', () => {
    const resized = node({ width: 320, height: 220, measured: { width: 480, height: 360 } });
    expect(getFlowNodeWidth(resized)).toBe(480);
    expect(getFlowNodeHeight(resized)).toBe(360);
  });
  it('uses explicit dimensions, then style, then defaults', () => {
    expect(getFlowNodeWidth(node({ width: 410 }))).toBe(410);
    expect(getFlowNodeHeight(node({ style: { height: '290' } }))).toBe(290);
    expect(getFlowNodeWidth(node({ style: {} }))).toBe(220);
    expect(getFlowNodeHeight(node({ style: {} }))).toBe(75);
  });
});
it('preserves edge endpoints, decoration and label through flow mapping', () => {
  const edge = { id: 'edge', fromNode: 'a', toNode: 'b', fromSide: 'top', toSide: 'left',
    fromEnd: 'none', toEnd: 'arrow', color: '#ff0000', label: 'Relation' } as const;
  expect(hydrateEdges([edge]).map(jsonCanvasEdgeFromFlowEdge)).toEqual([edge]);
});
