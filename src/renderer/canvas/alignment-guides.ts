import type { CanvasNodeRect } from './react-flow-node-geometry';

export interface AlignmentPosition {
  x: number;
  y: number;
}

export type AlignmentRect = CanvasNodeRect;

export interface AlignmentViewport extends AlignmentPosition {
  width: number;
  height: number;
}

export type AlignmentAnchor = 'start' | 'center' | 'end';

export interface AlignmentGuide {
  coordinate: number;
  draggedAnchor: AlignmentAnchor;
  referenceAnchor: AlignmentAnchor;
  referenceNodeId: string;
  start: number;
  end: number;
}

export interface AlignmentResult {
  position: AlignmentPosition;
  horizontalGuide: AlignmentGuide | null;
  verticalGuide: AlignmentGuide | null;
}

export interface ResizeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ResizeAlignmentResult {
  bounds: ResizeBounds;
  horizontalGuide: AlignmentGuide | null;
  verticalGuide: AlignmentGuide | null;
}

export interface ResizeActiveAnchors {
  x: AlignmentAnchor | null;
  y: AlignmentAnchor | null;
}

type AlignmentAxis = 'x' | 'y';

interface AlignmentCandidate {
  anchorPairPriority: number;
  coordinate: number;
  correction: number;
  draggedAnchor: AlignmentAnchor;
  perpendicularGap: number;
  referenceAnchor: AlignmentAnchor;
  referenceNodeId: string;
  spanEnd: number;
  spanStart: number;
}

interface AlignmentAnchorPair {
  draggedAnchor: AlignmentAnchor;
  referenceAnchor: AlignmentAnchor;
}

const anchorPairPriority = [
  { draggedAnchor: 'center', referenceAnchor: 'center' },
  { draggedAnchor: 'start', referenceAnchor: 'start' },
  { draggedAnchor: 'end', referenceAnchor: 'end' },
  { draggedAnchor: 'end', referenceAnchor: 'start' },
  { draggedAnchor: 'start', referenceAnchor: 'end' },
  { draggedAnchor: 'center', referenceAnchor: 'start' },
  { draggedAnchor: 'center', referenceAnchor: 'end' },
  { draggedAnchor: 'start', referenceAnchor: 'center' },
  { draggedAnchor: 'end', referenceAnchor: 'center' },
] as const satisfies readonly AlignmentAnchorPair[];

export function isAlignmentRectVisible(
  rect: AlignmentRect,
  viewport: AlignmentViewport,
): boolean {
  return (
    rect.x < viewport.x + viewport.width &&
    rect.x + rect.width > viewport.x &&
    rect.y < viewport.y + viewport.height &&
    rect.y + rect.height > viewport.y
  );
}

function anchorCoordinate(rect: AlignmentRect, axis: AlignmentAxis, anchor: AlignmentAnchor): number {
  const origin = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.width : rect.height;

  if (anchor === 'start') {
    return origin;
  }

  if (anchor === 'center') {
    return origin + size / 2;
  }

  return origin + size;
}

function perpendicularSpan(
  draggedRect: AlignmentRect,
  referenceRect: AlignmentRect,
  axis: AlignmentAxis,
): Pick<AlignmentCandidate, 'spanStart' | 'spanEnd'> {
  if (axis === 'x') {
    return {
      spanStart: Math.min(draggedRect.y, referenceRect.y),
      spanEnd: Math.max(
        draggedRect.y + draggedRect.height,
        referenceRect.y + referenceRect.height,
      ),
    };
  }

  return {
    spanStart: Math.min(draggedRect.x, referenceRect.x),
    spanEnd: Math.max(draggedRect.x + draggedRect.width, referenceRect.x + referenceRect.width),
  };
}

function intervalGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  if (firstEnd < secondStart) {
    return secondStart - firstEnd;
  }

  if (secondEnd < firstStart) {
    return firstStart - secondEnd;
  }

  return 0;
}

function perpendicularGap(
  draggedRect: AlignmentRect,
  referenceRect: AlignmentRect,
  axis: AlignmentAxis,
): number {
  if (axis === 'x') {
    return intervalGap(
      draggedRect.y,
      draggedRect.y + draggedRect.height,
      referenceRect.y,
      referenceRect.y + referenceRect.height,
    );
  }

  return intervalGap(
    draggedRect.x,
    draggedRect.x + draggedRect.width,
    referenceRect.x,
    referenceRect.x + referenceRect.width,
  );
}

function isPreferredCandidate(
  candidate: AlignmentCandidate,
  currentBest: AlignmentCandidate | null,
): boolean {
  if (currentBest === null) {
    return true;
  }

  if (candidate.perpendicularGap !== currentBest.perpendicularGap) {
    return candidate.perpendicularGap < currentBest.perpendicularGap;
  }

  const candidateDistance = Math.abs(candidate.correction);
  const currentDistance = Math.abs(currentBest.correction);

  if (candidateDistance !== currentDistance) {
    return candidateDistance < currentDistance;
  }

  if (candidate.anchorPairPriority !== currentBest.anchorPairPriority) {
    return candidate.anchorPairPriority < currentBest.anchorPairPriority;
  }

  return candidate.referenceNodeId.localeCompare(currentBest.referenceNodeId) < 0;
}

function findAxisAlignment(
  draggedRect: AlignmentRect,
  referenceRects: readonly AlignmentRect[],
  axis: AlignmentAxis,
  tolerance: number,
  activeDraggedAnchor: AlignmentAnchor | null = null,
): AlignmentCandidate | null {
  let bestCandidate: AlignmentCandidate | null = null;

  for (const referenceRect of referenceRects) {
    if (referenceRect.id === draggedRect.id) {
      continue;
    }

    for (const [anchorPairIndex, anchorPair] of anchorPairPriority.entries()) {
      if (
        activeDraggedAnchor !== null &&
        anchorPair.draggedAnchor !== activeDraggedAnchor
      ) {
        continue;
      }

      const draggedCoordinate = anchorCoordinate(
        draggedRect,
        axis,
        anchorPair.draggedAnchor,
      );
      const referenceCoordinate = anchorCoordinate(
        referenceRect,
        axis,
        anchorPair.referenceAnchor,
      );
      const correction = referenceCoordinate - draggedCoordinate;

      if (Math.abs(correction) > tolerance) {
        continue;
      }

      const span = perpendicularSpan(draggedRect, referenceRect, axis);
      const candidate = {
        anchorPairPriority: anchorPairIndex,
        coordinate: referenceCoordinate,
        correction,
        draggedAnchor: anchorPair.draggedAnchor,
        perpendicularGap: perpendicularGap(draggedRect, referenceRect, axis),
        referenceAnchor: anchorPair.referenceAnchor,
        referenceNodeId: referenceRect.id,
        spanEnd: span.spanEnd,
        spanStart: span.spanStart,
      };

      if (isPreferredCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate;
}

function toGuide(candidate: AlignmentCandidate | null): AlignmentGuide | null {
  if (candidate === null) {
    return null;
  }

  return {
    coordinate: candidate.coordinate,
    draggedAnchor: candidate.draggedAnchor,
    referenceAnchor: candidate.referenceAnchor,
    referenceNodeId: candidate.referenceNodeId,
    start: candidate.spanStart,
    end: candidate.spanEnd,
  };
}

export function calculateAlignment(
  draggedRect: AlignmentRect,
  referenceRects: readonly AlignmentRect[],
  tolerance: number,
): AlignmentResult {
  const effectiveTolerance = Math.max(0, tolerance);
  const verticalMatch = findAxisAlignment(draggedRect, referenceRects, 'x', effectiveTolerance);
  const horizontalMatch = findAxisAlignment(draggedRect, referenceRects, 'y', effectiveTolerance);

  return {
    position: {
      x: draggedRect.x + (verticalMatch?.correction ?? 0),
      y: draggedRect.y + (horizontalMatch?.correction ?? 0),
    },
    horizontalGuide: toGuide(horizontalMatch),
    verticalGuide: toGuide(verticalMatch),
  };
}

export function getResizeActiveAnchors(
  startBounds: ResizeBounds,
  currentBounds: ResizeBounds,
): ResizeActiveAnchors {
  return {
    x:
      currentBounds.x !== startBounds.x
        ? 'start'
        : currentBounds.width !== startBounds.width
          ? 'end'
          : null,
    y:
      currentBounds.y !== startBounds.y
        ? 'start'
        : currentBounds.height !== startBounds.height
          ? 'end'
          : null,
  };
}

function applyAxisResizeCorrection(
  bounds: ResizeBounds,
  axis: AlignmentAxis,
  activeAnchor: AlignmentAnchor,
  correction: number,
  minSize: number,
): ResizeBounds {
  if (correction === 0) {
    return bounds;
  }

  if (axis === 'x') {
    if (activeAnchor === 'start') {
      const nextX = bounds.x + correction;
      const nextWidth = bounds.width - correction;
      return nextWidth >= minSize ? { ...bounds, x: nextX, width: nextWidth } : bounds;
    }

    const nextWidth = bounds.width + correction;
    return nextWidth >= minSize ? { ...bounds, width: nextWidth } : bounds;
  }

  if (activeAnchor === 'start') {
    const nextY = bounds.y + correction;
    const nextHeight = bounds.height - correction;
    return nextHeight >= minSize ? { ...bounds, y: nextY, height: nextHeight } : bounds;
  }

  const nextHeight = bounds.height + correction;
  return nextHeight >= minSize ? { ...bounds, height: nextHeight } : bounds;
}

export function calculateResizeAlignment(
  currentBounds: ResizeBounds,
  startBounds: ResizeBounds,
  referenceRects: readonly AlignmentRect[],
  tolerance: number,
  minWidth: number,
  minHeight: number,
): ResizeAlignmentResult {
  const effectiveTolerance = Math.max(0, tolerance);
  const activeAnchors = getResizeActiveAnchors(startBounds, currentBounds);
  const draggedRect: AlignmentRect = {
    id: 'resizing-node',
    ...currentBounds,
  };
  let nextBounds = { ...currentBounds };
  let verticalMatch: AlignmentCandidate | null = null;
  let horizontalMatch: AlignmentCandidate | null = null;

  if (activeAnchors.x !== null) {
    verticalMatch = findAxisAlignment(
      draggedRect,
      referenceRects,
      'x',
      effectiveTolerance,
      activeAnchors.x,
    );
    if (verticalMatch !== null) {
      nextBounds = applyAxisResizeCorrection(
        nextBounds,
        'x',
        activeAnchors.x,
        verticalMatch.correction,
        minWidth,
      );
    }
  }

  if (activeAnchors.y !== null) {
    horizontalMatch = findAxisAlignment(
      { ...draggedRect, ...nextBounds },
      referenceRects,
      'y',
      effectiveTolerance,
      activeAnchors.y,
    );
    if (horizontalMatch !== null) {
      nextBounds = applyAxisResizeCorrection(
        nextBounds,
        'y',
        activeAnchors.y,
        horizontalMatch.correction,
        minHeight,
      );
    }
  }

  return {
    bounds: nextBounds,
    horizontalGuide: toGuide(horizontalMatch),
    verticalGuide: toGuide(verticalMatch),
  };
}
