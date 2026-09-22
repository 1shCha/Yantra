import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageLayoutPath } from '../shared/vault-packages';
import { VaultRepository } from './vault-repository';
import { newCanvas } from '../shared/vault-canvas';

describe('vault canvas files', () => {
  let root: string;
  let repo: VaultRepository;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-canvases-'));
    repo = await VaultRepository.open(root, true);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('creates unique packages and reopens document references from disk', async () => {
    const created = await Promise.all([repo.createCanvas(''), repo.createCanvas('')]);
    expect(new Set(created.map((item) => item.path)).size).toBe(2);
    const document = await repo.createDocument(created[0]!.path, { x: 130, y: 67.5 });
    expect(document.path).toBe(`${created[0]!.path}/Untitled.yantraD`);
    expect(document.canvas?.nodes[0]).toMatchObject({ documentId: document.document.id, x: 20, y: 30 });
    const reopened = await VaultRepository.open(root);
    const snapshot = await reopened.scan();
    expect(snapshot.entries.find((entry) => entry.path === created[0]!.path)?.canvasId).toBe(created[0]!.canvas.id);
    expect(await reopened.readCanvas(created[0]!.path)).toEqual(document.canvas);
    expect(await fs.readFile(path.join(root, packageLayoutPath(created[0]!.path)), 'utf8')).not.toContain('"doc":');
  });

  it('rejects layout saves that add a new document reference', async () => {
    const created = await repo.createCanvas('');
    const extra = { id: crypto.randomUUID(), kind: 'document' as const, documentId: crypto.randomUUID(), x: 20, y: 30, width: 320, height: 220 };
    await expect(repo.saveCanvas({
      ...created.canvas,
      nodes: [extra],
      layerOrder: [extra.id],
    })).rejects.toThrow('membership');
    expect((await repo.readCanvas(created.path)).nodes).toEqual([]);
  });

  it('rejects placing the same document onto another package through a layout save', async () => {
    const a = await repo.createCanvas('');
    const b = await repo.createCanvas('');
    const document = await repo.createDocument(a.path);
    const stolen = {
      ...b.canvas,
      nodes: document.canvas!.nodes,
      layerOrder: document.canvas!.layerOrder,
    };
    await expect(repo.saveCanvas(stolen)).rejects.toThrow('membership');
    expect((await repo.readCanvas(b.path)).nodes).toEqual([]);
    expect((await repo.readCanvas(a.path)).nodes).toHaveLength(1);
  });

  it('marks a package unavailable when a document file disappears, without recreating it', async () => {
    const created = await repo.createCanvas('');
    const document = await repo.createDocument(created.path);
    await fs.unlink(path.join(root, document.path));
    const reopened = await VaultRepository.open(root);
    const snapshot = await reopened.scan();
    expect(snapshot.entries.find((entry) => entry.path === created.path)?.error).toBeDefined();
    await expect(reopened.saveCanvas(document.canvas!)).rejects.toThrow();
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
  });

  it('reports loose layouts and duplicate package IDs without rewriting files', async () => {
    const a = newCanvas('A');
    const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId: crypto.randomUUID(), x: 0, y: 0, width: 220, height: 75 };
    const b = { ...newCanvas('B'), nodes: [node], layerOrder: [node.id] };
    await fs.writeFile(path.join(root, 'A.yantraC'), JSON.stringify(a));
    await fs.writeFile(path.join(root, 'B.yantraC'), JSON.stringify(b));
    const loose = await repo.scan();
    expect(loose.entries.every((entry) => entry.error)).toBe(true);
    await expect(repo.readCanvas('A.yantraC')).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'A.yantraC'), 'utf8')).toBe(JSON.stringify(a));
    await fs.mkdir(path.join(root, 'First'));
    await fs.mkdir(path.join(root, 'Second'));
    await fs.writeFile(path.join(root, 'First/First.yantraC'), JSON.stringify({ ...a, title: 'First' }));
    await fs.writeFile(path.join(root, 'Second/Second.yantraC'), JSON.stringify({ ...a, title: 'Second' }));
    await fs.unlink(path.join(root, 'A.yantraC'));
    await fs.unlink(path.join(root, 'B.yantraC'));
    const duplicates = await repo.scan();
    expect(duplicates.entries.every((entry) => entry.error?.includes('Duplicate canvas'))).toBe(true);
    expect(await fs.readFile(path.join(root, 'First/First.yantraC'), 'utf8')).toBe(JSON.stringify({ ...a, title: 'First' }));
  });

  it('rejects invalid destinations, removed packages, and unknown versions', async () => {
    await expect(repo.createCanvas('../')).rejects.toThrow('Invalid vault path');
    await expect(repo.createCanvas('.yantra')).rejects.toThrow('Invalid vault path');
    const created = await repo.createCanvas('');
    await fs.rm(path.join(root, created.path), { recursive: true, force: true });
    await expect(repo.saveCanvas(created.canvas)).rejects.toThrow();
    await fs.mkdir(path.join(root, 'Future'));
    await fs.writeFile(path.join(root, 'Future/Future.yantraC'), JSON.stringify({ ...newCanvas('Future'), formatVersion: 99 }));
    expect((await repo.scan()).entries.find((entry) => entry.path === 'Future')?.error).toContain('Unsupported canvas');
  });
});
