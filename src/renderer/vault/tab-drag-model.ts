export interface TabDragRect {
  left: number;
  right: number;
  width: number;
}

export type TabDragEndReason = 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'escape' | 'replace';

export interface TabDragPreview {
  to: number;
  offsets: number[];
}

/** Convert viewport rects captured at pointer-down into list content coordinates. */
export function toContentRects(rects: readonly TabDragRect[], startScroll: number): TabDragRect[] {
  return rects.map((rect) => ({ left: rect.left + startScroll, right: rect.right + startScroll, width: rect.width }));
}

export function pointerContentDelta(clientX: number, startX: number, scrollLeft: number, startScroll: number): number {
  return clientX - startX + scrollLeft - startScroll;
}

/** Compare the leading edge with the next occupied slot's midpoint. Retain the slot when reversing. */
export function previewTabDrag(
  rects: readonly TabDragRect[],
  from: number,
  to: number,
  previousDelta: number,
  delta: number,
): TabDragPreview {
  let next = to;
  if (delta > previousDelta) {
    const right = rects[from]!.right + delta;
    while (next < rects.length - 1 && right > rects[next + 1]!.left + rects[next + 1]!.width / 2) next += 1;
  } else if (delta < previousDelta) {
    const left = rects[from]!.left + delta;
    while (next > 0 && left < rects[next - 1]!.left + rects[next - 1]!.width / 2) next -= 1;
  }
  const step = rects[1]!.left - rects[0]!.left;
  const offsets = rects.map((_, index) => (
    index === from ? delta : index > from && index <= next ? -step : index < from && index >= next ? step : 0
  ));
  return { to: next, offsets };
}

export function tabDragShouldCommit(options: {
  reason: TabDragEndReason;
  dragging: boolean;
  busy: boolean;
  tabOpen: boolean;
  from: number;
  to: number;
}): boolean {
  if (!options.dragging || options.busy || !options.tabOpen || options.to === options.from) return false;
  return options.reason === 'pointerup' || options.reason === 'pointercancel' || options.reason === 'lostpointercapture';
}
