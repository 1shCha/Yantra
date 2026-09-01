import { describe, expect, it } from 'vitest';

import { closeOrthogonalInroads } from './group-outline-closure';
import type { CompressedCellGrid } from './group-outline-grid';

function gridFromRows(rows: readonly string[]): CompressedCellGrid {
  const cellHeight = rows.length;
  const cellWidth = rows[0]?.length ?? 0;
  return {
    cellHeight,
    cellWidth,
    filledCells: Uint8Array.from(
      rows.flatMap((row) =>
        Array.from(row, (cell) => (cell === '1' ? 1 : 0)),
      ),
    ),
    xCoordinates: Array.from({ length: cellWidth + 1 }, (_, index) => index),
    yCoordinates: Array.from({ length: cellHeight + 1 }, (_, index) => index),
  };
}

describe('closeOrthogonalInroads', () => {
  it('fills a three-sided inroad', () => {
    const grid = gridFromRows([
      '111',
      '100',
      '111',
    ]);

    const closed = closeOrthogonalInroads(grid);

    expect(Array.from(closed.filledCells)).toEqual([
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ]);
  });

  it('keeps an outer L-shaped step', () => {
    const grid = gridFromRows([
      '110',
      '100',
      '100',
    ]);

    const closed = closeOrthogonalInroads(grid);

    expect(Array.from(closed.filledCells)).toEqual(Array.from(grid.filledCells));
  });

  it('does not mutate the source grid', () => {
    const grid = gridFromRows([
      '11',
      '10',
      '11',
    ]);
    const originalCells = Array.from(grid.filledCells);

    closeOrthogonalInroads(grid);

    expect(Array.from(grid.filledCells)).toEqual(originalCells);
  });
});
