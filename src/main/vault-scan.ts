import { FILE_EXTENSIONS } from '../shared/vault-paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeDocument, type VaultEntry } from '../shared/vault-format';
import { decodeCanvas, type CanvasFile } from '../shared/vault-canvas';
import { OperationError, operationFailure, type OperationFailure } from '../shared/operation-result';
import type { CanvasAppearance } from '../shared/vault-organization';
import { isContainerKind, packageDocumentIdsEqual, packageLayoutPath } from '../shared/vault-packages';

const IGNORED_PACKAGE_FILES = new Set(['.DS_Store']);

function sortEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.sort((a, b) => Number(isContainerKind(b.kind)) - Number(isContainerKind(a.kind)) || a.name.localeCompare(b.name));
}

function failureAt(path: string, message: string, code: OperationFailure['code'] = 'invalid-format'): OperationFailure {
  return { code, message, path };
}

function entryError(path: string, message: string, code: OperationFailure['code'] = 'invalid-format'): Pick<VaultEntry, 'error' | 'failure'> {
  const failure = failureAt(path, message, code);
  return { error: failure.message, failure };
}

async function isSymlink(absolute: string): Promise<boolean> {
  return (await fs.lstat(absolute)).isSymbolicLink();
}

// Build a replacement index without touching the active repository or baselines.
export async function scanVault(resolve: (relative: string) => Promise<string>) {
  // Keep the active index and conflict baselines intact until the entire scan succeeds.
  const documentPaths = new Map<string, string>();
  const canvasPaths = new Map<string, string>();
  const canvases = new Map<string, CanvasFile>();
  const baselines = new Map<string, string>();
  const documents = new Map<string, VaultEntry[]>();
  const canvasEntries = new Map<string, VaultEntry[]>();
  const invalidPackagePaths = new Set<string>();

  const readDocumentEntry = async (relative: string, name: string): Promise<VaultEntry> => {
    const entry: VaultEntry = { path: relative, name, kind: 'document' };
    try {
      const raw = await fs.readFile(await resolve(relative), 'utf8');
      const document = decodeDocument(raw);
      baselines.set(relative, raw);
      if (document.title !== path.basename(relative, FILE_EXTENSIONS.document)) {
        throw new OperationError({ code: 'invalid-input', message: 'Document title does not match its filename.' });
      }
      entry.documentId = document.id;
      const matches = documents.get(document.id) ?? [];
      matches.push(entry);
      documents.set(document.id, matches);
    } catch (error) {
      entry.failure = operationFailure(error);
      entry.error = entry.failure.message;
    }
    return entry;
  };

  const classifyPackage = async (relative: string, name: string): Promise<VaultEntry> => {
    const absolute = await resolve(relative);
    const listing = await fs.readdir(absolute, { withFileTypes: true });
    const layouts: string[] = [];
    const documentNames: string[] = [];
    const problems: string[] = [];
    for (const item of listing) {
      if (IGNORED_PACKAGE_FILES.has(item.name)) continue;
      if (item.isSymbolicLink() || await isSymlink(path.join(absolute, item.name))) {
        problems.push('Packages cannot contain symbolic links.');
        continue;
      }
      if (item.isDirectory()) {
        problems.push('Packages cannot contain folders.');
        continue;
      }
      if (item.isFile() && item.name.endsWith(FILE_EXTENSIONS.canvas)) layouts.push(item.name);
      else if (item.isFile() && item.name.endsWith(FILE_EXTENSIONS.document)) documentNames.push(item.name);
      else problems.push('Package contains unsupported files.');
    }
    const expectedLayout = `${name}${FILE_EXTENSIONS.canvas}`;
    if (layouts.length !== 1) problems.push(layouts.length === 0 ? 'Package is missing its layout file.' : 'Package contains more than one layout file.');
    else if (layouts[0] !== expectedLayout) problems.push('Package layout name does not match its folder.');

    const entry: VaultEntry = { path: relative, name, kind: 'canvas', children: [] };
    let canvas: CanvasFile | undefined;
    const layoutRelative = packageLayoutPath(relative);
    if (layouts.includes(expectedLayout)) {
      try {
        const raw = await fs.readFile(await resolve(layoutRelative), 'utf8');
        canvas = decodeCanvas(raw);
        baselines.set(layoutRelative, raw);
        if (canvas.title !== name) {
          problems.push('Canvas title does not match its package folder.');
        } else {
          entry.canvasId = canvas.id;
        }
      } catch (error) {
        const issue = operationFailure(error);
        problems.push(issue.message);
      }
    }
    const children: VaultEntry[] = [];
    const packageDocuments = new Set<string>();
    for (const documentName of documentNames.sort((a, b) => a.localeCompare(b))) {
      const child = await readDocumentEntry(`${relative}/${documentName}`, documentName);
      children.push(child);
      if (child.documentId && !child.error) packageDocuments.add(child.documentId);
    }
    entry.children = sortEntries(children);
    if (canvas && entry.canvasId && !packageDocumentIdsEqual(packageDocuments, canvas)) {
      problems.push('Package documents must match the board nodes exactly.');
    }
    if (problems.length || !canvas || !entry.canvasId) {
      Object.assign(entry, entryError(relative, problems[0] ?? 'This canvas package is invalid.'));
      invalidPackagePaths.add(relative);
      return entry;
    }
    const matches = canvasEntries.get(canvas.id) ?? [];
    matches.push(entry);
    canvasEntries.set(canvas.id, matches);
    canvases.set(relative, canvas);
    return entry;
  };

  const walk = async (folder: string): Promise<VaultEntry[]> => {
    const entries: VaultEntry[] = [];
    const files = await fs.readdir(await resolve(folder), { withFileTypes: true });
    for (const file of files) {
      if (file.name === '.yantra' || file.isSymbolicLink()) continue;
      const relative = folder ? `${folder}/${file.name}` : file.name;
      if (file.isDirectory()) {
        const absolute = await resolve(relative);
        const children = await fs.readdir(absolute, { withFileTypes: true });
        const packageCandidate = children.some((child) => !child.isSymbolicLink() && child.isFile() && child.name.endsWith(FILE_EXTENSIONS.canvas));
        entries.push(packageCandidate
          ? await classifyPackage(relative, file.name)
          : { path: relative, name: file.name, kind: 'folder', children: await walk(relative) });
      } else if (file.isFile() && file.name.endsWith(FILE_EXTENSIONS.document)) {
        entries.push(await readDocumentEntry(relative, file.name));
      } else if (file.isFile() && file.name.endsWith(FILE_EXTENSIONS.canvas)) {
        const entry: VaultEntry = {
          path: relative, name: file.name, kind: 'canvas',
          ...entryError(relative, folder
            ? 'A canvas layout must live inside a matching package folder.'
            : 'A canvas layout cannot live at the vault root.'),
        };
        entries.push(entry);
      }
    }
    return sortEntries(entries);
  };

  const entries = await walk('');
  for (const [id, matches] of documents) {
    if (matches.length !== 1) {
      for (const entry of matches) {
        entry.error = 'Duplicate document ID. These files have been left untouched.';
        entry.failure = { code: 'invalid-format', message: entry.error, path: entry.path };
      }
    } else if (!matches[0]!.error) {
      documentPaths.set(id, matches[0]!.path);
    }
  }
  for (const entry of [...canvasEntries.values()].flat()) {
    const children = entry.children ?? [];
    if (children.some((child) => child.error) || children.some((child) => child.documentId && !documentPaths.has(child.documentId))) {
      Object.assign(entry, entryError(entry.path, 'Duplicate document ID. These files have been left untouched.'));
      invalidPackagePaths.add(entry.path);
      if (entry.canvasId) {
        canvases.delete(entry.path);
        const remaining = (canvasEntries.get(entry.canvasId) ?? []).filter((candidate) => candidate !== entry);
        if (remaining.length) canvasEntries.set(entry.canvasId, remaining);
        else canvasEntries.delete(entry.canvasId);
      }
    }
  }
  for (const [id, matches] of canvasEntries) {
    if (matches.length !== 1) {
      for (const entry of matches) {
        Object.assign(entry, entryError(entry.path, 'Duplicate canvas ID. These files have been left untouched.'));
        invalidPackagePaths.add(entry.path);
        canvases.delete(entry.path);
      }
    } else if (!matches[0]!.error) {
      canvasPaths.set(id, matches[0]!.path);
    }
  }
  const placements: CanvasAppearance[] = [];
  for (const [canvasId, canvasPath] of canvasPaths) {
    for (const node of canvases.get(canvasPath)!.nodes) {
      placements.push({ canvasId, canvasPath, documentId: node.documentId, nodeId: node.id });
    }
  }
  return { documentPaths, canvasPaths, canvases, baselines, entries, appearances: placements, invalidPackagePaths };
}
