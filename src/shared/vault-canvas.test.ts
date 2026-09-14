import { describe, expect, it } from 'vitest';
import { canvasFileSchema, decodeCanvas, newCanvas } from './vault-canvas';

function populatedCanvas() {
  const canvas = newCanvas('Plan');
  const nodes = [0, 1].map((x) => ({ id: crypto.randomUUID(), documentId: crypto.randomUUID(), kind: 'document' as const,
    x: x * 400, y: 50, width: 320, height: 220 }));
  return { ...canvas, nodes, layerOrder: nodes.map((node) => node.id) };
}

describe('vault canvas format', () => {
  it('round-trips references, edges, groups, order, and viewport without document content', () => {
    const canvas = populatedCanvas();
    const group = { id: crypto.randomUUID(), nodeIds: canvas.nodes.map((node) => node.id) };
    canvas.groups = [group];
    canvas.layerOrder = [group.id];
    canvas.edges = [{ id: 'edge', fromNode: group.nodeIds[0]!, toNode: group.nodeIds[1]!, label: 'supports', fromSide: 'right', toEnd: 'arrow' }];
    canvas.viewport = { x: -200, y: 90, zoom: 0.75 };
    expect(decodeCanvas(JSON.stringify(canvas))).toEqual(canvas);
    expect(JSON.stringify(canvas)).not.toContain('"doc":');
  });

  it('rejects embedded content, unknown versions, and invalid dimensions', () => {
    const canvas = populatedCanvas();
    expect(canvasFileSchema.safeParse({ ...canvas, nodes: [{ ...canvas.nodes[0], doc: { type: 'doc' } }] }).success).toBe(false);
    expect(() => decodeCanvas(JSON.stringify({ ...canvas, formatVersion: 2 }))).toThrow('Unsupported');
    expect(canvasFileSchema.safeParse({ ...canvas, nodes: canvas.nodes.map((node) => ({ ...node, width: 0 })) }).success).toBe(false);
  });

  it('rejects duplicate node IDs, duplicate appearances, and dangling edges', () => {
    const canvas = populatedCanvas();
    expect(canvasFileSchema.safeParse({ ...canvas, nodes: [canvas.nodes[0], canvas.nodes[0]] }).success).toBe(false);
    expect(canvasFileSchema.safeParse({ ...canvas, nodes: canvas.nodes.map((node) => ({ ...node, documentId: canvas.nodes[0]!.documentId })) }).success).toBe(false);
    expect(canvasFileSchema.safeParse({ ...canvas, edges: [{ id: 'edge', fromNode: 'absent', toNode: canvas.nodes[0]!.id }] }).success).toBe(false);
  });

  it('rejects overlapping groups and incomplete layer order rather than silently repairing them', () => {
    const canvas = populatedCanvas();
    expect(canvasFileSchema.safeParse({ ...canvas, layerOrder: [] }).success).toBe(false);
    expect(canvasFileSchema.safeParse({ ...canvas, groups: [
      { id: 'a', nodeIds: canvas.layerOrder }, { id: 'b', nodeIds: canvas.layerOrder },
    ], layerOrder: ['a', 'b'] }).success).toBe(false);
  });
});
