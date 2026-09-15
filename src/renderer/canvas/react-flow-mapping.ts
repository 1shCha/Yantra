import type { Edge, Node } from '@xyflow/react';
import type { CanvasEnd, CanvasSide, CanvasEdge, CanvasGroup as StoredCanvasGroup } from '../../shared/canvas-elements';
import type { TiptapDoc } from '../../shared/tiptap-document';

export const REACT_FLOW_TEXT_NODE_TYPE = 'markdownNode' as const;

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;

export const MARKDOWN_NODE_MIN_WIDTH = 220;
export const MARKDOWN_NODE_MIN_HEIGHT = 160;

export interface MarkdownNodeData extends Record<string, unknown> {
  canvasType: 'text';
  doc?: TiptapDoc;
  documentId?: string;
  color?: string;
}

export type MarkdownFlowNode = Node<MarkdownNodeData, typeof REACT_FLOW_TEXT_NODE_TYPE>;

interface MarkdownFlowEdgeData extends Record<string, unknown> {
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toEnd?: CanvasEnd;
  color?: string;
}

export type MarkdownFlowEdge = Edge<MarkdownFlowEdgeData>;
export type CanvasGroup = StoredCanvasGroup;

function toCanvasInteger(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function readDimension(value: number | string | undefined): number {
  if (value === undefined) {
    return Number.NaN;
  }

  return Number(value);
}

export function getFlowNodeWidth(node: MarkdownFlowNode): number {
  const raw = node.measured?.width ?? node.width ?? readDimension(node.style?.width);
  return toCanvasInteger(raw, NODE_WIDTH);
}

export function getFlowNodeHeight(node: MarkdownFlowNode): number {
  const raw = node.measured?.height ?? node.height ?? readDimension(node.style?.height);
  return toCanvasInteger(raw, NODE_HEIGHT);
}

function jsonCanvasEdgeToReactFlowEdge(edge: CanvasEdge): MarkdownFlowEdge {
  return {
    id: edge.id,
    source: edge.fromNode,
    target: edge.toNode,
    label: edge.label,
    data: {
      fromSide: edge.fromSide,
      toSide: edge.toSide,
      fromEnd: edge.fromEnd,
      toEnd: edge.toEnd,
      color: edge.color,
    },
  };
}

export function jsonCanvasEdgeFromFlowEdge(edge: MarkdownFlowEdge): CanvasEdge {
  return {
    id: edge.id,
    fromNode: edge.source,
    toNode: edge.target,
    fromSide: edge.data?.fromSide,
    toSide: edge.data?.toSide,
    fromEnd: edge.data?.fromEnd,
    toEnd: edge.data?.toEnd,
    color: edge.data?.color,
    label: edge.label === null || edge.label === undefined ? undefined : String(edge.label),
  };
}

export function hydrateEdges(edges: CanvasEdge[] | undefined): MarkdownFlowEdge[] {
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges.map(jsonCanvasEdgeToReactFlowEdge);
}
