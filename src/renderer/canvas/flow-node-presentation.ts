import type { MarkdownFlowNode } from './react-flow-mapping';

// Cache by immutable source node, not the entire list. Adding one node must not
// replace React Flow's internal objects for all the existing nodes.
const presentations = new WeakMap<MarkdownFlowNode, MarkdownFlowNode>();

export function presentFlowNodes(nodes: MarkdownFlowNode[], selectedIds: readonly string[], zIndices: ReadonlyMap<string, number>): MarkdownFlowNode[] {
  const selected = new Set(selectedIds);
  return nodes.map((node) => {
    const isSelected = selected.has(node.id);
    const zIndex = zIndices.get(node.id) ?? 0;
    const previous = presentations.get(node);
    if (previous && previous.selected === isSelected && previous.zIndex === zIndex) return previous;
    const next = { ...node, selected: isSelected, zIndex };
    presentations.set(node, next);
    return next;
  });
}
