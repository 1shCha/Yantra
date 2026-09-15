import type { CanvasPresentation } from './vault-canvas';

function reuseArray<T>(next: T[], previous: T[], equal: (left: T, right: T) => boolean): T[] {
  return next === previous || (next.length === previous.length && next.every((item, index) => equal(item, previous[index]!)))
    ? previous : next;
}

// Compare only persisted fields. Selection and editor state are transient
// and must not trigger a canvas save.
export function reconcileCanvasPresentation(next: CanvasPresentation, previous: CanvasPresentation): CanvasPresentation {
  const nodes = reuseArray(next.nodes, previous.nodes, (a, b) => a.id === b.id && a.kind === b.kind
    && a.documentId === b.documentId && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.color === b.color);
  const edges = reuseArray(next.edges, previous.edges, (a, b) => a.id === b.id && a.fromNode === b.fromNode && a.toNode === b.toNode
    && a.fromSide === b.fromSide && a.toSide === b.toSide && a.fromEnd === b.fromEnd && a.toEnd === b.toEnd && a.color === b.color && a.label === b.label);
  const groups = reuseArray(next.groups, previous.groups, (a, b) => a.id === b.id
    && a.nodeIds.length === b.nodeIds.length && a.nodeIds.every((id, index) => id === b.nodeIds[index]));
  const layerOrder = reuseArray(next.layerOrder, previous.layerOrder, (a, b) => a === b);
  const viewport = next.viewport.x === previous.viewport.x && next.viewport.y === previous.viewport.y && next.viewport.zoom === previous.viewport.zoom
    ? previous.viewport : next.viewport;
  if (nodes === previous.nodes && edges === previous.edges && groups === previous.groups
    && layerOrder === previous.layerOrder && viewport === previous.viewport) return previous;
  return { nodes, edges, groups, layerOrder, viewport };
}
