import { describe, expect, it } from 'vitest';

import {
  deriveLayerOrder,
  getStackingZIndices,
  moveUnitToFront,
  reconcileLayerOrder,
  stackingUnitIdForNode,
} from './stacking-order';

const groupA = {
  id: 'group-a',
  nodeIds: ['a-1', 'a-2'],
};

const groupB = {
  id: 'group-b',
  nodeIds: ['b-1', 'b-2'],
};

describe('deriveLayerOrder', () => {
  it('treats a group as one unit at the first member in node order', () => {
    expect(
      deriveLayerOrder(['loose-1', 'a-1', 'loose-2', 'a-2', 'b-1', 'b-2'], [groupA, groupB]),
    ).toEqual(['loose-1', 'group-a', 'loose-2', 'group-b']);
  });
});

describe('reconcileLayerOrder', () => {
  it('keeps saved order, drops stale ids, and appends new units', () => {
    expect(
      reconcileLayerOrder(
        ['missing', 'group-b', 'loose-1', 'group-b'],
        ['loose-1', 'a-1', 'a-2', 'loose-2', 'b-1', 'b-2'],
        [groupA, groupB],
      ),
    ).toEqual(['group-b', 'loose-1', 'group-a', 'loose-2']);
  });
});

describe('moveUnitToFront', () => {
  it('moves an existing unit to the top and appends unknown units', () => {
    expect(moveUnitToFront(['loose-1', 'group-a', 'loose-2'], 'group-a')).toEqual([
      'loose-1',
      'loose-2',
      'group-a',
    ]);
    expect(moveUnitToFront(['loose-1'], 'loose-1')).toEqual(['loose-1']);
    expect(moveUnitToFront(['loose-1'], 'loose-2')).toEqual(['loose-1', 'loose-2']);
  });
});

describe('stackingUnitIdForNode', () => {
  it('returns the owning group id for members and the node id otherwise', () => {
    expect(stackingUnitIdForNode('a-2', [groupA, groupB])).toBe('group-a');
    expect(stackingUnitIdForNode('loose-1', [groupA, groupB])).toBe('loose-1');
  });
});

describe('getStackingZIndices', () => {
  it('keeps a group outline below its members and later units above earlier ones', () => {
    const stacking = getStackingZIndices(['group-a', 'loose-1', 'group-b'], [groupA, groupB]);

    expect(stacking.groupOutlineZIndexById.get('group-a')).toBe(1);
    expect(stacking.nodeZIndexById.get('a-1')).toBe(2);
    expect(stacking.nodeZIndexById.get('a-2')).toBe(2);
    expect(stacking.nodeZIndexById.get('loose-1')).toBe(4);
    expect(stacking.groupOutlineZIndexById.get('group-b')).toBe(5);
    expect(stacking.nodeZIndexById.get('b-1')).toBe(6);

    expect(stacking.nodeZIndexById.get('loose-1') ?? 0).toBeGreaterThan(
      stacking.nodeZIndexById.get('a-1') ?? 0,
    );
    expect(stacking.nodeZIndexById.get('b-1') ?? 0).toBeGreaterThan(
      stacking.nodeZIndexById.get('loose-1') ?? 0,
    );
    expect(stacking.groupOutlineZIndexById.get('group-b') ?? 0).toBeGreaterThan(
      stacking.nodeZIndexById.get('loose-1') ?? 0,
    );
  });
});

describe('stable stacking during deletion', () => {
  it('preserves surviving layers and appends above them without compacting gaps', () => {
    const bases = new Map<string, number>();
    const before = getStackingZIndices(['a', 'b', 'c'], [], bases);
    const after = getStackingZIndices(['b', 'c'], [], bases);
    expect(after.nodeZIndexById).toEqual(new Map([...before.nodeZIndexById].filter(([id]) => id !== 'a')));
    const appended = getStackingZIndices(['b', 'c', 'd'], [], bases);
    expect(appended.nodeZIndexById.get('b')).toBe(before.nodeZIndexById.get('b'));
    expect(appended.nodeZIndexById.get('d')).toBeGreaterThan(appended.nodeZIndexById.get('c')!);
    expect(bases.has('a')).toBe(false);
  });

  it('still raises moved nodes and keeps group outlines below members', () => {
    const bases = new Map<string, number>();
    getStackingZIndices(['a', groupA.id, 'b'], [groupA], bases);
    const raised = getStackingZIndices([groupA.id, 'b', 'a'], [groupA], bases);
    expect(raised.nodeZIndexById.get('a')).toBeGreaterThan(raised.nodeZIndexById.get('b')!);
    expect(raised.nodeZIndexById.get('a-1')).toBeGreaterThan(raised.groupOutlineZIndexById.get(groupA.id)!);
  });
});
