import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newCanvas, type CanvasFile } from '../shared/vault-canvas';
import { newDocument, type DocumentFile } from '../shared/vault-format';
import { CANVAS_NODE_DEFAULT_HEIGHT, CANVAS_NODE_DEFAULT_WIDTH, packageLayoutPath } from '../shared/vault-packages';
import { scanVault } from './vault-scan';

async function writeJson(root: string, relative: string, value: DocumentFile | CanvasFile) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

describe('package scan', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-scan-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  function scan() {
    return scanVault(async (relative) => relative ? path.join(root, relative) : root);
  }

  it('classifies ordinary folders, standalone documents, and matching packages', async () => {
    await fs.mkdir(path.join(root, 'Research'));
    const note = newDocument('Standalone');
    await writeJson(root, 'Standalone.yantraD', note);
    const canvas = newCanvas('Planning');
    const goal = newDocument('Goals');
    canvas.nodes = [{
      id: crypto.randomUUID(), kind: 'document', documentId: goal.id,
      x: 0, y: 0, width: CANVAS_NODE_DEFAULT_WIDTH, height: CANVAS_NODE_DEFAULT_HEIGHT,
    }];
    canvas.layerOrder = [canvas.nodes[0]!.id];
    await writeJson(root, packageLayoutPath('Research/Planning'), canvas);
    await writeJson(root, 'Research/Planning/Goals.yantraD', goal);
    const snapshot = await scan();
    expect(snapshot.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ['folder', 'Research'],
      ['document', 'Standalone.yantraD'],
    ]);
    const pack = snapshot.entries[0]!.children![0]!;
    expect(pack).toMatchObject({ kind: 'canvas', path: 'Research/Planning', name: 'Planning', canvasId: canvas.id });
    expect(pack.children).toEqual([expect.objectContaining({ kind: 'document', path: 'Research/Planning/Goals.yantraD', documentId: goal.id })]);
    expect(snapshot.canvasPaths.get(canvas.id)).toBe('Research/Planning');
    expect(snapshot.documentPaths.get(goal.id)).toBe('Research/Planning/Goals.yantraD');
    expect(snapshot.appearances).toEqual([expect.objectContaining({
      canvasId: canvas.id, canvasPath: 'Research/Planning', documentId: goal.id,
    })]);
  });

  it('treats Unfiled as an ordinary folder name', async () => {
    await fs.mkdir(path.join(root, 'Unfiled'));
    const document = newDocument('Draft');
    await writeJson(root, 'Unfiled/Draft.yantraD', document);
    const snapshot = await scan();
    expect(snapshot.entries[0]).toMatchObject({ kind: 'folder', path: 'Unfiled', name: 'Unfiled' });
    expect(snapshot.entries[0]!.children?.[0]).toMatchObject({ kind: 'document', documentId: document.id });
  });

  it('rejects a layout at the vault root and a mismatched package name', async () => {
    await writeJson(root, 'Loose.yantraC', newCanvas('Loose'));
    const canvas = { ...newCanvas('Planning'), title: 'Planning' };
    await writeJson(root, 'Goals/Planning.yantraC', canvas);
    const snapshot = await scan();
    expect(snapshot.entries.find((entry) => entry.path === 'Loose.yantraC')?.error).toMatch(/root/i);
    expect(snapshot.entries.find((entry) => entry.path === 'Goals')?.error).toMatch(/match/i);
    expect(snapshot.canvasPaths.size).toBe(0);
  });

  it('invalidates packages with extra layouts, nested folders, unknown files, or membership drift', async () => {
    const extra = newCanvas('Board');
    await writeJson(root, 'Board/Board.yantraC', extra);
    await writeJson(root, 'Board/Other.yantraC', newCanvas('Other'));
    await writeJson(root, 'Nested/Nested.yantraC', newCanvas('Nested'));
    await fs.mkdir(path.join(root, 'Nested/Child'));
    const drifted = newCanvas('Drift');
    drifted.nodes = [{
      id: crypto.randomUUID(), kind: 'document', documentId: crypto.randomUUID(),
      x: 0, y: 0, width: CANVAS_NODE_DEFAULT_WIDTH, height: CANVAS_NODE_DEFAULT_HEIGHT,
    }];
    drifted.layerOrder = [drifted.nodes[0]!.id];
    await writeJson(root, 'Drift/Drift.yantraC', drifted);
    await writeJson(root, 'Drift/Extra.yantraD', newDocument('Extra'));
    await writeJson(root, 'Strange/Strange.yantraC', newCanvas('Strange'));
    await fs.writeFile(path.join(root, 'Strange', 'notes.txt'), 'nope');
    await writeJson(root, 'Store/Store.yantraC', newCanvas('Store'));
    await fs.writeFile(path.join(root, 'Store', '.DS_Store'), 'ok');
    const snapshot = await scan();
    expect(snapshot.entries.find((entry) => entry.path === 'Board')?.error).toBeDefined();
    expect(snapshot.entries.find((entry) => entry.path === 'Nested')?.error).toBeDefined();
    expect(snapshot.entries.find((entry) => entry.path === 'Drift')?.error).toBeDefined();
    expect(snapshot.entries.find((entry) => entry.path === 'Strange')?.error).toBeDefined();
    const store = snapshot.entries.find((entry) => entry.path === 'Store');
    expect(store).toMatchObject({ kind: 'canvas', path: 'Store', canvasId: expect.any(String) });
    expect(store?.error).toBeUndefined();
    expect(snapshot.canvasPaths.size).toBe(1);
  });

  it('does not follow symlinks and reports them as invalid package contents', async () => {
    await writeJson(root, 'Linked/Linked.yantraC', newCanvas('Linked'));
    await fs.symlink(os.tmpdir(), path.join(root, 'Linked', 'out'));
    const snapshot = await scan();
    expect(snapshot.entries.find((entry) => entry.path === 'Linked')?.error).toMatch(/symbolic/i);
    expect(snapshot.canvasPaths.size).toBe(0);
  });

  it('invalidates duplicate document IDs without assigning replacements', async () => {
    const document = newDocument('One');
    await writeJson(root, 'One.yantraD', document);
    await writeJson(root, 'Two.yantraD', { ...document, title: 'Two' });
    const snapshot = await scan();
    expect(snapshot.entries.every((entry) => entry.error?.includes('Duplicate'))).toBe(true);
    expect(snapshot.documentPaths.size).toBe(0);
  });
});
