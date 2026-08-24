import type { CanvasNodeRect } from './react-flow-node-geometry';

export interface HullPoint {
  x: number;
  y: number;
}

interface AxisAlignedRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface MemberOutlineRect extends AxisAlignedRect {
  id: string;
}

interface RectConnection {
  addedArea: number;
  distance: number;
  key: string;
  rects: AxisAlignedRect[];
  targetIndex: number;
}

interface BoundaryEdge {
  end: HullPoint;
  start: HullPoint;
}

function crossProduct(origin: HullPoint, first: HullPoint, second: HullPoint): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

function appendHullPoint(hull: HullPoint[], point: HullPoint) {
  while (hull.length >= 2) {
    const previous = hull[hull.length - 1];
    const beforePrevious = hull[hull.length - 2];

    if (
      previous === undefined ||
      beforePrevious === undefined ||
      crossProduct(beforePrevious, previous, point) > 0
    ) {
      break;
    }

    hull.pop();
  }

  hull.push(point);
}

function paddedCorners(rect: CanvasNodeRect, padding: number): HullPoint[] {
  const left = rect.x - padding;
  const top = rect.y - padding;
  const right = rect.x + rect.width + padding;
  const bottom = rect.y + rect.height + padding;

  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export function calculateGroupHull(
  memberRects: readonly CanvasNodeRect[],
  padding: number,
): HullPoint[] {
  const effectivePadding = Math.max(0, padding);
  const uniquePoints = new Map<string, HullPoint>();

  for (const rect of memberRects) {
    for (const point of paddedCorners(rect, effectivePadding)) {
      uniquePoints.set(`${point.x}:${point.y}`, point);
    }
  }

  const points = Array.from(uniquePoints.values()).sort(
    (first, second) => first.x - second.x || first.y - second.y,
  );

  if (points.length <= 1) {
    return points;
  }

  const lowerHull: HullPoint[] = [];
  for (const point of points) {
    appendHullPoint(lowerHull, point);
  }

  const upperHull: HullPoint[] = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point !== undefined) {
      appendHullPoint(upperHull, point);
    }
  }

  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)];
}

function toPaddedRect(rect: CanvasNodeRect, padding: number): MemberOutlineRect {
  return {
    id: rect.id,
    bottom: rect.y + rect.height + padding,
    left: rect.x - padding,
    right: rect.x + rect.width + padding,
    top: rect.y - padding,
  };
}

function intervalGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  return Math.max(0, Math.max(firstStart, secondStart) - Math.min(firstEnd, secondEnd));
}

function rectArea(rect: AxisAlignedRect): number {
  return (rect.right - rect.left) * (rect.bottom - rect.top);
}

function createRect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): AxisAlignedRect | null {
  if (right <= left || bottom <= top) {
    return null;
  }

  return { bottom, left, right, top };
}

function compactRects(rects: Array<AxisAlignedRect | null>): AxisAlignedRect[] {
  return rects.filter((rect): rect is AxisAlignedRect => rect !== null);
}

function connectionArea(rects: readonly AxisAlignedRect[]): number {
  return rects.reduce((total, rect) => total + rectArea(rect), 0);
}

function createHorizontalThenVerticalConnection(
  source: MemberOutlineRect,
  target: MemberOutlineRect,
): AxisAlignedRect[] {
  const horizontal =
    target.left >= source.right
      ? createRect(source.right, source.top, target.right, source.bottom)
      : createRect(target.left, source.top, source.left, source.bottom);
  const vertical =
    target.top >= source.bottom
      ? createRect(target.left, source.bottom, target.right, target.top)
      : createRect(target.left, target.bottom, target.right, source.top);

  return compactRects([horizontal, vertical]);
}

function createVerticalThenHorizontalConnection(
  source: MemberOutlineRect,
  target: MemberOutlineRect,
): AxisAlignedRect[] {
  const vertical =
    target.top >= source.bottom
      ? createRect(source.left, source.bottom, source.right, target.bottom)
      : createRect(source.left, target.top, source.right, source.top);
  const horizontal =
    target.left >= source.right
      ? createRect(source.right, target.top, target.left, target.bottom)
      : createRect(target.right, target.top, source.left, target.bottom);

  return compactRects([vertical, horizontal]);
}

function createDirectConnection(
  first: MemberOutlineRect,
  second: MemberOutlineRect,
): AxisAlignedRect[] | null {
  const overlapLeft = Math.max(first.left, second.left);
  const overlapRight = Math.min(first.right, second.right);
  if (overlapRight > overlapLeft) {
    const vertical =
      first.bottom <= second.top
        ? createRect(overlapLeft, first.bottom, overlapRight, second.top)
        : createRect(overlapLeft, second.bottom, overlapRight, first.top);

    if (vertical !== null) {
      return [vertical];
    }
  }

  const overlapTop = Math.max(first.top, second.top);
  const overlapBottom = Math.min(first.bottom, second.bottom);
  if (overlapBottom > overlapTop) {
    const horizontal =
      first.right <= second.left
        ? createRect(first.right, overlapTop, second.left, overlapBottom)
        : createRect(second.right, overlapTop, first.left, overlapBottom);

    if (horizontal !== null) {
      return [horizontal];
    }
  }

  const overlapsHorizontally = first.left < second.right && second.left < first.right;
  const overlapsVertically = first.top < second.bottom && second.top < first.bottom;
  const touchesAlongVerticalEdge =
    overlapRight === overlapLeft && overlapBottom > overlapTop;
  const touchesAlongHorizontalEdge =
    overlapBottom === overlapTop && overlapRight > overlapLeft;
  return (overlapsHorizontally && overlapsVertically) ||
    touchesAlongVerticalEdge ||
    touchesAlongHorizontalEdge
    ? []
    : null;
}

function createBestConnection(
  first: MemberOutlineRect,
  second: MemberOutlineRect,
  targetIndex: number,
): RectConnection {
  const distance =
    intervalGap(first.left, first.right, second.left, second.right) +
    intervalGap(first.top, first.bottom, second.top, second.bottom);
  const directConnection = createDirectConnection(first, second);

  if (directConnection !== null) {
    return {
      addedArea: connectionArea(directConnection),
      distance,
      key: `${first.id}:${second.id}:direct`,
      rects: directConnection,
      targetIndex,
    };
  }

  const compareSpatially =
    first.top - second.top ||
    first.left - second.left ||
    first.bottom - second.bottom ||
    first.right - second.right ||
    first.id.localeCompare(second.id);
  const primary = compareSpatially <= 0 ? first : second;
  const secondary = compareSpatially <= 0 ? second : first;
  const routeCandidates = [
    {
      key: '0-horizontal-vertical',
      rects: createHorizontalThenVerticalConnection(primary, secondary),
    },
    {
      key: '1-vertical-horizontal',
      rects: createVerticalThenHorizontalConnection(primary, secondary),
    },
    {
      key: '2-horizontal-vertical-reverse',
      rects: createHorizontalThenVerticalConnection(secondary, primary),
    },
    {
      key: '3-vertical-horizontal-reverse',
      rects: createVerticalThenHorizontalConnection(secondary, primary),
    },
  ].map((candidate) => ({
    ...candidate,
    addedArea: connectionArea(candidate.rects),
  }));

  routeCandidates.sort(
    (firstCandidate, secondCandidate) =>
      firstCandidate.addedArea - secondCandidate.addedArea ||
      firstCandidate.key.localeCompare(secondCandidate.key),
  );
  const route = routeCandidates[0];

  return {
    addedArea: route?.addedArea ?? 0,
    distance,
    key: `${first.id}:${second.id}:${route?.key ?? 'none'}`,
    rects: route?.rects ?? [],
    targetIndex,
  };
}

function isPreferredConnection(
  candidate: RectConnection,
  current: RectConnection | null,
): boolean {
  return (
    current === null ||
    candidate.distance < current.distance ||
    (candidate.distance === current.distance &&
      (candidate.addedArea < current.addedArea ||
        (candidate.addedArea === current.addedArea &&
          candidate.key.localeCompare(current.key) < 0)))
  );
}

function connectMemberRects(memberRects: readonly MemberOutlineRect[]): AxisAlignedRect[] {
  if (memberRects.length < 2) {
    return [];
  }

  const connectedIndexes = new Set<number>([0]);
  const connectorRects: AxisAlignedRect[] = [];

  while (connectedIndexes.size < memberRects.length) {
    let bestConnection: RectConnection | null = null;

    for (const sourceIndex of connectedIndexes) {
      const source = memberRects[sourceIndex];
      if (source === undefined) {
        continue;
      }

      for (let targetIndex = 0; targetIndex < memberRects.length; targetIndex += 1) {
        if (connectedIndexes.has(targetIndex)) {
          continue;
        }

        const target = memberRects[targetIndex];
        if (target === undefined) {
          continue;
        }

        const connection = createBestConnection(source, target, targetIndex);
        if (isPreferredConnection(connection, bestConnection)) {
          bestConnection = connection;
        }
      }
    }

    if (bestConnection === null) {
      break;
    }

    connectedIndexes.add(bestConnection.targetIndex);
    connectorRects.push(...bestConnection.rects);
  }

  return connectorRects;
}

function createHorizontalEnvelopeRects(
  memberRects: readonly MemberOutlineRect[],
): AxisAlignedRect[] {
  const yCoordinates = Array.from(
    new Set(memberRects.flatMap((rect) => [rect.top, rect.bottom])),
  ).sort((first, second) => first - second);
  const rowBands: Array<AxisAlignedRect | null> = [];

  for (let index = 0; index < yCoordinates.length - 1; index += 1) {
    const top = yCoordinates[index];
    const bottom = yCoordinates[index + 1];
    if (top === undefined || bottom === undefined) {
      rowBands.push(null);
      continue;
    }

    const centerY = (top + bottom) / 2;
    const rowMembers = memberRects.filter(
      (rect) => centerY > rect.top && centerY < rect.bottom,
    );
    if (rowMembers.length === 0) {
      rowBands.push(null);
      continue;
    }

    rowBands.push({
      bottom,
      left: Math.min(...rowMembers.map((rect) => rect.left)),
      right: Math.max(...rowMembers.map((rect) => rect.right)),
      top,
    });
  }

  const envelopeRects = rowBands.filter(
    (rect): rect is AxisAlignedRect => rect !== null,
  );

  for (let index = 0; index < rowBands.length; index += 1) {
    if (rowBands[index] !== null) {
      continue;
    }

    let previousIndex = index - 1;
    while (previousIndex >= 0 && rowBands[previousIndex] === null) {
      previousIndex -= 1;
    }

    let nextIndex = index + 1;
    while (nextIndex < rowBands.length && rowBands[nextIndex] === null) {
      nextIndex += 1;
    }

    const previousBand = rowBands[previousIndex];
    const nextBand = rowBands[nextIndex];
    const top = yCoordinates[index];
    const bottom = yCoordinates[index + 1];
    if (
      previousBand === undefined ||
      previousBand === null ||
      nextBand === undefined ||
      nextBand === null ||
      top === undefined ||
      bottom === undefined
    ) {
      continue;
    }

    const overlapLeft = Math.max(previousBand.left, nextBand.left);
    const overlapRight = Math.min(previousBand.right, nextBand.right);
    const bridge = createRect(overlapLeft, top, overlapRight, bottom);
    if (bridge !== null) {
      envelopeRects.push(bridge);
    }
  }

  return envelopeRects;
}

function pointKey(point: HullPoint): string {
  return `${point.x}:${point.y}`;
}

function cellKey(xIndex: number, yIndex: number): string {
  return `${xIndex}:${yIndex}`;
}

function containsPoint(rect: AxisAlignedRect, x: number, y: number): boolean {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}

function buildBoundaryEdges(rects: readonly AxisAlignedRect[]): BoundaryEdge[] {
  const xCoordinates = Array.from(
    new Set(rects.flatMap((rect) => [rect.left, rect.right])),
  ).sort((first, second) => first - second);
  const yCoordinates = Array.from(
    new Set(rects.flatMap((rect) => [rect.top, rect.bottom])),
  ).sort((first, second) => first - second);
  const filledCells = new Set<string>();

  for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex += 1) {
    const top = yCoordinates[yIndex];
    const bottom = yCoordinates[yIndex + 1];
    if (top === undefined || bottom === undefined) {
      continue;
    }

    for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex += 1) {
      const left = xCoordinates[xIndex];
      const right = xCoordinates[xIndex + 1];
      if (left === undefined || right === undefined) {
        continue;
      }

      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      if (rects.some((rect) => containsPoint(rect, centerX, centerY))) {
        filledCells.add(cellKey(xIndex, yIndex));
      }
    }
  }

  const edges: BoundaryEdge[] = [];
  for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex += 1) {
    const top = yCoordinates[yIndex];
    const bottom = yCoordinates[yIndex + 1];
    if (top === undefined || bottom === undefined) {
      continue;
    }

    for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex += 1) {
      if (!filledCells.has(cellKey(xIndex, yIndex))) {
        continue;
      }

      const left = xCoordinates[xIndex];
      const right = xCoordinates[xIndex + 1];
      if (left === undefined || right === undefined) {
        continue;
      }

      if (!filledCells.has(cellKey(xIndex, yIndex - 1))) {
        edges.push({
          start: { x: left, y: top },
          end: { x: right, y: top },
        });
      }
      if (!filledCells.has(cellKey(xIndex + 1, yIndex))) {
        edges.push({
          start: { x: right, y: top },
          end: { x: right, y: bottom },
        });
      }
      if (!filledCells.has(cellKey(xIndex, yIndex + 1))) {
        edges.push({
          start: { x: right, y: bottom },
          end: { x: left, y: bottom },
        });
      }
      if (!filledCells.has(cellKey(xIndex - 1, yIndex))) {
        edges.push({
          start: { x: left, y: bottom },
          end: { x: left, y: top },
        });
      }
    }
  }

  return edges;
}

function isCollinear(previous: HullPoint, current: HullPoint, next: HullPoint): boolean {
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

    while (currentEdgeIndex !== undefined && unvisitedEdgeIndexes.has(currentEdgeIndex)) {
      const edge: BoundaryEdge | undefined = edges[currentEdgeIndex];
      if (edge === undefined) {
        break;
      }

      unvisitedEdgeIndexes.delete(currentEdgeIndex);
      loop.push(edge.start);
      const nextIndexes: number[] = edgeIndexesByStart.get(pointKey(edge.end)) ?? [];
      currentEdgeIndex = nextIndexes.find((index) => unvisitedEdgeIndexes.has(index));
    }

    if (loop.length >= 4) {
      loops.push(simplifyLoop(loop));
    }
  }

  return loops;
}

export function calculateCompositeGroupOutline(
  memberRects: readonly CanvasNodeRect[],
  padding: number,
): HullPoint[] {
  const effectivePadding = Math.max(0, padding);
  const paddedMemberRects = memberRects
    .map((rect) => toPaddedRect(rect, effectivePadding))
    .sort((first, second) => first.id.localeCompare(second.id));

  if (paddedMemberRects.length === 0) {
    return [];
  }

  const connectorRects = connectMemberRects(paddedMemberRects);
  const envelopeRects = createHorizontalEnvelopeRects(paddedMemberRects);
  const boundaryLoops = traceBoundaryLoops(
    buildBoundaryEdges([
      ...paddedMemberRects,
      ...envelopeRects,
      ...connectorRects,
    ]),
  );
  boundaryLoops.sort((first, second) => polygonArea(second) - polygonArea(first));

  return boundaryLoops[0] ?? [];
}
