import { describe, expect, it } from 'vitest';

import type { CanvasNodeRect } from './react-flow-node-geometry';
import {
  calculateCompositeGroupOutline,
  calculateGroupHull,
  type HullPoint,
} from './group-hull';

function createRect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): CanvasNodeRect {
  return { id, x, y, width, height };
}

function expectOnlyOrthogonalSegments(points: readonly HullPoint[]) {
  expect(points.length).toBeGreaterThanOrEqual(4);

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    expect(current).toBeDefined();
    expect(next).toBeDefined();
    expect(current?.x === next?.x || current?.y === next?.y).toBe(true);
  }
}

describe('calculateGroupHull', () => {
  it('wraps aligned members in a padded outer rectangle', () => {
    const hull = calculateGroupHull(
      [createRect('left', 0, 0), createRect('right', 200, 0)],
      10,
    );

    expect(hull).toEqual([
      { x: -10, y: -10 },
      { x: 310, y: -10 },
      { x: 310, y: 90 },
      { x: -10, y: 90 },
    ]);
  });

  it('creates a polygon around staggered members without interior corners', () => {
    const hull = calculateGroupHull(
      [createRect('upper-left', 0, 0), createRect('lower-right', 200, 120)],
      0,
    );

    expect(hull).toHaveLength(6);
    expect(hull).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 300, y: 120 },
        { x: 300, y: 200 },
        { x: 200, y: 200 },
        { x: 0, y: 80 },
      ]),
    );
  });

  it('wraps overlapping and differently sized members', () => {
    const hull = calculateGroupHull(
      [createRect('first', 0, 0, 120, 90), createRect('second', 60, 40, 180, 140)],
      8,
    );

    expect(hull).toEqual(
      expect.arrayContaining([
        { x: -8, y: -8 },
        { x: 128, y: -8 },
        { x: 248, y: 32 },
        { x: 248, y: 188 },
        { x: 52, y: 188 },
        { x: -8, y: 98 },
      ]),
    );
  });

  it('deduplicates coincident rectangle corners', () => {
    const rect = createRect('same', 20, 30, 160, 100);
    const hull = calculateGroupHull([rect, { ...rect, id: 'duplicate' }], 0);

    expect(hull).toEqual([
      { x: 20, y: 30 },
      { x: 180, y: 30 },
      { x: 180, y: 130 },
      { x: 20, y: 130 },
    ]);
  });

  it('returns no polygon without members', () => {
    expect(calculateGroupHull([], 16)).toEqual([]);
  });
});

describe('calculateCompositeGroupOutline', () => {
  it('joins diagonal members with one clean edge-aligned L shape', () => {
    const outline = calculateCompositeGroupOutline(
      [createRect('upper-left', 0, 0), createRect('lower-right', 200, 120)],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expect(outline).toHaveLength(6);
    expect(outline).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 80 },
        { x: 0, y: 80 },
      ]),
    );
  });

  it('uses one long direct section between aligned member edges', () => {
    const outline = calculateCompositeGroupOutline(
      [createRect('left', 0, 0), createRect('right', 200, 0)],
      10,
    );

    expectOnlyOrthogonalSegments(outline);
    expect(outline).toEqual([
      { x: -10, y: -10 },
      { x: 310, y: -10 },
      { x: 310, y: 90 },
      { x: -10, y: 90 },
    ]);
  });

  it('traces the perimeter of edge-touching composite members', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('top-left', 0, 0, 180, 70),
        createRect('right', 180, 0, 160, 210),
        createRect('bottom', 0, 210, 340, 90),
      ],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expect(outline).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 340, y: 0 },
        { x: 340, y: 300 },
        { x: 0, y: 300 },
        { x: 0, y: 210 },
        { x: 180, y: 210 },
        { x: 180, y: 70 },
        { x: 0, y: 70 },
      ]),
    );
  });

  it('creates one broad outer envelope for populated upper and lower rows', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('top-left', 0, 0),
        createRect('top-middle', 150, 0),
        createRect('top-right', 300, 0),
        createRect('bottom-left', 30, 250),
        createRect('bottom-right', 270, 250),
      ],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expect(outline).toHaveLength(8);
    expect(outline).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 80 },
        { x: 370, y: 80 },
        { x: 370, y: 330 },
        { x: 30, y: 330 },
        { x: 30, y: 80 },
        { x: 0, y: 80 },
      ]),
    );
  });
});
