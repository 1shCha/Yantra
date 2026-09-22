import type { MouseEvent } from 'react';
import type { VaultTreeEntry } from '../vault-ui/VaultSidebar';

export interface VisibleSidebarRow {
  path: string;
  kind: VaultTreeEntry['kind'];
  unavailable?: boolean;
}

export interface SidebarSelectionGesture {
  path: string;
  additive: boolean;
  range: boolean;
}

export interface SidebarSelection {
  paths: Set<string>;
  anchor: string | null;
}

export function isModifierSelection(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}

export function collectVisibleSidebarRows(entries: readonly VaultTreeEntry[], expanded: ReadonlySet<string>): VisibleSidebarRow[] {
  const rows: VisibleSidebarRow[] = [];
  const walk = (items: readonly VaultTreeEntry[]) => {
    for (const entry of items) {
      rows.push({ path: entry.id, kind: entry.kind, unavailable: entry.unavailable });
      if ((entry.kind === 'folder' || entry.kind === 'canvas') && expanded.has(entry.id) && entry.children) walk(entry.children);
    }
  };
  walk(entries);
  return rows;
}

export function selectableVisiblePaths(rows: readonly VisibleSidebarRow[]): string[] {
  return rows.filter((row) => !row.unavailable).map((row) => row.path);
}

export function applySelectionGesture(
  selected: ReadonlySet<string>,
  anchor: string | null,
  gesture: SidebarSelectionGesture,
  rows: readonly VisibleSidebarRow[],
): SidebarSelection {
  const selectable = selectableVisiblePaths(rows);
  if (!gesture.range) {
    if (!gesture.additive) return { paths: new Set([gesture.path]), anchor: gesture.path };
    const paths = new Set(selected);
    if (paths.has(gesture.path)) paths.delete(gesture.path);
    else paths.add(gesture.path);
    return { paths, anchor: gesture.path };
  }
  const fromIndex = anchor === null ? -1 : selectable.indexOf(anchor);
  const toIndex = selectable.indexOf(gesture.path);
  if (fromIndex === -1 || toIndex === -1) {
    if (!gesture.additive) return { paths: new Set([gesture.path]), anchor: gesture.path };
    const paths = new Set(selected);
    paths.add(gesture.path);
    return { paths, anchor: gesture.path };
  }
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const range = selectable.slice(start, end + 1);
  const paths = gesture.additive ? new Set(selected) : new Set<string>();
  for (const path of range) paths.add(path);
  return { paths, anchor };
}
