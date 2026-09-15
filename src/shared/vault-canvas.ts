import { z } from 'zod';
import { OperationError } from './operation-result';
import { vaultNameSchema } from './vault-organization';
import { reconcileLayerOrder } from './stacking-order';
import { canvasEdgeSchema, canvasGroupSchema } from './canvas-elements';

export const canvasNodeSchema = z.strictObject({
  id: z.uuid(), kind: z.literal('document'), documentId: z.uuid(),
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(),
  color: z.string().optional(),
});

const presentationFields = {
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema.strict()),
  groups: z.array(canvasGroupSchema.strict()),
  layerOrder: z.array(z.string()),
  viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number().min(0.1).max(4) }),
};

export const canvasPresentationSchema = z.strictObject(presentationFields).superRefine((canvas, context) => {
  const nodes = new Set(canvas.nodes.map((node) => node.id));
  const documents = new Set(canvas.nodes.map((node) => node.documentId));
  const groups = new Set(canvas.groups.map((group) => group.id));
  const members = canvas.groups.flatMap((group) => group.nodeIds);
  const units = new Set([...nodes].filter((id) => !members.includes(id)).concat([...groups]));
  if (nodes.size !== canvas.nodes.length || documents.size !== canvas.nodes.length || groups.size !== canvas.groups.length
    || [...groups].some((id) => nodes.has(id)) || new Set(members).size !== members.length
    || members.some((id) => !nodes.has(id))
    || new Set(canvas.edges.map((edge) => edge.id)).size !== canvas.edges.length
    || canvas.edges.some((edge) => !nodes.has(edge.fromNode) || !nodes.has(edge.toNode))
    || canvas.layerOrder.length !== units.size || new Set(canvas.layerOrder).size !== units.size
    || canvas.layerOrder.some((id) => !units.has(id))) {
    context.addIssue({ code: 'custom', message: 'Canvas contains duplicate identities, invalid relationships, or invalid layer order.' });
  }
});

export const canvasFileSchema = z.strictObject({
  formatVersion: z.literal(1), id: z.uuid(), title: vaultNameSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  ...presentationFields,
}).superRefine((file, context) => {
  const { nodes, edges, groups, layerOrder, viewport } = file;
  const parsed = canvasPresentationSchema.safeParse({ nodes, edges, groups, layerOrder, viewport });
  if (!parsed.success) context.addIssue({ code: 'custom', message: parsed.error.message });
});

export type CanvasFile = z.infer<typeof canvasFileSchema>;
export type CanvasPresentation = z.infer<typeof canvasPresentationSchema>;

export function removeCanvasNodes(canvas: CanvasFile, ids: ReadonlySet<string>): CanvasFile {
  const nodes = canvas.nodes.filter((node) => !ids.has(node.id));
  const groups = canvas.groups.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !ids.has(id)) }))
    .filter((group) => group.nodeIds.length >= 2);
  const expandedOrder = canvas.layerOrder.flatMap((id) => {
    const group = canvas.groups.find((candidate) => candidate.id === id);
    return group && !groups.some((candidate) => candidate.id === id) ? group.nodeIds.filter((member) => !ids.has(member)) : [id];
  });
  return canvasFileSchema.parse({ ...canvas, nodes, groups,
    edges: canvas.edges.filter((edge) => !ids.has(edge.fromNode) && !ids.has(edge.toNode)),
    layerOrder: reconcileLayerOrder(expandedOrder, nodes.map((node) => node.id), groups), updatedAt: new Date().toISOString() });
}

export function newCanvas(title: string): CanvasFile {
  const now = new Date().toISOString();
  return { formatVersion: 1, id: crypto.randomUUID(), title: vaultNameSchema.parse(title), createdAt: now, updatedAt: now,
    nodes: [], edges: [], groups: [], layerOrder: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

export function decodeCanvas(raw: string): CanvasFile {
  const input = JSON.parse(raw);
  const { formatVersion } = z.object({ formatVersion: z.number() }).parse(input);
  if (formatVersion !== 1) throw new OperationError({ code: 'unsupported-format', message: `Unsupported canvas format version: ${formatVersion}` });
  return canvasFileSchema.parse(input);
}
