import { z } from 'zod';

export const JSON_CANVAS_TEXT_NODE_TYPE = 'text' as const;
export const REACT_FLOW_TEXT_NODE_TYPE = 'markdownNode' as const;

const NODE_WIDTH = 320;
const NODE_HEIGHT = 220;

export const canvasSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const canvasEndSchema = z.enum(['none', 'arrow']);

export type CanvasSide = z.infer<typeof canvasSideSchema>;
export type CanvasEnd = z.infer<typeof canvasEndSchema>;

const numericFieldSchema = z.union([z.number(), z.string()]).transform((value) => Number(value));

const nodeDataInputSchema = z.object({
  text: z.string().optional(),
  content: z.string().optional(),
  color: z.string().optional(),
});

const nodePositionInputSchema = z.object({
  x: numericFieldSchema.optional(),
  y: numericFieldSchema.optional(),
});

const nodeStyleInputSchema = z.object({
  width: numericFieldSchema.optional(),
  height: numericFieldSchema.optional(),
});

const lenientNodeInputSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  x: numericFieldSchema.optional(),
  y: numericFieldSchema.optional(),
  position: nodePositionInputSchema.optional(),
  width: numericFieldSchema.optional(),
  height: numericFieldSchema.optional(),
  measured: z
    .object({
      width: numericFieldSchema.optional(),
      height: numericFieldSchema.optional(),
    })
    .optional(),
  style: nodeStyleInputSchema.optional(),
  text: z.string().optional(),
  data: nodeDataInputSchema.optional(),
  color: z.string().optional(),
});

const lenientEdgeInputSchema = z.object({
  id: z.string().optional(),
  fromNode: z.string().optional(),
  toNode: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
  fromSide: canvasSideSchema.optional(),
  toSide: canvasSideSchema.optional(),
  fromEnd: canvasEndSchema.optional(),
  toEnd: canvasEndSchema.optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const jsonCanvasNodeSchema = z.object({
  id: z.string(),
  type: z.literal(JSON_CANVAS_TEXT_NODE_TYPE),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  text: z.string(),
  color: z.string().optional(),
});

export const jsonCanvasEdgeSchema = z.object({
  id: z.string(),
  fromNode: z.string(),
  toNode: z.string(),
  fromSide: canvasSideSchema.optional(),
  toSide: canvasSideSchema.optional(),
  fromEnd: canvasEndSchema.optional(),
  toEnd: canvasEndSchema.optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const jsonCanvasDocumentSchema = z.object({
  nodes: z.array(jsonCanvasNodeSchema),
  edges: z.array(jsonCanvasEdgeSchema),
});

export type JsonCanvasNode = z.infer<typeof jsonCanvasNodeSchema>;
export type JsonCanvasEdge = z.infer<typeof jsonCanvasEdgeSchema>;
export type JsonCanvasDocument = z.infer<typeof jsonCanvasDocumentSchema>;

type LenientNodeInput = z.infer<typeof lenientNodeInputSchema>;
type LenientEdgeInput = z.infer<typeof lenientEdgeInputSchema>;

const jsonCanvasDocumentInputSchema = z.object({
  nodes: z.array(z.looseObject({})).default([]),
  edges: z.array(z.looseObject({})).default([]),
});

function toCanvasInteger(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function getNodeText(input: LenientNodeInput): string {
  if (input.text !== undefined) {
    return input.text;
  }

  if (input.data?.text !== undefined) {
    return input.data.text;
  }

  if (input.data?.content !== undefined) {
    return input.data.content;
  }

  return '';
}

function getNodeWidth(input: LenientNodeInput): number {
  const rawWidth = input.width ?? input.measured?.width ?? input.style?.width;
  return toCanvasInteger(rawWidth === undefined ? Number.NaN : Number(rawWidth), NODE_WIDTH);
}

function getNodeHeight(input: LenientNodeInput): number {
  const rawHeight = input.height ?? input.measured?.height ?? input.style?.height;
  return toCanvasInteger(rawHeight === undefined ? Number.NaN : Number(rawHeight), NODE_HEIGHT);
}

function shouldKeepNode(input: LenientNodeInput): boolean {
  if (input.type === REACT_FLOW_TEXT_NODE_TYPE) {
    return true;
  }

  if (input.position !== undefined) {
    return true;
  }

  if (input.data !== undefined) {
    return true;
  }

  return input.type === JSON_CANVAS_TEXT_NODE_TYPE;
}

function normalizeJsonCanvasTextNode(input: LenientNodeInput): JsonCanvasNode {
  const color = input.color ?? input.data?.color;

  return {
    id: input.id ?? crypto.randomUUID(),
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(Number(input.x ?? input.position?.x)),
    y: toCanvasInteger(Number(input.y ?? input.position?.y)),
    width: toCanvasInteger(Number(input.width ?? input.style?.width), NODE_WIDTH),
    height: toCanvasInteger(Number(input.height ?? input.style?.height), NODE_HEIGHT),
    text: getNodeText(input),
    color,
  };
}

function normalizeReactFlowNodeToJsonCanvas(input: LenientNodeInput): JsonCanvasNode {
  const color = input.data?.color;

  return {
    id: input.id ?? crypto.randomUUID(),
    type: JSON_CANVAS_TEXT_NODE_TYPE,
    x: toCanvasInteger(Number(input.position?.x)),
    y: toCanvasInteger(Number(input.position?.y)),
    width: getNodeWidth(input),
    height: getNodeHeight(input),
    text: getNodeText(input),
    color,
  };
}

function normalizeNode(input: LenientNodeInput): JsonCanvasNode | null {
  if (!shouldKeepNode(input)) {
    return null;
  }

  if (
    input.type === REACT_FLOW_TEXT_NODE_TYPE ||
    input.position !== undefined ||
    input.data !== undefined
  ) {
    return normalizeReactFlowNodeToJsonCanvas(input);
  }

  return normalizeJsonCanvasTextNode(input);
}

function normalizeEdge(input: LenientEdgeInput): JsonCanvasEdge | null {
  const fromNode = input.fromNode ?? input.source;
  const toNode = input.toNode ?? input.target;

  if (fromNode === undefined || toNode === undefined) {
    return null;
  }

  return {
    id: input.id ?? crypto.randomUUID(),
    fromNode,
    toNode,
    fromSide: input.fromSide,
    toSide: input.toSide,
    fromEnd: input.fromEnd,
    toEnd: input.toEnd,
    color: input.color,
    label: input.label,
  };
}

function normalizeDocument(input: {
  nodes: LenientNodeInput[];
  edges: LenientEdgeInput[];
}): JsonCanvasDocument {
  const nodes = input.nodes
    .map((node) => normalizeNode(node))
    .filter((node): node is JsonCanvasNode => node !== null);

  const edges = input.edges
    .map((edge) => normalizeEdge(edge))
    .filter((edge): edge is JsonCanvasEdge => edge !== null);

  return { nodes, edges };
}

export function decodeJsonCanvasDocument(raw: string): JsonCanvasDocument {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Canvas file is not valid JSON.');
  }

  const inputResult = jsonCanvasDocumentInputSchema.safeParse(parsed);

  if (!inputResult.success) {
    throw new Error('Canvas document must contain nodes and edges arrays.');
  }

  return normalizeDocument({
    nodes: inputResult.data.nodes.map((node) => lenientNodeInputSchema.parse(node)),
    edges: inputResult.data.edges.map((edge) => lenientEdgeInputSchema.parse(edge)),
  });
}

export function encodeJsonCanvasDocument(document: JsonCanvasDocument): JsonCanvasDocument {
  return jsonCanvasDocumentSchema.parse(document);
}

export function createEmptyJsonCanvasDocument(): JsonCanvasDocument {
  return { nodes: [], edges: [] };
}
