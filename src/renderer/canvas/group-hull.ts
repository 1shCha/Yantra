import type { CanvasNodeRect } from './react-flow-node-geometry';
import { traceOuterBoundary, type HullPoint } from './group-outline-boundary';
import { closeOrthogonalInroads } from './group-outline-closure';
import {
  createCompressedCellGrid,
  createFilledAreaIndex,
  filledAreaWithinRect,
  type AxisAlignedRect,
  type FilledAreaIndex,
} from './group-outline-grid';

export type { HullPoint } from './group-outline-boundary';

interface MemberOutlineRect extends AxisAlignedRect {
  id: string;
}

type ConnectionRects =
  | readonly []
  | readonly [AxisAlignedRect]
  | readonly [AxisAlignedRect, AxisAlignedRect];

interface RectConnection {
  addedArea: number;
  distance: number;
  key: string;
  rects: ConnectionRects;
  targetIndex: number;
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

function compactConnectionRects(
  first: AxisAlignedRect | null,
  second: AxisAlignedRect | null,
): ConnectionRects {
  if (first === null) {
    return second === null ? [] : [second];
  }

  return second === null ? [first] : [first, second];
}

function createHorizontalThenVerticalConnection(
  source: MemberOutlineRect,
  target: MemberOutlineRect,
): ConnectionRects {
  const horizontal =
    target.left >= source.right
      ? createRect(source.right, source.top, target.right, source.bottom)
      : createRect(target.left, source.top, source.left, source.bottom);
  const vertical =
    target.top >= source.bottom
      ? createRect(target.left, source.bottom, target.right, target.top)
      : createRect(target.left, target.bottom, target.right, source.top);

  return compactConnectionRects(horizontal, vertical);
}

function createVerticalThenHorizontalConnection(
  source: MemberOutlineRect,
  target: MemberOutlineRect,
): ConnectionRects {
  const vertical =
    target.top >= source.bottom
      ? createRect(source.left, source.bottom, source.right, target.bottom)
      : createRect(source.left, target.top, source.right, source.top);
  const horizontal =
    target.left >= source.right
      ? createRect(source.right, target.top, target.left, target.bottom)
      : createRect(target.right, target.top, source.left, target.bottom);

  return compactConnectionRects(vertical, horizontal);
}

function createDirectConnection(
  first: MemberOutlineRect,
  second: MemberOutlineRect,
): ConnectionRects | null {
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
  closedMembers: FilledAreaIndex,
): RectConnection {
  const distance =
    intervalGap(first.left, first.right, second.left, second.right) +
    intervalGap(first.top, first.bottom, second.top, second.bottom);
  const directConnection = createDirectConnection(first, second);

  if (directConnection !== null) {
    return {
      addedArea: calculateConnectionAddedArea(directConnection, closedMembers),
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
    addedArea: calculateConnectionAddedArea(candidate.rects, closedMembers),
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

  // A shared member-only baseline keeps edge weights stable while Prim's
  // frontier advances. Connector coordinates come from member edges, so each
  // route can query its visible added area without rebuilding the closed grid.
  const closedMembers = createClosedMemberAreaIndex(memberRects);
  const connectedIndexes = new Set<number>([0]);
  const connectorRects: AxisAlignedRect[] = [];
  const bestConnectionByTarget: Array<RectConnection | null> = memberRects.map(
    () => null,
  );
  const updateBestConnectionsFromSource = (sourceIndex: number) => {
    const source = memberRects[sourceIndex];
    if (source === undefined) {
      return;
    }

    for (let targetIndex = 0; targetIndex < memberRects.length; targetIndex += 1) {
      if (connectedIndexes.has(targetIndex)) {
        continue;
      }

      const target = memberRects[targetIndex];
      if (target === undefined) {
        continue;
      }

      const candidate = createBestConnection(
        source,
        target,
        targetIndex,
        closedMembers,
      );
      if (isPreferredConnection(candidate, bestConnectionByTarget[targetIndex] ?? null)) {
        bestConnectionByTarget[targetIndex] = candidate;
      }
    }
  };

  updateBestConnectionsFromSource(0);

  while (connectedIndexes.size < memberRects.length) {
    let bestConnection: RectConnection | null = null;

    for (let targetIndex = 0; targetIndex < memberRects.length; targetIndex += 1) {
      if (connectedIndexes.has(targetIndex)) {
        continue;
      }

      const connection = bestConnectionByTarget[targetIndex];
      if (
        connection !== undefined &&
        connection !== null &&
        isPreferredConnection(connection, bestConnection)
      ) {
        bestConnection = connection;
      }
    }

    if (bestConnection === null) {
      break;
    }

    connectedIndexes.add(bestConnection.targetIndex);
    connectorRects.push(...bestConnection.rects);
    updateBestConnectionsFromSource(bestConnection.targetIndex);
  }

  return connectorRects;
}

function createClosedMemberAreaIndex(
  rects: readonly AxisAlignedRect[],
): FilledAreaIndex {
  return createFilledAreaIndex(
    closeOrthogonalInroads(createCompressedCellGrid(rects)),
  );
}

function intersectRects(
  first: AxisAlignedRect,
  second: AxisAlignedRect,
): AxisAlignedRect | null {
  return createRect(
    Math.max(first.left, second.left),
    Math.max(first.top, second.top),
    Math.min(first.right, second.right),
    Math.min(first.bottom, second.bottom),
  );
}

function calculateConnectionAddedArea(
  connectorRects: ConnectionRects,
  closedMembers: FilledAreaIndex,
): number {
  const first = connectorRects[0];
  if (first === undefined) {
    return 0;
  }

  const second = connectorRects[1];
  const firstAddedArea =
    rectArea(first) - filledAreaWithinRect(first, closedMembers);
  if (second === undefined) {
    return firstAddedArea;
  }

  const overlap = intersectRects(first, second);
  const overlapAddedArea =
    overlap === null
      ? 0
      : rectArea(overlap) - filledAreaWithinRect(overlap, closedMembers);

  return (
    firstAddedArea +
    rectArea(second) -
    filledAreaWithinRect(second, closedMembers) -
    overlapAddedArea
  );
}

export interface GroupOutlinePolicy {
  edgeMergeTolerance: number;
  padding: number;
}

export const DEFAULT_GROUP_OUTLINE_POLICY = {
  edgeMergeTolerance: 8,
  padding: 16,
} as const satisfies GroupOutlinePolicy;

function remapCoordinatesOutward(
  coordinates: readonly number[],
  tolerance: number,
  extreme: 'min' | 'max',
): number[] {
  const orderedIndexes = coordinates
    .map((_, index) => index)
    .sort((firstIndex, secondIndex) => {
      const first = coordinates[firstIndex];
      const second = coordinates[secondIndex];
      if (first === undefined || second === undefined) {
        return firstIndex - secondIndex;
      }

      return first - second || firstIndex - secondIndex;
    });
  const remapped = [...coordinates];
  let clusterStart = 0;

  while (clusterStart < orderedIndexes.length) {
    const startIndex = orderedIndexes[clusterStart];
    const startValue = startIndex === undefined ? undefined : coordinates[startIndex];
    if (startIndex === undefined || startValue === undefined) {
      break;
    }

    let clusterEnd = clusterStart;
    let canonical = startValue;
    while (clusterEnd + 1 < orderedIndexes.length) {
      const nextIndex = orderedIndexes[clusterEnd + 1];
      const nextValue = nextIndex === undefined ? undefined : coordinates[nextIndex];
      if (nextValue === undefined || nextValue - startValue > tolerance) {
        break;
      }

      canonical =
        extreme === 'max' ? Math.max(canonical, nextValue) : Math.min(canonical, nextValue);
      clusterEnd += 1;
    }

    for (let index = clusterStart; index <= clusterEnd; index += 1) {
      const coordinateIndex = orderedIndexes[index];
      if (coordinateIndex !== undefined) {
        remapped[coordinateIndex] = canonical;
      }
    }

    clusterStart = clusterEnd + 1;
  }

  return remapped;
}

function mergeNearEqualOuterEdges(
  memberRects: readonly MemberOutlineRect[],
  tolerance: number,
): MemberOutlineRect[] {
  const effectiveTolerance = Math.max(0, tolerance);
  const tops = remapCoordinatesOutward(
    memberRects.map((rect) => rect.top),
    effectiveTolerance,
    'min',
  );
  const bottoms = remapCoordinatesOutward(
    memberRects.map((rect) => rect.bottom),
    effectiveTolerance,
    'max',
  );
  const lefts = remapCoordinatesOutward(
    memberRects.map((rect) => rect.left),
    effectiveTolerance,
    'min',
  );
  const rights = remapCoordinatesOutward(
    memberRects.map((rect) => rect.right),
    effectiveTolerance,
    'max',
  );

  return memberRects.map((rect, index) => ({
    id: rect.id,
    bottom: bottoms[index] ?? rect.bottom,
    left: lefts[index] ?? rect.left,
    right: rights[index] ?? rect.right,
    top: tops[index] ?? rect.top,
  }));
}

export function calculateCompositeGroupOutline(
  memberRects: readonly CanvasNodeRect[],
  policy: GroupOutlinePolicy,
): HullPoint[] {
  const effectivePadding = Math.max(0, policy.padding);
  const paddedMemberRects = mergeNearEqualOuterEdges(
    memberRects
      .map((rect) => toPaddedRect(rect, effectivePadding))
      .sort((first, second) => first.id.localeCompare(second.id)),
    policy.edgeMergeTolerance,
  );

  if (paddedMemberRects.length === 0) {
    return [];
  }

  const connectorRects = connectMemberRects(paddedMemberRects);
  const closedGrid = closeOrthogonalInroads(
    createCompressedCellGrid([...paddedMemberRects, ...connectorRects]),
  );
  return traceOuterBoundary(closedGrid);
}
