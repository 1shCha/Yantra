import { FILE_EXTENSIONS } from '../shared/vault-paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeDocument, type VaultEntry } from '../shared/vault-format';
import { decodeCanvas, type CanvasFile } from '../shared/vault-canvas';
import { OperationError, operationFailure } from '../shared/operation-result';
import type { CanvasAppearance } from '../shared/vault-organization';

// Build a replacement index without touching the active repository or baselines.
export async function scanVault(resolve: (relative: string) => Promise<string>) {
  // Keep the active index and conflict baselines intact until the entire scan succeeds.
  const documentPaths = new Map<string, string>();
  const canvasPaths = new Map<string, string>();
  const canvases = new Map<string, CanvasFile>();
  const baselines = new Map<string, string>();
  const documents = new Map<string, VaultEntry[]>();
  const canvasEntries = new Map<string, VaultEntry[]>();
  const walk = async (folder: string): Promise<VaultEntry[]> => {
    const entries: VaultEntry[] = [];
    const files = await fs.readdir(await resolve(folder), { withFileTypes: true });
    for (const file of files) {
      if (file.name === '.yantra' || file.isSymbolicLink()) continue;
      const relative = folder ? `${folder}/${file.name}` : file.name;
      if (file.isDirectory()) {
        entries.push({ path: relative, name: file.name, kind: 'folder', children: await walk(relative) });
      } else if (file.isFile() && file.name.endsWith(FILE_EXTENSIONS.document)) {
        const entry: VaultEntry = { path: relative, name: file.name, kind: 'document' };
        try {
          const raw = await fs.readFile(await resolve(relative), 'utf8');
          const document = decodeDocument(raw);
          baselines.set(relative, raw);
          if (document.title !== path.basename(relative, FILE_EXTENSIONS.document)) throw new OperationError({ code: 'invalid-input', message: 'Document title does not match its filename.' });
          entry.documentId = document.id;
          const matches = documents.get(document.id) ?? [];
          matches.push(entry);
          documents.set(document.id, matches);
        } catch (error) {
          entry.failure = operationFailure(error);
          entry.error = entry.failure.message;
        }
        entries.push(entry);
      } else if (file.isFile() && file.name.endsWith(FILE_EXTENSIONS.canvas)) {
        const entry: VaultEntry = { path: relative, name: file.name, kind: 'canvas' };
        try {
          const raw = await fs.readFile(await resolve(relative), 'utf8');
          const canvas = decodeCanvas(raw);
          baselines.set(relative, raw);
          if (canvas.title !== path.basename(relative, FILE_EXTENSIONS.canvas)) throw new OperationError({ code: 'invalid-input', message: 'Canvas title does not match its filename.' });
          entry.canvasId = canvas.id;
          const matches = canvasEntries.get(canvas.id) ?? [];
          matches.push(entry);
          canvasEntries.set(canvas.id, matches);
          canvases.set(relative, canvas);
        } catch (error) {
          entry.failure = operationFailure(error);
          entry.error = entry.failure.message;
        }
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  };
  const entries = await walk('');
  for (const [id, matches] of documents) {
    if (matches.length !== 1) {
      for (const entry of matches) {
        entry.error = 'Duplicate document ID. These files have been left untouched.';
        entry.failure = { code: 'invalid-format', message: entry.error, path: entry.path };
      }
    } else {
      const entry = matches[0]!;
      documentPaths.set(id, entry.path);
    }
  }
  const appearances = new Map<string, Set<string>>();
  for (const [relative, canvas] of canvases) {
    for (const node of canvas.nodes) {
      const owners = appearances.get(node.documentId) ?? new Set<string>();
      owners.add(relative);
      appearances.set(node.documentId, owners);
    }
  }
  for (const [id, matches] of canvasEntries) {
    const canvas = canvases.get(matches[0]!.path)!;
    const duplicateAppearance = canvas.nodes.some((node) => (appearances.get(node.documentId)?.size ?? 0) > 1);
    if (matches.length !== 1 || duplicateAppearance) {
      for (const entry of matches) {
        entry.error = matches.length !== 1 ? 'Duplicate canvas ID. These files have been left untouched.'
          : 'A document appears on more than one canvas. These files have been left untouched.';
        entry.failure = { code: 'invalid-format', message: entry.error, path: entry.path };
      }
    } else {
      canvasPaths.set(id, matches[0]!.path);
    }
  }
  const placements: CanvasAppearance[] = [];
  for (const [canvasId, canvasPath] of canvasPaths) {
    for (const node of canvases.get(canvasPath)!.nodes) placements.push({ canvasId, canvasPath, documentId: node.documentId, nodeId: node.id });
  }
  return { documentPaths, canvasPaths, canvases, baselines, entries, appearances: placements };
}
