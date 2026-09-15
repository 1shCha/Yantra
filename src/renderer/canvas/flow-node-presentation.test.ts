import { describe, expect, it } from 'vitest';
import { presentFlowNodes } from './flow-node-presentation';
import type { MarkdownFlowNode } from './react-flow-mapping';

const node = (id: string): MarkdownFlowNode => ({ id, type: 'markdownNode', position: { x: 0, y: 0 }, data: { canvasType: 'text' } });

describe('flow node presentation identity', () => {
  it('reuses unchanged nodes across insertion, selection and stacking changes', () => {
    const a = node('a'), b = node('b'), c = node('c');
    const z = new Map([['a', 2], ['b', 4], ['c', 6]]);
    const before = presentFlowNodes([a, b], [], z);
    const added = presentFlowNodes([a, b, c], ['c'], z);
    expect(added[0]).toBe(before[0]);
    expect(added[1]).toBe(before[1]);
    const selected = presentFlowNodes([a, b, c], ['a'], z);
    expect(selected[0]).not.toBe(added[0]);
    expect(selected[1]).toBe(added[1]);
    expect(selected[2]?.selected).toBe(false);
    const raised = presentFlowNodes([a, b, c], ['a'], new Map(z).set('a', 8));
    expect(raised[0]?.zIndex).toBe(8);
    expect(raised[1]).toBe(selected[1]);
    expect(raised[2]).toBe(selected[2]);
    const moved = presentFlowNodes([a, { ...b, position: { x: 50, y: 25 } }, c], ['a'], new Map(z).set('a', 8));
    expect(moved[0]).toBe(raised[0]);
    expect(moved[1]?.position).toEqual({ x: 50, y: 25 });
    expect(moved[2]).toBe(raised[2]);
  });
});
