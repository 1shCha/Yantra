import { describe, expect, it } from 'vitest';

import type { CanvasNodeRect } from './react-flow-node-geometry';
import {
  DEFAULT_GROUP_OUTLINE_POLICY,
  calculateCompositeGroupOutline as calculateOutlineWithPolicy,
  type HullPoint,
} from './group-hull';

const GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS =
  DEFAULT_GROUP_OUTLINE_POLICY.edgeMergeTolerance;

function calculateCompositeGroupOutline(
  memberRects: readonly CanvasNodeRect[],
  padding: number,
): HullPoint[] {
  return calculateOutlineWithPolicy(memberRects, {
    ...DEFAULT_GROUP_OUTLINE_POLICY,
    padding,
  });
}

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

function canonicalizePolygon(points: readonly HullPoint[]): HullPoint[] {
  const orientations = [[...points], [...points].reverse()];
  const rotations = orientations.flatMap((orientation) =>
    orientation.map((_, index) => [
      ...orientation.slice(index),
      ...orientation.slice(0, index),
    ]),
  );

  rotations.sort((first, second) => {
    const firstKey = first.map((point) => `${point.x},${point.y}`).join(';');
    const secondKey = second.map((point) => `${point.x},${point.y}`).join(';');
    return firstKey.localeCompare(secondKey);
  });

  return rotations[0] ?? [];
}

function expectPolygonEqual(
  actual: readonly HullPoint[],
  expected: readonly HullPoint[],
): void {
  expect(canonicalizePolygon(actual)).toEqual(canonicalizePolygon(expected));
}

describe('calculateCompositeGroupOutline', () => {
  it('applies padding and edge tolerance from one policy object', () => {
    const outline = calculateOutlineWithPolicy(
      [createRect('left', 0, 0), createRect('right', 140, 0, 100, 88)],
      {
        edgeMergeTolerance: 0,
        padding: 5,
      },
    );

    expectPolygonEqual(outline, [
      { x: -5, y: -5 },
      { x: 245, y: -5 },
      { x: 245, y: 93 },
      { x: 135, y: 93 },
      { x: 135, y: 85 },
      { x: -5, y: 85 },
    ]);
  });

  it('compares equivalent polygons independent of start vertex and winding', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];

    expectPolygonEqual(
      [
        { x: 100, y: 80 },
        { x: 100, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 80 },
      ],
      polygon,
    );
  });

  it('joins diagonal members with one clean edge-aligned L shape', () => {
    const outline = calculateCompositeGroupOutline(
      [createRect('upper-left', 0, 0), createRect('lower-right', 200, 120)],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 80 },
      { x: 0, y: 80 },
    ]);
  });

  it('uses one long direct section between aligned member edges', () => {
    const outline = calculateCompositeGroupOutline(
      [createRect('left', 0, 0), createRect('right', 200, 0)],
      10,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
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
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 340, y: 0 },
      { x: 340, y: 300 },
      { x: 0, y: 300 },
    ]);
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
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 80 },
      { x: 370, y: 80 },
      { x: 370, y: 330 },
      { x: 30, y: 330 },
      { x: 30, y: 80 },
      { x: 0, y: 80 },
    ]);
  });

  it('wraps one member in its padded rectangle', () => {
    expectPolygonEqual(
      calculateCompositeGroupOutline([createRect('single', 20, 30, 120, 90)], 8),
      [
        { x: 12, y: 22 },
        { x: 148, y: 22 },
        { x: 148, y: 128 },
        { x: 12, y: 128 },
      ],
    );
  });

  it('traces the union of partially overlapping members', () => {
    expectPolygonEqual(
      calculateCompositeGroupOutline(
        [createRect('first', 0, 0, 120, 100), createRect('second', 60, 40, 120, 100)],
        0,
      ),
      [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 40 },
        { x: 180, y: 40 },
        { x: 180, y: 140 },
        { x: 60, y: 140 },
        { x: 60, y: 100 },
        { x: 0, y: 100 },
      ],
    );
  });

  it('merges members that share an edge without a connector notch', () => {
    expectPolygonEqual(
      calculateCompositeGroupOutline(
        [createRect('left', 0, 0), createRect('right', 100, 0)],
        0,
      ),
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 80 },
        { x: 0, y: 80 },
      ],
    );
  });

  it('is geometrically deterministic when member input order changes', () => {
    const members = [
      createRect('center', 160, 100),
      createRect('upper-left', 0, 0),
      createRect('lower-right', 320, 200),
    ];
    const expected = calculateCompositeGroupOutline(members, 12);

    expectPolygonEqual(
      calculateCompositeGroupOutline([...members].reverse(), 12),
      expected,
    );
    expectPolygonEqual(
      calculateCompositeGroupOutline([members[1]!, members[2]!, members[0]!], 12),
      expected,
    );
  });

  it('keeps a large compressed-grid outline deterministic and orthogonal', () => {
    const members = Array.from({ length: 64 }, (_, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      return createRect(
        `member-${index.toString().padStart(2, '0')}`,
        column * 137 + row * 3,
        row * 113 + column * 2,
        80 + (index % 3),
        60 + (index % 5),
      );
    });
    const outline = calculateCompositeGroupOutline(members, 16);

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(
      calculateCompositeGroupOutline([...members].reverse(), 16),
      outline,
    );
  });

  it('flattens a near-aligned bottom stair by expanding to the outer edge', () => {
    const outline = calculateCompositeGroupOutline(
      [createRect('node-3', 0, 0, 120, 80), createRect('big-fat', 160, 0, 80, 88)],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 88 },
      { x: 0, y: 88 },
    ]);
  });

  it('merges bottoms that differ by exactly the edge-merge tolerance', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('left', 0, 0, 100, 80),
        createRect(
          'right',
          140,
          0,
          100,
          80 + GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS,
        ),
      ],
      0,
    );

    expect(new Set(outline.map((point) => point.y))).toEqual(
      new Set([0, 80 + GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS]),
    );
  });

  it('keeps a true bottom offset larger than the edge-merge tolerance', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('left', 0, 0, 100, 80),
        createRect(
          'right',
          140,
          0,
          100,
          80 + GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS + 1,
        ),
      ],
      0,
    );

    expect(new Set(outline.map((point) => point.y))).toEqual(
      new Set([0, 80, 80 + GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS + 1]),
    );
  });

  it('fills a 3-sided inroad and keeps a taller spine as an outer step', () => {
    const topHeight = 70;
    const gap = GROUP_OUTLINE_EDGE_MERGE_FLOW_UNITS + 12;
    const bottomTop = topHeight + gap;
    const bottomHeight = 80;
    const leftWidth = 180;
    const gutter = 20;
    const rightWidth = 80;
    const rightHeight = 200;
    const rightLeft = leftWidth + gutter;
    const outline = calculateCompositeGroupOutline(
      [
        createRect('top-left', 0, 0, leftWidth, topHeight),
        createRect('right', rightLeft, 0, rightWidth, rightHeight),
        createRect('bottom', 0, bottomTop, leftWidth, bottomHeight),
      ],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: rightLeft + rightWidth, y: 0 },
      { x: rightLeft + rightWidth, y: rightHeight },
      { x: rightLeft, y: rightHeight },
      { x: rightLeft, y: bottomTop + bottomHeight },
      { x: 0, y: bottomTop + bottomHeight },
    ]);
  });

  it('fills a horizontal slit inroad without squaring off a staggered bottom step', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('node-1', 0, 0, 220, 70),
        createRect('node-2', 0, 100, 70, 80),
        createRect('node-3', 90, 100, 80, 80),
        createRect('big-fat', 220, 0, 70, 188),
      ],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 290, y: 0 },
      { x: 290, y: 188 },
      { x: 0, y: 188 },
    ]);
  });

  it('keeps a right-side step when the lower row is narrower than the upper row', () => {
    const outline = calculateCompositeGroupOutline(
      [
        createRect('tall', 0, 0, 80, 200),
        createRect('top-right', 100, 0, 80, 80),
        createRect('bottom', 0, 120, 160, 80),
      ],
      0,
    );

    expectOnlyOrthogonalSegments(outline);
    expectPolygonEqual(outline, [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 80 },
      { x: 160, y: 80 },
      { x: 160, y: 200 },
      { x: 0, y: 200 },
    ]);
  });
});
