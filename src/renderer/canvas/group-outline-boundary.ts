import type { CompressedCellGrid } from './group-outline-grid';

export interface HullPoint {
  x: number;
  y: number;
}

interface BoundaryEdge {
  end: HullPoint;
  start: HullPoint;
}

function pointKey(point: HullPoint): string {
  return `${point.x}:${point.y}`;
}

function buildBoundaryEdges(grid: CompressedCellGrid): BoundaryEdge[] {
  const {
    cellHeight,
    cellWidth,
    filledCells,
    xCoordinates,
    yCoordinates,
  } = grid;
  const isFilledCell = (xIndex: number, yIndex: number) =>
    xIndex >= 0 &&
    xIndex < cellWidth &&
    yIndex >= 0 &&
    yIndex < cellHeight &&
    filledCells[yIndex * cellWidth + xIndex] === 1;
  const edges: BoundaryEdge[] = [];

  for (let yIndex = 0; yIndex < cellHeight; yIndex += 1) {
    const top = yCoordinates[yIndex];
    const bottom = yCoordinates[yIndex + 1];
    if (top === undefined || bottom === undefined) {
      continue;
    }

    for (let xIndex = 0; xIndex < cellWidth; xIndex += 1) {
      if (!isFilledCell(xIndex, yIndex)) {
        continue;
      }

      const left = xCoordinates[xIndex];
      const right = xCoordinates[xIndex + 1];
      if (left === undefined || right === undefined) {
        continue;
      }

      if (!isFilledCell(xIndex, yIndex - 1)) {
        edges.push({
          start: { x: left, y: top },
          end: { x: right, y: top },
        });
      }
      if (!isFilledCell(xIndex + 1, yIndex)) {
        edges.push({
          start: { x: right, y: top },
          end: { x: right, y: bottom },
        });
      }
      if (!isFilledCell(xIndex, yIndex + 1)) {
        edges.push({
          start: { x: right, y: bottom },
          end: { x: left, y: bottom },
        });
      }
      if (!isFilledCell(xIndex - 1, yIndex)) {
        edges.push({
          start: { x: left, y: bottom },
          end: { x: left, y: top },
        });
      }
    }
  }

  return edges;
}

function isCollinear(
  previous: HullPoint,
  current: HullPoint,
  next: HullPoint,
): boolean {
  return (
    (previous.x === current.x && current.x === next.x) ||
    (previous.y === current.y && current.y === next.y)
  );
}

function simplifyLoop(loop: readonly HullPoint[]): HullPoint[] {
  let points = [...loop];
  let didSimplify = true;

  while (didSimplify && points.length >= 4) {
    didSimplify = false;
    const simplified = points.filter((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      const shouldRemove =
        previous !== undefined &&
        next !== undefined &&
        isCollinear(previous, point, next);
      didSimplify ||= shouldRemove;
      return !shouldRemove;
    });
    points = simplified;
  }

  return points;
}

function polygonArea(points: readonly HullPoint[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current !== undefined && next !== undefined) {
      doubledArea += current.x * next.y - next.x * current.y;
    }
  }

  return Math.abs(doubledArea / 2);
}

function traceBoundaryLoops(edges: readonly BoundaryEdge[]): HullPoint[][] {
  const edgeIndexesByStart = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge === undefined) {
      continue;
    }

    const key = pointKey(edge.start);
    const indexes = edgeIndexesByStart.get(key) ?? [];
    indexes.push(index);
    edgeIndexesByStart.set(key, indexes);
  }

  const unvisitedEdgeIndexes = new Set(edges.map((_, index) => index));
  const loops: HullPoint[][] = [];
  while (unvisitedEdgeIndexes.size > 0) {
    const firstEdgeIndex = unvisitedEdgeIndexes.values().next().value;
    if (firstEdgeIndex === undefined) {
      break;
    }

    const firstEdge = edges[firstEdgeIndex];
    if (firstEdge === undefined) {
      unvisitedEdgeIndexes.delete(firstEdgeIndex);
      continue;
    }

    const loop: HullPoint[] = [];
    let currentEdgeIndex: number | undefined = firstEdgeIndex;
    while (
      currentEdgeIndex !== undefined &&
      unvisitedEdgeIndexes.has(currentEdgeIndex)
    ) {
      const edge: BoundaryEdge | undefined = edges[currentEdgeIndex];
      if (edge === undefined) {
        break;
      }

      unvisitedEdgeIndexes.delete(currentEdgeIndex);
      loop.push(edge.start);
      const nextIndexes: number[] =
        edgeIndexesByStart.get(pointKey(edge.end)) ?? [];
      currentEdgeIndex = nextIndexes.find((index) =>
        unvisitedEdgeIndexes.has(index),
      );
    }

    if (loop.length >= 4) {
      loops.push(simplifyLoop(loop));
    }
  }

  return loops;
}

export function traceOuterBoundary(grid: CompressedCellGrid): HullPoint[] {
  const loops = traceBoundaryLoops(buildBoundaryEdges(grid));
  loops.sort((first, second) => polygonArea(second) - polygonArea(first));
  return loops[0] ?? [];
}
