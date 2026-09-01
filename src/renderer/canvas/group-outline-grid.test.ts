import { describe, expect, it } from 'vitest';

import {
  createCompressedCellGrid,
  createFilledAreaIndex,
  filledAreaWithinRect,
  type AxisAlignedRect,
} from './group-outline-grid';

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): AxisAlignedRect {
  return { bottom, left, right, top };
}

describe('createCompressedCellGrid', () => {
  it('preserves an empty band between disjoint rectangles', () => {
    const grid = createCompressedCellGrid([
      rect(0, 0, 10, 10),
      rect(20, 0, 30, 10),
    ]);

    expect(grid.xCoordinates).toEqual([0, 10, 20, 30]);
    expect(grid.yCoordinates).toEqual([0, 10]);
    expect(Array.from(grid.filledCells)).toEqual([1, 0, 1]);
  });

  it('builds exact coverage cells for partially overlapping rectangles', () => {
    const grid = createCompressedCellGrid([
      rect(0, 0, 20, 10),
      rect(10, 0, 30, 20),
    ]);

    expect(grid.xCoordinates).toEqual([0, 10, 20, 30]);
    expect(grid.yCoordinates).toEqual([0, 10, 20]);
    expect(Array.from(grid.filledCells)).toEqual([
      1, 1, 1,
      0, 1, 1,
    ]);
  });
});

describe('filledAreaWithinRect', () => {
  it('queries physical area on a non-uniform compressed grid', () => {
    const queryRect = rect(0, 0, 30, 20);
    const grid = createCompressedCellGrid([
      rect(0, 0, 10, 20),
      rect(10, 0, 30, 5),
    ]);
    const areaIndex = createFilledAreaIndex(grid);

    expect(filledAreaWithinRect(queryRect, areaIndex)).toBe(300);
  });
});
