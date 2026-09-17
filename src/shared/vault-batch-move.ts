import type { OperationFailure } from './operation-result';
import { relocatedPath, type VaultEntryChange } from './vault-organization';
import { entryBaseName, parentFolderOf } from './vault-paths';

const ROOT_UNFILED_PATH = 'Unfiled';

export interface VaultBatchMoveFailure {
  path: string;
  error: OperationFailure;
  unattempted: string[];
}

export interface VaultBatchMoveResult {
  changes: VaultEntryChange[];
  unchanged: string[];
  failure?: VaultBatchMoveFailure;
}

export interface VaultBatchMoveTargets {
  toMove: string[];
  unchanged: string[];
  targets: string[];
}

export interface PathRelocation {
  from: string;
  to: string;
}

export function isRootUnfiledPath(path: string): boolean {
  return path === ROOT_UNFILED_PATH;
}

export function movedEntryPath(path: string, folder: string): string {
  const base = entryBaseName(path);
  return folder ? `${folder}/${base}` : base;
}

export function rejectNestedBatchDestination(sources: readonly string[], folder: string): boolean {
  return sources.some((source) => folder === source || folder.startsWith(`${source}/`));
}

export function normalizeBatchMoveSources(paths: readonly string[], sidebarOrder: readonly string[]): string[] {
  const unique = [...new Set(paths)].filter((path) => !isRootUnfiledPath(path));
  const selected = new Set(unique);
  const roots = unique.filter((path) => ![...selected].some((other) => other !== path && path.startsWith(`${other}/`)));
  const ranks = new Map(sidebarOrder.map((path, index) => [path, index]));
  return [...roots].sort((a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity) || a.localeCompare(b));
}

export function batchMoveTargets(paths: readonly string[], folder: string): VaultBatchMoveTargets {
  const toMove: string[] = [];
  const unchanged: string[] = [];
  const targets: string[] = [];
  for (const path of paths) {
    if (parentFolderOf(path) === folder) unchanged.push(path);
    else {
      toMove.push(path);
      targets.push(movedEntryPath(path, folder));
    }
  }
  return { toMove, unchanged, targets };
}

export function remapSelectedPaths(paths: ReadonlySet<string>, changes: readonly PathRelocation[]): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    let current = path;
    for (const change of changes) current = relocatedPath(current, change.from, change.to);
    next.add(current);
  }
  return next;
}

export function pruneSelectedPaths(paths: ReadonlySet<string>, visibleSelectable: ReadonlySet<string>): Set<string> {
  return new Set([...paths].filter((path) => visibleSelectable.has(path)));
}
