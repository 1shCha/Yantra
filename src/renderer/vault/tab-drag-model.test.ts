import { describe, expect, it } from 'vitest';
import { pointerContentDelta, previewTabDrag, tabDragShouldCommit, toContentRects, type TabDragRect } from './tab-drag-model';

const TAB = 160;
const GAP = 4;
const STEP = TAB + GAP;

function strip(count: number, startScroll = 0): TabDragRect[] {
  return toContentRects(Array.from({ length: count }, (_, index) => {
    const left = index * STEP;
    return { left, right: left + TAB, width: TAB };
  }), startScroll);
}

function walk(rects: TabDragRect[], from: number, deltas: number[]) {
  let to = from;
  let previousDelta = 0;
  let offsets = rects.map(() => 0);
  for (const delta of deltas) {
    ({ to, offsets } = previewTabDrag(rects, from, to, previousDelta, delta));
    previousDelta = delta;
  }
  return { to, offsets };
}

function leadingEdgeDeltas(rects: TabDragRect[], from: number, direction: number) {
  const neighbor = from + direction;
  const source = rects[from]!;
  const target = rects[neighbor]!;
  const crossing = target.left + target.width / 2 - (direction > 0 ? source.right : source.left);
  const shiftedMiddle = target.left + target.width / 2 - direction * STEP;
  const reverseCrossing = shiftedMiddle - (direction > 0 ? source.left : source.right);
  return { crossing, reverseCrossing };
}

describe('tab drag slot model', () => {
  it('keeps the original slot when the leading edge has not crossed a midpoint', () => {
    const rects = strip(3);
    const { crossing } = leadingEdgeDeltas(rects, 0, 1);
    const preview = walk(rects, 0, [crossing - 3]);
    expect(preview.to).toBe(0);
    expect(preview.offsets).toEqual([crossing - 3, 0, 0]);
  });

  it('swaps right when the leading edge crosses the neighbor midpoint', () => {
    const rects = strip(3);
    const { crossing } = leadingEdgeDeltas(rects, 0, 1);
    const preview = walk(rects, 0, [crossing - 3, crossing + 3]);
    expect(preview.to).toBe(1);
    expect(preview.offsets[1]).toBe(-STEP);
  });

  it('swaps left when the leading edge crosses the neighbor midpoint', () => {
    const rects = strip(3);
    const { crossing } = leadingEdgeDeltas(rects, 2, -1);
    const preview = walk(rects, 2, [crossing + 3, crossing - 3]);
    expect(preview.to).toBe(1);
    expect(preview.offsets[1]).toBe(STEP);
  });

  it('retains the slot until the opposite leading edge crosses the shifted midpoint', () => {
    const rects = strip(3);
    const { crossing, reverseCrossing } = leadingEdgeDeltas(rects, 0, 1);
    const held = walk(rects, 0, [crossing + 3, reverseCrossing + 1]);
    expect(held.to).toBe(1);
    expect(held.offsets[1]).toBe(-STEP);
    const released = walk(rects, 0, [crossing + 3, reverseCrossing + 1, reverseCrossing - 3]);
    expect(released.to).toBe(0);
    expect(released.offsets[1]).toBe(0);
  });

  it('includes scroll on both the dragged edge and neighbor midpoints', () => {
    const startScroll = 80;
    const rects = strip(3, startScroll);
    const { crossing } = leadingEdgeDeltas(rects, 0, 1);
    const before = walk(rects, 0, [pointerContentDelta(0, 0, startScroll, startScroll) + crossing - 3]);
    expect(before.to).toBe(0);
    const scrolled = pointerContentDelta(crossing + 3, 0, startScroll + 24, startScroll);
    const after = walk(rects, 0, [scrolled]);
    expect(after.to).toBe(1);
    expect(after.offsets[0]).toBe(scrolled);
    expect(after.offsets[1]).toBe(-STEP);
  });

  it('does not change slots when the pointer returns to the origin', () => {
    const rects = strip(3);
    expect(previewTabDrag(rects, 1, 1, 0, 0)).toEqual({ to: 1, offsets: [0, 0, 0] });
  });
});

describe('tab drag commit rules', () => {
  const open = { dragging: true, busy: false, tabOpen: true, from: 0, to: 2 } as const;

  it('commits pointerup, pointercancel, and lost capture after a drag starts', () => {
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup' })).toBe(true);
    expect(tabDragShouldCommit({ ...open, reason: 'pointercancel' })).toBe(true);
    expect(tabDragShouldCommit({ ...open, reason: 'lostpointercapture' })).toBe(true);
  });

  it('does not commit Escape or a replaced session', () => {
    expect(tabDragShouldCommit({ ...open, reason: 'escape' })).toBe(false);
    expect(tabDragShouldCommit({ ...open, reason: 'replace' })).toBe(false);
  });

  it('still commits after the tabs array is replaced if the tab remains open', () => {
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup', tabOpen: true })).toBe(true);
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup', tabOpen: false })).toBe(false);
  });

  it('skips a no-op drop, a busy workspace, or a click that never became a drag', () => {
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup', to: 0 })).toBe(false);
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup', busy: true })).toBe(false);
    expect(tabDragShouldCommit({ ...open, reason: 'pointerup', dragging: false })).toBe(false);
  });
});
