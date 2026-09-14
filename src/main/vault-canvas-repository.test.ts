import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultRepository } from './vault-repository';
import { newCanvas, type CanvasFile } from '../shared/vault-canvas';

function withDocument(canvas: CanvasFile, documentId: string): CanvasFile {
  const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId, x: 20, y: 30, width: 320, height: 220 };
  return { ...canvas, nodes: [node], layerOrder: [node.id] };
}

describe('vault canvas files', () => {
  let root: string;
  let repo: VaultRepository;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-canvases-'));
    repo = await VaultRepository.open(root, true);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('creates unique canvases and reopens document references from disk', async () => {
    const created = await Promise.all([repo.createCanvas(''), repo.createCanvas('')]);
    expect(new Set(created.map((item) => item.path)).size).toBe(2);
    const document = await repo.createNodeDocument();
    expect(document.path).toBe('Unfiled/Untitled.yantraD');
    const canvas = withDocument(created[0]!.canvas, document.document.id);
    await repo.saveCanvas(canvas);
    const reopened = await VaultRepository.open(root);
    const snapshot = await reopened.scan();
    expect(snapshot.entries.find((entry) => entry.path === created[0]!.path)?.canvasId).toBe(canvas.id);
    expect(await reopened.readCanvas(created[0]!.path)).toEqual(canvas);
    expect(await fs.readFile(path.join(root, created[0]!.path), 'utf8')).not.toContain('"doc":');
  });

  it('requires a durable document before saving a new reference', async () => {
    const created = await repo.createCanvas('');
    await expect(repo.saveCanvas(withDocument(created.canvas, crypto.randomUUID()))).rejects.toThrow('Save the document');
    expect((await repo.readCanvas(created.path)).nodes).toEqual([]);
  });

  it('serializes concurrent cross-canvas appearance claims', async () => {
    const document = await repo.createNodeDocument();
    const a = await repo.createCanvas('');
    const b = await repo.createCanvas('');
    const outcomes = await Promise.allSettled([
      repo.saveCanvas(withDocument(a.canvas, document.document.id)),
      repo.saveCanvas(withDocument(b.canvas, document.document.id)),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await repo.readCanvas(b.path)).nodes).toEqual([]);
  });

  it('preserves missing references during layout saves without recreating documents', async () => {
    const document = await repo.createNodeDocument();
    const created = await repo.createCanvas('');
    const canvas = withDocument(created.canvas, document.document.id);
    await repo.saveCanvas(canvas);
    await fs.unlink(path.join(root, document.path));
    const reopened = await VaultRepository.open(root);
    await reopened.scan();
    canvas.nodes[0]!.x = 200;
    await reopened.saveCanvas(canvas);
    expect((await reopened.readCanvas(created.path)).nodes).toEqual(canvas.nodes);
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
  });

  it('reports conflicting appearances and duplicate canvas IDs without rewriting files', async () => {
    const documentId = crypto.randomUUID();
    const a = withDocument(newCanvas('A'), documentId);
    const b = withDocument(newCanvas('B'), documentId);
    await fs.writeFile(path.join(root, 'A.yantraC'), JSON.stringify(a));
    await fs.writeFile(path.join(root, 'B.yantraC'), JSON.stringify(b));
    expect((await repo.scan()).entries.every((entry) => entry.error?.includes('more than one'))).toBe(true);
    await expect(repo.readCanvas('A.yantraC')).rejects.toThrow('ambiguous');
    await fs.writeFile(path.join(root, 'B.yantraC'), JSON.stringify({ ...b, id: a.id }));
    expect((await repo.scan()).entries.every((entry) => entry.error?.includes('Duplicate canvas'))).toBe(true);
    expect(await fs.readFile(path.join(root, 'A.yantraC'), 'utf8')).toBe(JSON.stringify(a));
  });

  it('rejects symlink Unfiled, invalid destinations, removed canvases, and unknown versions', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'Unfiled'));
    await expect(repo.createNodeDocument()).rejects.toThrow('Symbolic links');
    await expect(repo.createCanvas('../')).rejects.toThrow('Invalid vault path');
    await expect(repo.createCanvas('.yantra')).rejects.toThrow('Invalid vault path');
    const created = await repo.createCanvas('');
    await fs.unlink(path.join(root, created.path));
    await expect(repo.saveCanvas(created.canvas)).rejects.toThrow();
    await fs.writeFile(path.join(root, 'Future.yantraC'), JSON.stringify({ ...newCanvas('Future'), formatVersion: 99 }));
    expect((await repo.scan()).entries[0]?.error).toContain('Unsupported canvas');
  });
});
