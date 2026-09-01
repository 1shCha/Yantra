export interface AxisAlignedRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface CompressedCellGrid {
  cellHeight: number;
  cellWidth: number;
  filledCells: Uint8Array;
  xCoordinates: number[];
  yCoordinates: number[];
}

export interface FilledAreaIndex {
  areaPrefix: Float64Array;
  prefixWidth: number;
  xIndexByCoordinate: ReadonlyMap<number, number>;
  yIndexByCoordinate: ReadonlyMap<number, number>;
}

export function createCompressedCellGrid(
  rects: readonly AxisAlignedRect[],
): CompressedCellGrid {
  const xCoordinates = Array.from(
    new Set(rects.flatMap((rect) => [rect.left, rect.right])),
  ).sort((first, second) => first - second);
  const yCoordinates = Array.from(
    new Set(rects.flatMap((rect) => [rect.top, rect.bottom])),
  ).sort((first, second) => first - second);
  const xIndexByCoordinate = new Map(
    xCoordinates.map((coordinate, index) => [coordinate, index]),
  );
  const yIndexByCoordinate = new Map(
    yCoordinates.map((coordinate, index) => [coordinate, index]),
  );
  const coordinateWidth = xCoordinates.length;
  const coordinateHeight = yCoordinates.length;
  const coverage = new Int32Array(coordinateWidth * coordinateHeight);
  const coverageIndex = (xIndex: number, yIndex: number) =>
    yIndex * coordinateWidth + xIndex;

  const updateCoverage = (xIndex: number, yIndex: number, delta: number) => {
    const index = coverageIndex(xIndex, yIndex);
    coverage[index] = (coverage[index] ?? 0) + delta;
  };

  for (const rect of rects) {
    const leftIndex = xIndexByCoordinate.get(rect.left);
    const rightIndex = xIndexByCoordinate.get(rect.right);
    const topIndex = yIndexByCoordinate.get(rect.top);
    const bottomIndex = yIndexByCoordinate.get(rect.bottom);
    if (
      leftIndex === undefined ||
      rightIndex === undefined ||
      topIndex === undefined ||
      bottomIndex === undefined
    ) {
      continue;
    }

    updateCoverage(leftIndex, topIndex, 1);
    updateCoverage(rightIndex, topIndex, -1);
    updateCoverage(leftIndex, bottomIndex, -1);
    updateCoverage(rightIndex, bottomIndex, 1);
  }

  for (let yIndex = 0; yIndex < coordinateHeight; yIndex += 1) {
    for (let xIndex = 0; xIndex < coordinateWidth; xIndex += 1) {
      const index = coverageIndex(xIndex, yIndex);
      const left =
        xIndex > 0 ? (coverage[coverageIndex(xIndex - 1, yIndex)] ?? 0) : 0;
      const above =
        yIndex > 0 ? (coverage[coverageIndex(xIndex, yIndex - 1)] ?? 0) : 0;
      const aboveLeft =
        xIndex > 0 && yIndex > 0
          ? (coverage[coverageIndex(xIndex - 1, yIndex - 1)] ?? 0)
          : 0;
      coverage[index] = (coverage[index] ?? 0) + left + above - aboveLeft;
    }
  }

  const cellWidth = Math.max(0, coordinateWidth - 1);
  const cellHeight = Math.max(0, coordinateHeight - 1);
  const filledCells = new Uint8Array(cellWidth * cellHeight);
  for (let yIndex = 0; yIndex < cellHeight; yIndex += 1) {
    for (let xIndex = 0; xIndex < cellWidth; xIndex += 1) {
      if ((coverage[coverageIndex(xIndex, yIndex)] ?? 0) > 0) {
        filledCells[yIndex * cellWidth + xIndex] = 1;
      }
    }
  }

  return {
    cellHeight,
    cellWidth,
    filledCells,
    xCoordinates,
    yCoordinates,
  };
}

export function createFilledAreaIndex(grid: CompressedCellGrid): FilledAreaIndex {
  const {
    cellHeight,
    cellWidth,
    filledCells,
    xCoordinates,
    yCoordinates,
  } = grid;
  const prefixWidth = cellWidth + 1;
  const areaPrefix = new Float64Array(prefixWidth * (cellHeight + 1));

  for (let yIndex = 0; yIndex < cellHeight; yIndex += 1) {
    const top = yCoordinates[yIndex];
    const bottom = yCoordinates[yIndex + 1];
    if (top === undefined || bottom === undefined) {
      continue;
    }

    for (let xIndex = 0; xIndex < cellWidth; xIndex += 1) {
      const left = xCoordinates[xIndex];
      const right = xCoordinates[xIndex + 1];
      if (left === undefined || right === undefined) {
        continue;
      }

      const prefixIndex = (yIndex + 1) * prefixWidth + xIndex + 1;
      const cellArea =
        filledCells[yIndex * cellWidth + xIndex] === 1
          ? (right - left) * (bottom - top)
          : 0;
      areaPrefix[prefixIndex] =
        cellArea +
        (areaPrefix[prefixIndex - 1] ?? 0) +
        (areaPrefix[prefixIndex - prefixWidth] ?? 0) -
        (areaPrefix[prefixIndex - prefixWidth - 1] ?? 0);
    }
  }

  return {
    areaPrefix,
    prefixWidth,
    xIndexByCoordinate: new Map(
      xCoordinates.map((coordinate, index) => [coordinate, index]),
    ),
    yIndexByCoordinate: new Map(
      yCoordinates.map((coordinate, index) => [coordinate, index]),
    ),
  };
}

export function filledAreaWithinRect(
  rect: AxisAlignedRect,
  areaIndex: FilledAreaIndex,
): number {
  const leftIndex = areaIndex.xIndexByCoordinate.get(rect.left);
  const rightIndex = areaIndex.xIndexByCoordinate.get(rect.right);
  const topIndex = areaIndex.yIndexByCoordinate.get(rect.top);
  const bottomIndex = areaIndex.yIndexByCoordinate.get(rect.bottom);
  if (
    leftIndex === undefined ||
    rightIndex === undefined ||
    topIndex === undefined ||
    bottomIndex === undefined
  ) {
    return 0;
  }

  const topLeft = topIndex * areaIndex.prefixWidth + leftIndex;
  const topRight = topIndex * areaIndex.prefixWidth + rightIndex;
  const bottomLeft = bottomIndex * areaIndex.prefixWidth + leftIndex;
  const bottomRight = bottomIndex * areaIndex.prefixWidth + rightIndex;

  return (
    (areaIndex.areaPrefix[bottomRight] ?? 0) -
    (areaIndex.areaPrefix[topRight] ?? 0) -
    (areaIndex.areaPrefix[bottomLeft] ?? 0) +
    (areaIndex.areaPrefix[topLeft] ?? 0)
  );
}
