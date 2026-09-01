import { describe, expect, it } from 'vitest';

import { traceOuterBoundary } from './group-outline-boundary';
import type { CompressedCellGrid } from './group-outline-grid';

function gridFromRows(
  rows: readonly string[],
  xCoordinates: number[],
  yCoordinates: number[],
): CompressedCellGrid {
  return {
    cellHeight: rows.length,
    cellWidth: rows[0]?.length ?? 0,
    filledCells: Uint8Array.from(
      rows.flatMap((row) =>
        Array.from(row, (cell) => (cell === '1' ? 1 : 0)),
      ),
    ),
    xCoordinates,
    yCoordinates,
  };
}

describe('traceOuterBoundary', () => {
  it('traces a rectangle using physical grid coordinates', () => {
    const grid = gridFromRows(
      ['11', '11'],
      [10, 30, 80],
      [20, 50, 90],
    );

    expect(traceOuterBoundary(grid)).toEqual([
      { x: 10, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 90 },
      { x: 10, y: 90 },
    ]);
  });

  it('preserves an outer L-shaped step and removes collinear points', () => {
    const grid = gridFromRows(
      ['11', '10', '10'],
      [0, 40, 100],
      [0, 30, 70, 120],
    );

    expect(traceOuterBoundary(grid)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 40, y: 30 },
      { x: 40, y: 120 },
      { x: 0, y: 120 },
    ]);
  });
});
