import type { DocumentFile, VaultEntry } from './vault-format';
import type { CanvasFile } from './vault-canvas';

export { vaultNameSchema } from './vault-paths';

export interface CanvasAppearance {
  documentId: string;
  canvasId: string;
  canvasPath: string;
  nodeId: string;
}

export interface VaultEntryChange {
  from: string;
  to: string;
  document?: DocumentFile;
  canvas?: CanvasFile;
}

export function relocatedPath(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

export function relocateEntries(entries: VaultEntry[], from: string, to: string): VaultEntry[] {
  let moved: VaultEntry | undefined;
  function update(entry: VaultEntry): VaultEntry {
    const path = relocatedPath(entry.path, from, to);
    return { ...entry, path, name: path.split('/').at(-1)!, children: entry.children?.map(update) };
  }
  function remove(items: VaultEntry[]): VaultEntry[] {
    return items.filter((entry) => {
      if (entry.path !== from) return true;
      moved = update(entry);
      return false;
    }).map((entry) => entry.children ? { ...entry, children: remove(entry.children) } : entry);
  }
  const remaining = remove(entries);
  if (!moved) throw new Error('The source entry is not in the vault.');
  return insertEntry(remaining, to.split('/').slice(0, -1).join('/'), moved);
}

export function insertEntry(entries: VaultEntry[], folder: string, entry: VaultEntry): VaultEntry[] {
  if (!folder) return [...entries, entry].sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  return entries.map((item) => item.path === folder ? { ...item, children: insertEntry(item.children ?? [], '', entry) }
    : item.children ? { ...item, children: insertEntry(item.children, folder, entry) } : item);
}
