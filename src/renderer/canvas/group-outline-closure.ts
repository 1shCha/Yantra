import type { CompressedCellGrid } from './group-outline-grid';

export function closeOrthogonalInroads(
  grid: CompressedCellGrid,
): CompressedCellGrid {
  const { cellHeight, cellWidth } = grid;
  const filledCells = grid.filledCells.slice();
  if (cellWidth === 0 || cellHeight === 0) {
    return { ...grid, filledCells };
  }

  const cellIndex = (xIndex: number, yIndex: number) =>
    yIndex * cellWidth + xIndex;
  let didFill = true;

  while (didFill) {
    didFill = false;

    for (let xIndex = 0; xIndex < cellWidth; xIndex += 1) {
      let firstFilled = -1;
      let lastFilled = -1;
      for (let yIndex = 0; yIndex < cellHeight; yIndex += 1) {
        if (filledCells[cellIndex(xIndex, yIndex)] === 1) {
          if (firstFilled < 0) {
            firstFilled = yIndex;
          }
          lastFilled = yIndex;
        }
      }

      if (firstFilled < 0) {
        continue;
      }

      for (let yIndex = firstFilled; yIndex <= lastFilled; yIndex += 1) {
        const index = cellIndex(xIndex, yIndex);
        if (filledCells[index] === 0) {
          filledCells[index] = 1;
          didFill = true;
        }
      }
    }

    for (let yIndex = 0; yIndex < cellHeight; yIndex += 1) {
      let firstFilled = -1;
      let lastFilled = -1;
      for (let xIndex = 0; xIndex < cellWidth; xIndex += 1) {
        if (filledCells[cellIndex(xIndex, yIndex)] === 1) {
          if (firstFilled < 0) {
            firstFilled = xIndex;
          }
          lastFilled = xIndex;
        }
      }

      if (firstFilled < 0) {
        continue;
      }

      for (let xIndex = firstFilled; xIndex <= lastFilled; xIndex += 1) {
        const index = cellIndex(xIndex, yIndex);
        if (filledCells[index] === 0) {
          filledCells[index] = 1;
          didFill = true;
        }
      }
    }
  }

  return { ...grid, filledCells };
}
