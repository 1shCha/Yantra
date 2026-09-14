import { z } from 'zod';
import { OperationError } from './operation-result';

export const MAX_VAULT_NAME_LENGTH = 180;
export const FILE_EXTENSIONS = { folder: '', document: '.yantraD', canvas: '.yantraC' } as const;
export const vaultNameSchema = z.string().min(1).max(MAX_VAULT_NAME_LENGTH).refine((name) => !/[^A-Za-z0-9_-]/.test(name),
  'Use only letters (A-Z, a-z), numbers, underscores, and hyphens. Spaces are not allowed.');

export function vaultFileKind(relative: string): 'document' | 'canvas' | null {
  if (relative.endsWith(FILE_EXTENSIONS.document)) return 'document';
  if (relative.endsWith(FILE_EXTENSIONS.canvas)) return 'canvas';
  return null;
}

export function vaultFileExtension(relative: string): '.yantraD' | '.yantraC' {
  const kind = vaultFileKind(relative);
  if (!kind) throw new OperationError({ code: 'invalid-input', message: 'Only Yantra documents, canvases, and folders can be organized.' });
  return FILE_EXTENSIONS[kind];
}

export function parentFolderOf(relative: string): string { return relative.split('/').slice(0, -1).join('/'); }
export function entryBaseName(relative: string): string { return relative.split('/').at(-1) ?? relative; }
export function entryTitle(name: string, kind: keyof typeof FILE_EXTENSIONS): string {
  const extension = FILE_EXTENSIONS[kind];
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name;
}
