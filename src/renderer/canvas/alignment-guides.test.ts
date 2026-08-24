import { describe, expect, it } from 'vitest';

import {
  calculateAlignment,
  calculateResizeAlignment,
  getResizeActiveAnchors,
  isAlignmentRectVisible,
  type AlignmentAnchor,
  type AlignmentRect,
} from './alignment-guides';

function createRect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): AlignmentRect {
  return { id, x, y, width, height };
}

describe('calculateAlignment', () => {
  it.each([
    ['start', createRect('dragged', 104, 0, 80), -4, 100],
    ['center', createRect('dragged', 116, 0, 80), 4, 160],
    ['end', createRect('dragged', 136, 0, 80), 4, 220],
  ] satisfies ReadonlyArray<readonly [AlignmentAnchor, AlignmentRect, number, number]>)(
    'aligns the horizontal %s anchor for unequal widths',
    (anchor, draggedRect, correction, guideCoordinate) => {
      const result = calculateAlignment(
        draggedRect,
        [createRect('reference', 100, 200, 120)],
        6,
      );

      expect(result.position.x).toBe(draggedRect.x + correction);
      expect(result.verticalGuide).toMatchObject({
        coordinate: guideCoordinate,
        draggedAnchor: anchor,
        referenceAnchor: anchor,
        referenceNodeId: 'reference',
        start: 0,
        end: 280,
      });
    },
  );

  it.each([
    ['start', 'start', 100, 100],
    ['start', 'center', 160, 160],
    ['start', 'end', 220, 220],
    ['center', 'start', 65, 100],
    ['center', 'center', 125, 160],
    ['center', 'end', 185, 220],
    ['end', 'start', 30, 100],
    ['end', 'center', 90, 160],
    ['end', 'end', 150, 220],
  ] satisfies ReadonlyArray<
    readonly [AlignmentAnchor, AlignmentAnchor, number, number]
  >)(
    'aligns the horizontal %s anchor with a reference %s anchor',
    (draggedAnchor, referenceAnchor, draggedX, guideCoordinate) => {
      const result = calculateAlignment(
        createRect('dragged', draggedX, 0, 70),
        [createRect('reference', 100, 300, 120, 100)],
        0,
      );

      expect(result.verticalGuide).toMatchObject({
        coordinate: guideCoordinate,
        draggedAnchor,
        referenceAnchor,
        referenceNodeId: 'reference',
      });
    },
  );

  it.each([
    ['start', createRect('dragged', 0, 204, 100, 60), -4, 200],
    ['center', createRect('dragged', 0, 216, 100, 60), 4, 250],
    ['end', createRect('dragged', 0, 236, 100, 60), 4, 300],
  ] satisfies ReadonlyArray<readonly [AlignmentAnchor, AlignmentRect, number, number]>)(
    'aligns the vertical %s anchor for unequal heights',
    (anchor, draggedRect, correction, guideCoordinate) => {
      const result = calculateAlignment(
        draggedRect,
        [createRect('reference', 200, 200, 100, 100)],
        6,
      );

      expect(result.position.y).toBe(draggedRect.y + correction);
      expect(result.horizontalGuide).toMatchObject({
        coordinate: guideCoordinate,
        draggedAnchor: anchor,
        referenceAnchor: anchor,
        referenceNodeId: 'reference',
        start: 0,
        end: 300,
      });
    },
  );

  it.each([
    ['start', 'start', 100, 100],
    ['start', 'center', 160, 160],
    ['start', 'end', 220, 220],
    ['center', 'start', 65, 100],
    ['center', 'center', 125, 160],
    ['center', 'end', 185, 220],
    ['end', 'start', 30, 100],
    ['end', 'center', 90, 160],
    ['end', 'end', 150, 220],
  ] satisfies ReadonlyArray<
    readonly [AlignmentAnchor, AlignmentAnchor, number, number]
  >)(
    'aligns the vertical %s anchor with a reference %s anchor',
    (draggedAnchor, referenceAnchor, draggedY, guideCoordinate) => {
      const result = calculateAlignment(
        createRect('dragged', 0, draggedY, 80, 70),
        [createRect('reference', 300, 100, 100, 120)],
        0,
      );

      expect(result.horizontalGuide).toMatchObject({
        coordinate: guideCoordinate,
        draggedAnchor,
        referenceAnchor,
        referenceNodeId: 'reference',
      });
    },
  );

  it('returns independent corrections and guides for both axes', () => {
    const result = calculateAlignment(
      createRect('dragged', 104, 206),
      [createRect('reference', 100, 200)],
      6,
    );

    expect(result.position).toEqual({ x: 100, y: 200 });
    expect(result.verticalGuide).toMatchObject({
      coordinate: 150,
      draggedAnchor: 'center',
      referenceAnchor: 'center',
      referenceNodeId: 'reference',
    });
    expect(result.horizontalGuide).toMatchObject({
      coordinate: 240,
      draggedAnchor: 'center',
      referenceAnchor: 'center',
      referenceNodeId: 'reference',
    });
  });

  it('chooses the nearest reference independently of input order', () => {
    const draggedRect = createRect('dragged', 100, 100);
    const fartherReference = createRect('farther', 96, 300);
    const nearerReference = createRect('nearer', 102, 300);

    const forwardResult = calculateAlignment(
      draggedRect,
      [fartherReference, nearerReference],
      6,
    );
    const reverseResult = calculateAlignment(
      draggedRect,
      [nearerReference, fartherReference],
      6,
    );

    expect(forwardResult.position.x).toBe(102);
    expect(forwardResult.verticalGuide?.referenceNodeId).toBe('nearer');
    expect(reverseResult).toEqual(forwardResult);
  });

  it('prioritizes the spatially nearer reference before alignment correction distance', () => {
    const result = calculateAlignment(
      createRect('dragged', 100, 100),
      [createRect('far-but-exact', 101, 500), createRect('near', 105, 190)],
      6,
    );

    expect(result.position.x).toBe(105);
    expect(result.verticalGuide?.referenceNodeId).toBe('near');
  });

  it('uses stable anchor and node tie-breakers', () => {
    const result = calculateAlignment(
      createRect('dragged', 100, 100),
      [createRect('z-reference', 98, 300), createRect('a-reference', 102, 300)],
      2,
    );

    expect(result.position.x).toBe(102);
    expect(result.verticalGuide).toMatchObject({
      draggedAnchor: 'center',
      referenceAnchor: 'center',
      referenceNodeId: 'a-reference',
    });
  });

  it('includes exact threshold matches and rejects farther matches', () => {
    const exactThresholdResult = calculateAlignment(
      createRect('dragged', 106, 100),
      [createRect('reference', 100, 300)],
      6,
    );
    const outsideThresholdResult = calculateAlignment(
      createRect('dragged', 106.01, 100),
      [createRect('reference', 100, 300)],
      6,
    );

    expect(exactThresholdResult.position.x).toBe(100);
    expect(exactThresholdResult.verticalGuide).not.toBeNull();
    expect(outsideThresholdResult.position.x).toBe(106.01);
    expect(outsideThresholdResult.verticalGuide).toBeNull();
  });

  it('excludes the dragged node and returns no guides when nothing matches', () => {
    const draggedRect = createRect('dragged', 100, 100);
    const result = calculateAlignment(
      draggedRect,
      [draggedRect, createRect('distant', 500, 500)],
      6,
    );

    expect(result).toEqual({
      position: { x: 100, y: 100 },
      horizontalGuide: null,
      verticalGuide: null,
    });
  });
});

describe('isAlignmentRectVisible', () => {
  const viewport = { x: 100, y: 100, width: 400, height: 300 };

  it('includes fully and partially visible nodes', () => {
    expect(isAlignmentRectVisible(createRect('inside', 200, 200), viewport)).toBe(true);
    expect(isAlignmentRectVisible(createRect('partial', 450, 350), viewport)).toBe(true);
  });

  it('excludes nodes outside or exactly touching the viewport boundary', () => {
    expect(isAlignmentRectVisible(createRect('outside', 600, 500), viewport)).toBe(false);
    expect(isAlignmentRectVisible(createRect('touching', 500, 200), viewport)).toBe(false);
  });
});

describe('getResizeActiveAnchors', () => {
  const startBounds = { x: 100, y: 100, width: 240, height: 180 };

  it('detects moving edges from resize bounds', () => {
    expect(getResizeActiveAnchors(startBounds, startBounds)).toEqual({ x: null, y: null });
    expect(getResizeActiveAnchors(startBounds, { ...startBounds, width: 260 })).toEqual({
      x: 'end',
      y: null,
    });
    expect(getResizeActiveAnchors(startBounds, { ...startBounds, x: 80, width: 260 })).toEqual({
      x: 'start',
      y: null,
    });
    expect(getResizeActiveAnchors(startBounds, { ...startBounds, height: 200 })).toEqual({
      x: null,
      y: 'end',
    });
    expect(
      getResizeActiveAnchors(startBounds, { ...startBounds, x: 80, width: 260, height: 200 }),
    ).toEqual({
      x: 'start',
      y: 'end',
    });
  });
});

describe('calculateResizeAlignment', () => {
  const startBounds = { x: 100, y: 100, width: 240, height: 180 };

  it('snaps a right-edge resize to a reference right edge', () => {
    const result = calculateResizeAlignment(
      { x: 100, y: 100, width: 296, height: 180 },
      startBounds,
      [createRect('reference', 300, 260, 100, 80)],
      6,
      220,
      160,
    );

    expect(result.bounds).toEqual({ x: 100, y: 100, width: 300, height: 180 });
    expect(result.verticalGuide).toMatchObject({
      coordinate: 400,
      draggedAnchor: 'end',
      referenceAnchor: 'end',
      referenceNodeId: 'reference',
    });
  });

  it('snaps a left-edge resize to a reference left edge', () => {
    const result = calculateResizeAlignment(
      { x: 104, y: 100, width: 236, height: 180 },
      startBounds,
      [createRect('reference', 100, 260, 100, 80)],
      6,
      220,
      160,
    );

    expect(result.bounds).toEqual({ x: 100, y: 100, width: 240, height: 180 });
    expect(result.verticalGuide).toMatchObject({
      coordinate: 100,
      draggedAnchor: 'start',
      referenceAnchor: 'start',
    });
  });

  it('snaps a bottom-edge resize to a reference bottom edge', () => {
    const result = calculateResizeAlignment(
      { x: 100, y: 100, width: 240, height: 176 },
      startBounds,
      [createRect('reference', 500, 200, 100, 80)],
      6,
      220,
      160,
    );

    expect(result.bounds).toEqual({ x: 100, y: 100, width: 240, height: 180 });
    expect(result.horizontalGuide).toMatchObject({
      coordinate: 280,
      draggedAnchor: 'end',
      referenceAnchor: 'end',
    });
  });

  it('snaps both axes during corner resize', () => {
    const result = calculateResizeAlignment(
      { x: 100, y: 100, width: 296, height: 176 },
      startBounds,
      [createRect('reference', 300, 200, 100, 80)],
      6,
      220,
      160,
    );

    expect(result.bounds).toEqual({ x: 100, y: 100, width: 300, height: 180 });
    expect(result.verticalGuide).not.toBeNull();
    expect(result.horizontalGuide).not.toBeNull();
  });
});
