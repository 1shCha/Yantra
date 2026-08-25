import type { Edge, Node } from '@xyflow/react';

import {
  JSON_CANVAS_TEXT_NODE_TYPE,
  REACT_FLOW_TEXT_NODE_TYPE,
  sanitizeJsonCanvasGroups,
  type CanvasEnd,
  type CanvasSide,
  type JsonCanvasDocument,
  type JsonCanvasEdge,
  type JsonCanvasGroup,
  type JsonCanvasNode,
} from '../../shared/json-canvas';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;

export const MARKDOWN_NODE_MIN_WIDTH = 220;
export const MARKDOWN_NODE_MIN_HEIGHT = 160;

export interface MarkdownNodeData extends Record<string, unknown> {
  canvasType: typeof JSON_CANVAS_TEXT_NODE_TYPE;
  text: string;
  content: string;
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
export type CanvasGroup = JsonCanvasGroup;

export interface CanvasFlowState {
  nodes: MarkdownFlowNode[];
  edges: MarkdownFlowEdge[];
  groups: CanvasGroup[];
}

function toCanvasInteger(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function jsonCanvasNodeToReactFlowNode(node: JsonCanvasNode): MarkdownFlowNode {
  return {
    id: node.id,
    type: REACT_FLOW_TEXT_NODE_TYPE,
    position: {
      x: node.x,
      y: node.y,
    },
    data: {
      canvasType: node.type,
      text: node.text,
      content: node.text,
      color: node.color,
    },
    style: {
      width: node.width,
      height: node.height,
    },
  };
}

function readDimension(value: number | string | undefined): number {
  if (value === undefined) {
    return Number.NaN;
  }

  return Number(value);
}

function getFlowNodeWidth(node: MarkdownFlowNode): number {
  const raw = node.measured?.width ?? node.width ?? readDimension(node.style?.width);
  return toCanvasInteger(raw, NODE_WIDTH);
}

function getFlowNodeHeight(node: MarkdownFlowNode): number {
  const raw = node.measured?.height ?? node.height ?? readDimension(node.style?.height);
  return toCanvasInteger(raw, NODE_HEIGHT);
}

function jsonCanvasNodeFromFlowNode(node: MarkdownFlowNode): JsonCanvasNode {
  return {
    id: node.id,
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(Number(node.position.x)),
    y: toCanvasInteger(Number(node.position.y)),
    width: getFlowNodeWidth(node),
    height: getFlowNodeHeight(node),
    text: node.data.content,
    color: node.data.color,
  };
}

function jsonCanvasEdgeToReactFlowEdge(edge: JsonCanvasEdge): MarkdownFlowEdge {
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

function jsonCanvasEdgeFromFlowEdge(edge: MarkdownFlowEdge): JsonCanvasEdge {
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

export function createMarkdownNodeAt(position: { x: number; y: number }): MarkdownFlowNode {
  return jsonCanvasNodeToReactFlowNode({
    id: crypto.randomUUID(),
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(position.x - NODE_WIDTH / 2),
    y: toCanvasInteger(position.y - NODE_HEIGHT / 2),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    text: '',
  });
}

export function toJsonCanvasDocument(state: CanvasFlowState): JsonCanvasDocument {
  return {
    nodes: state.nodes.map(jsonCanvasNodeFromFlowNode),
    edges: state.edges.map(jsonCanvasEdgeFromFlowEdge),
    groups: state.groups.map((group) => ({
      id: group.id,
      nodeIds: [...group.nodeIds],
    })),
  };
}

export function hydrateNodes(nodes: JsonCanvasNode[] | undefined): MarkdownFlowNode[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map(jsonCanvasNodeToReactFlowNode);
}

export function hydrateEdges(edges: JsonCanvasEdge[] | undefined): MarkdownFlowEdge[] {
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges.map(jsonCanvasEdgeToReactFlowEdge);
}

export function hydrateGroups(
  groups: JsonCanvasGroup[] | undefined,
  nodes: readonly MarkdownFlowNode[],
): CanvasGroup[] {
  if (!Array.isArray(groups)) {
    return [];
  }

  return sanitizeJsonCanvasGroups(
    groups,
    new Set(nodes.map((node) => node.id)),
  ).map((group) => ({
    id: group.id,
    nodeIds: [...group.nodeIds],
  }));
}
