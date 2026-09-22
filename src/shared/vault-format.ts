import { z } from 'zod';
import { OperationError, type OperationFailure } from './operation-result';
import { createEmptyTiptapDoc, tiptapDocSchema } from './tiptap-document';
import { vaultNameSchema, type CanvasAppearance } from './vault-organization';

export const VAULT_FORMAT_VERSION = 2;

export const vaultMetadataSchema = z.strictObject({
  sidebarOrder: z.array(z.string()).optional(),
  formatVersion: z.literal(VAULT_FORMAT_VERSION),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});

export function decodeVaultMetadata(raw: string): VaultMetadata {
  const value: unknown = JSON.parse(raw);
  const version = z.object({ formatVersion: z.number() }).parse(value);
  if (version.formatVersion !== VAULT_FORMAT_VERSION) {
    throw new OperationError({ code: 'unsupported-format', message: `Unsupported vault format version: ${version.formatVersion}` });
  }
  return vaultMetadataSchema.parse(value);
}

export const documentFileSchema = z.strictObject({
  formatVersion: z.literal(1),
  id: z.uuid(),
  title: vaultNameSchema,
  doc: tiptapDocSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

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
  return { formatVersion: 1, id: crypto.randomUUID(), title: vaultNameSchema.parse(title), doc: tiptapDocSchema.parse(createEmptyTiptapDoc()), createdAt: now, updatedAt: now };
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
