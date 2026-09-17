import { rejectNestedBatchDestination } from '../../shared/vault-batch-move';
import { FILE_EXTENSIONS, parentFolderOf, entryBaseName } from '../../shared/vault-paths';
export { FILE_EXTENSIONS, parentFolderOf, entryBaseName, entryTitle } from '../../shared/vault-paths';
import type { VaultEntry } from '../../shared/vault-format';
import { vaultNameSchema } from '../../shared/vault-organization';
import type { OperationFailure } from '../../shared/operation-result';

export type VaultEntryKind = 'folder' | 'document' | 'canvas';

export interface FolderOption {
  path: string;
  name: string;
  depth: number;
}

export function listFolders(entries: readonly VaultEntry[], depth = 0): FolderOption[] {
  const folders: FolderOption[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'folder') continue;
    folders.push({ path: entry.path, name: entry.name, depth });
    if (entry.children) folders.push(...listFolders(entry.children, depth + 1));
  }
  return folders;
}

export function findVaultEntry(entries: readonly VaultEntry[], path: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findVaultEntry(entry.children, path);
    if (found) return found;
  }
}

/** Whether moving the source into the folder ('' = vault root) is a real, legal move. */
export function canDropInto(source: { path: string; kind: VaultEntryKind }, folder: string): boolean {
  if (folder === parentFolderOf(source.path)) return false;
  if (source.kind !== 'folder') return true;
  return folder !== source.path && !folder.startsWith(`${source.path}/`);
}

export function canDropGroup(sources: readonly { path: string; kind: VaultEntryKind }[], folder: string): boolean {
  if (rejectNestedBatchDestination(sources.map((source) => source.path), folder)) return false;
  const needsMove = sources.filter((source) => parentFolderOf(source.path) !== folder);
  if (!needsMove.length) return false;
  return needsMove.every((source) => canDropInto(source, folder));
}

export function movedPath(path: string, folder: string): string {
  const base = entryBaseName(path);
  return folder ? `${folder}/${base}` : base;
}

export function renamedPath(path: string, kind: VaultEntryKind, name: string): string {
  const parent = parentFolderOf(path);
  const base = `${name}${FILE_EXTENSIONS[kind]}`;
  return parent ? `${parent}/${base}` : base;
}

/** The expanded-folder set with the folder and every ancestor added. */
export function expandedWithAncestors(expanded: ReadonlySet<string>, folder: string): Set<string> {
  const next = new Set(expanded);
  const segments = folder ? folder.split('/') : [];
  for (let index = 1; index <= segments.length; index += 1) {
    next.add(segments.slice(0, index).join('/'));
  }
  return next;
}

export function locationLabel(vaultName: string, folder: string): string {
  return [vaultName, ...(folder ? folder.split('/') : [])].join(' / ');
}

/** Client-side name validation mirroring the vault name rules, with a friendly empty-name message. */
export function nameValidationError(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  const result = vaultNameSchema.safeParse(name);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'This name cannot be used.';
}

/** Display wording does not determine the failure category. */
export function friendlyOperationError(error: OperationFailure): string {
  if (error.code === 'collision') return 'An item with this name already exists in this location.';
  return error.message;
}
