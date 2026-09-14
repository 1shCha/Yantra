import { z } from 'zod';
import { OperationError, type OperationFailure } from './operation-result';
import { createEmptyTiptapDoc, tiptapNodeAttrsSchema } from './tiptap-document';
import { vaultNameSchema, type CanvasAppearance } from './vault-organization';

const documentAttrsSchema = tiptapNodeAttrsSchema.strict();
const documentMarkSchema = z.object({
  type: z.enum(['bold', 'italic', 'highlight', 'link']),
  attrs: documentAttrsSchema.optional(),
}).strict();
const documentNodeSchema = z.strictObject({
  type: z.enum(['paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock']),
  text: z.string().optional(),
  attrs: documentAttrsSchema.optional(),
  marks: z.array(documentMarkSchema).optional(),
  get content() { return z.array(documentNodeSchema).optional(); },
});

// Reject unknown content rather than silently stripping it during an edit/save.
export const documentContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(documentNodeSchema).optional(),
}).strict();

export const vaultMetadataSchema = z.object({
  formatVersion: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
}).strict();

export const documentFileSchema = z.object({
  formatVersion: z.literal(1),
  id: z.uuid(),
  title: vaultNameSchema,
  doc: documentContentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type VaultMetadata = z.infer<typeof vaultMetadataSchema>;
export type DocumentFile = z.infer<typeof documentFileSchema>;

export function decodeDocument(raw: string): DocumentFile {
  const value = JSON.parse(raw);
  const version = z.object({ formatVersion: z.number() }).parse(value);
  if (version.formatVersion !== 1) throw new OperationError({ code: 'unsupported-format', message: `Unsupported document format version: ${version.formatVersion}` });
  return documentFileSchema.parse(value);
}

export function newDocument(title: string): DocumentFile {
  const now = new Date().toISOString();
  return { formatVersion: 1, id: crypto.randomUUID(), title: vaultNameSchema.parse(title), doc: documentContentSchema.parse(createEmptyTiptapDoc()), createdAt: now, updatedAt: now };
}

export interface VaultEntry {
  path: string;
  name: string;
  kind: 'folder' | 'document' | 'canvas';
  documentId?: string;
  canvasId?: string;
  error?: string;
  failure?: OperationFailure;
  children?: VaultEntry[];
}

export interface VaultSnapshot {
  recovery?: { path: string; message: string } | null;
  sessionId: string;
  root: string;
  name: string;
  metadata: VaultMetadata;
  entries: VaultEntry[];
  appearances: CanvasAppearance[];
}
