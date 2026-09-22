import { OperationError } from './operation-result';
import type { CanvasFile } from './vault-canvas';
import type { VaultEntry } from './vault-format';
import { FILE_EXTENSIONS, entryBaseName, parentFolderOf } from './vault-paths';

export const CANVAS_NODE_DEFAULT_WIDTH = 220;
export const CANVAS_NODE_DEFAULT_HEIGHT = 75;

export const UNSUPPORTED_PACKAGE_OPERATION = 'This operation is not supported for canvas packages yet.';

export function isContainerKind(kind: VaultEntry['kind']): boolean {
  return kind === 'folder' || kind === 'canvas';
}

export function isContainerEntry(entry: Pick<VaultEntry, 'kind'>): boolean {
  return isContainerKind(entry.kind);
}

export function isOrdinaryFolder(entry: Pick<VaultEntry, 'kind'>): boolean {
  return entry.kind === 'folder';
}

export function packageLayoutPath(packagePath: string): string {
  const name = entryBaseName(packagePath);
  if (!name) throw new OperationError({ code: 'invalid-input', message: 'A canvas package requires a folder name.' });
  return `${packagePath}/${name}${FILE_EXTENSIONS.canvas}`;
}

export function packagePathFromLayout(layoutPath: string): string {
  return parentFolderOf(layoutPath);
}

export function findVaultEntry(entries: readonly VaultEntry[], path: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findVaultEntry(entry.children, path);
    if (found) return found;
  }
}

export function flattenVaultEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenVaultEntries(entry.children ?? [])]);
}

export function collectPackagePaths(entries: readonly VaultEntry[]): Set<string> {
  return new Set(flattenVaultEntries(entries).filter((entry) => entry.kind === 'canvas').map((entry) => entry.path));
}

export function owningPackagePath(relative: string, packages: ReadonlySet<string>): string | undefined {
  if (packages.has(relative)) return relative;
  const parent = parentFolderOf(relative);
  if (parent && packages.has(parent)) return parent;
}

export type CanvasNodePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function canvasNodePlacement(center?: { x: number; y: number }): CanvasNodePlacement {
  return {
    x: center ? Math.round(center.x - CANVAS_NODE_DEFAULT_WIDTH / 2) : 0,
    y: center ? Math.round(center.y - CANVAS_NODE_DEFAULT_HEIGHT / 2) : 0,
    width: CANVAS_NODE_DEFAULT_WIDTH,
    height: CANVAS_NODE_DEFAULT_HEIGHT,
  };
}

export function membershipKey(canvas: Pick<CanvasFile, 'nodes'>): string {
  return [...canvas.nodes]
    .map((node) => `${node.id}:${node.documentId}`)
    .sort()
    .join('|');
}

export function assertPresentationOnlySave(
  current: CanvasFile,
  next: CanvasFile,
  packageDocumentIds: ReadonlySet<string>,
): void {
  if (next.id !== current.id || next.title !== current.title || next.createdAt !== current.createdAt) {
    throw new OperationError({ code: 'invalid-input', message: 'Canvas identity cannot change during saving.' });
  }
  if (membershipKey(next) !== membershipKey(current)) {
    throw new OperationError({
      code: 'invalid-input',
      message: 'Canvas membership cannot change during presentation saving. Refresh the vault.',
    });
  }
  const seen = new Set<string>();
  for (const node of next.nodes) {
    if (!packageDocumentIds.has(node.documentId)) {
      throw new OperationError({
        code: 'invalid-input',
        message: 'Canvas nodes must reference documents in this package. Refresh the vault.',
      });
    }
    if (seen.has(node.documentId)) {
      throw new OperationError({ code: 'invalid-input', message: 'A document can appear only once on a canvas.' });
    }
    seen.add(node.documentId);
  }
}

export function packageDocumentIdsEqual(
  documentIds: ReadonlySet<string>,
  canvas: Pick<CanvasFile, 'nodes'>,
): boolean {
  if (documentIds.size !== canvas.nodes.length) return false;
  return canvas.nodes.every((node) => documentIds.has(node.documentId));
}
