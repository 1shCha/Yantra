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
  sidebarOrder?: string[];
  warning?: string;
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
    : item.children && folder.startsWith(`${item.path}/`) ? { ...item, children: insertEntry(item.children, folder, entry) } : item);
}

export interface EntryPlacement { anchor: string; side: 'before' | 'after' }

/** Saved paths rank siblings only; newly discovered entries retain their default order at the end. */
export function orderEntries(entries: VaultEntry[], order: readonly string[] = []): VaultEntry[] {
  const ranks = new Map(order.map((path, index) => [path, index]));
  const walk = (items: VaultEntry[]): VaultEntry[] => {
    const sorted = items.map((entry) => {
      if (!entry.children) return entry;
      const children = walk(entry.children);
      return children === entry.children ? entry : { ...entry, children };
    }).sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder')
      || (ranks.get(a.path) ?? Infinity) - (ranks.get(b.path) ?? Infinity));
    return sorted.every((entry, index) => entry === items[index]) ? items : sorted;
  };
  return walk(entries);
}

/** Replace only the affected sibling group's ranking, retaining other folders' preferences. */
export function reorderedPaths(siblings: VaultEntry[], saved: readonly string[], source: string, placement: EntryPlacement): string[] {
  const ordered = orderEntries(siblings, saved).map((entry) => entry.path);
  if (source === placement.anchor) return [...saved];
  const remaining = ordered.filter((item) => item !== source);
  remaining.splice(remaining.indexOf(placement.anchor) + Number(placement.side === 'after'), 0, source);
  if (remaining.every((item, index) => item === ordered[index])) return [...saved];
  const paths = new Set(ordered);
  return [...saved.filter((item) => !paths.has(item)), ...remaining];
}
