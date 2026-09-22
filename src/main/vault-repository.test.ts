import { tiptapDocSchema } from '../shared/tiptap-document';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultRepository } from './vault-repository';
import { decodeDocument, newDocument } from '../shared/vault-format';
import { tiptapDocFromPlainText } from '../shared/tiptap-document';

describe('VaultRepository', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-vault-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('creates a versioned vault without touching legacy canvas data', async () => {
    await fs.writeFile(path.join(root, 'default.canvas'), 'legacy data');
    const repo = await VaultRepository.open(root, true);
    const snapshot = await repo.scan();
    expect(snapshot.metadata.formatVersion).toBe(2);
    expect(snapshot.entries).toEqual([]);
    expect(await fs.readFile(path.join(root, 'default.canvas'), 'utf8')).toBe('legacy data');
    await expect(VaultRepository.open(root, true)).rejects.toThrow();
    expect((await VaultRepository.open(root)).metadata.id).toBe(repo.metadata.id);
  });

  it('creates independent unique files, saves, and reopens them from disk', async () => {
    const repo = await VaultRepository.open(root, true);
    await fs.mkdir(path.join(root, 'Research'));
    await repo.scan();
    const first = await repo.createDocument('Research');
    const second = await repo.createDocument('Research');
    expect(first.document.id).not.toBe(second.document.id);
    expect([first.path, second.path]).toEqual(['Research/Untitled.yantraD', 'Research/Untitled_2.yantraD']);
    first.document.doc = tiptapDocSchema.parse(tiptapDocFromPlainText('Persisted notes'));
    await repo.saveDocument(first.document);
    const reopened = await VaultRepository.open(root);
    expect((await reopened.scan()).entries[0]?.children).toHaveLength(2);
    expect((await reopened.readDocument(first.path)).doc).toEqual(first.document.doc);
    expect(decodeDocument(await fs.readFile(path.join(root, first.path), 'utf8')).id).toBe(first.document.id);
  });

  it('reserves names without overwriting during concurrent creation', async () => {
    const repo = await VaultRepository.open(root, true);
    const documents = await Promise.all([repo.createDocument(''), repo.createDocument(''), repo.createDocument('')]);
    expect(new Set(documents.map((item) => item.path)).size).toBe(3);
    expect(new Set(documents.map((item) => item.document.id)).size).toBe(3);
  });

  it('lists unsupported and malformed files while leaving their bytes untouched', async () => {
    const repo = await VaultRepository.open(root, true);
    const future = JSON.stringify({ ...newDocument('Future'), formatVersion: 99 });
    await fs.writeFile(path.join(root, 'Future.yantraD'), future);
    await fs.writeFile(path.join(root, 'Broken.yantraD'), '{broken');
    const snapshot = await repo.scan();
    expect(snapshot.entries.every((entry) => Boolean(entry.error))).toBe(true);
    expect(snapshot.entries.find((entry) => entry.name.startsWith('Future'))?.error).toContain('Unsupported');
    expect(await fs.readFile(path.join(root, 'Future.yantraD'), 'utf8')).toBe(future);
  });

  it('rejects ambiguous duplicate IDs for both reading and saving', async () => {
    const repo = await VaultRepository.open(root, true);
    const document = newDocument('One');
    await fs.writeFile(path.join(root, 'One.yantraD'), JSON.stringify(document));
    await fs.writeFile(path.join(root, 'Two.yantraD'), JSON.stringify({ ...document, title: 'Two' }));
    expect((await repo.scan()).entries.every((entry) => entry.error?.includes('Duplicate'))).toBe(true);
    await expect(repo.readDocument('One.yantraD')).rejects.toThrow('ambiguous');
    await expect(repo.saveDocument(document)).rejects.toThrow('not registered');
  });

  it('rejects traversal, metadata paths, and symlink destinations', async () => {
    const repo = await VaultRepository.open(root, true);
    await expect(repo.createDocument('../')).rejects.toThrow('Invalid vault path');
    await expect(repo.createDocument('.yantra')).rejects.toThrow('Invalid vault path');
    await expect(repo.createDocument(root)).rejects.toThrow('Invalid vault path');
    await fs.symlink(os.tmpdir(), path.join(root, 'Shortcut'));
    await expect(repo.createDocument('Shortcut')).rejects.toThrow('Symbolic links');
    expect((await repo.scan()).entries).toEqual([]);
  });

  it('does not recreate a file removed outside the app during this session', async () => {
    const repo = await VaultRepository.open(root, true);
    const result = await repo.createDocument('');
    await fs.unlink(path.join(root, result.path));
    await expect(repo.saveDocument(result.document)).rejects.toThrow();
    await expect(fs.stat(path.join(root, result.path))).rejects.toThrow();
  });

  it.each(['scan', 'refresh'] as const)('keeps documents and canvases registered after a failed %s', async (operation) => {
    const repo = await VaultRepository.open(root, true);
    const document = await repo.createDocument('');
    const canvas = await repo.createCanvas('');
    const unavailable = `${root}-unavailable`;
    await fs.rename(root, unavailable);
    try {
      await expect(repo[operation]()).rejects.toThrow();
    } finally {
      await fs.rename(unavailable, root);
    }
    const draft = { ...document.document, doc: tiptapDocSchema.parse(tiptapDocFromPlainText('After failed scan')) };
    await repo.saveDocument(draft);
    await repo.saveCanvas({ ...canvas.canvas, viewport: { x: 40, y: 50, zoom: 0.75 } });
    expect((await repo.readDocument(document.path)).doc).toEqual(draft.doc);
    expect((await repo.readCanvas(canvas.path)).viewport).toEqual({ x: 40, y: 50, zoom: 0.75 });
  });

  it.each(['scan', 'refresh'] as const)('preserves conflict baselines after a failed %s', async (operation) => {
    const repo = await VaultRepository.open(root, true);
    const document = await repo.createDocument('');
    const canvas = await repo.createCanvas('');
    const unavailable = `${root}-unavailable`;
    await fs.rename(root, unavailable);
    try {
      await expect(repo[operation]()).rejects.toThrow();
    } finally {
      await fs.rename(unavailable, root);
    }
    const externalDocument = JSON.stringify({ ...document.document, doc: tiptapDocFromPlainText('External edit') });
    const externalCanvas = JSON.stringify({ ...canvas.canvas, viewport: { x: 80, y: 90, zoom: 1 } });
    await fs.writeFile(path.join(root, document.path), externalDocument);
    await fs.writeFile(path.join(root, `${canvas.path}/${canvas.canvas.title}.yantraC`), externalCanvas);
    await expect(repo.saveDocument(document.document)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await expect(repo.saveCanvas(canvas.canvas)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    expect(await fs.readFile(path.join(root, document.path), 'utf8')).toBe(externalDocument);
    expect(await fs.readFile(path.join(root, `${canvas.path}/${canvas.canvas.title}.yantraC`), 'utf8')).toBe(externalCanvas);
  });

  it('accepts new disk baselines only after a successful refresh, not an ordinary scan', async () => {
    const repo = await VaultRepository.open(root, true);
    const created = await repo.createDocument('');
    const external = { ...created.document, doc: tiptapDocSchema.parse(tiptapDocFromPlainText('External edit')) };
    await fs.writeFile(path.join(root, created.path), JSON.stringify(external));
    await repo.scan();
    await expect(repo.saveDocument(external)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    const added = newDocument('Added');
    await fs.writeFile(path.join(root, 'Added.yantraD'), JSON.stringify(added));
    const snapshot = await repo.refresh();
    expect(snapshot.entries.find((entry) => entry.path === 'Added.yantraD')?.documentId).toBe(added.id);
    await repo.saveDocument(external);
    expect((await repo.readDocument(created.path)).doc).toEqual(external.doc);
  });

  it('inspection reads cannot silently accept external document or canvas changes', async () => {
    const repo = await VaultRepository.open(root, true);
    const document = await repo.createDocument('');
    const canvas = await repo.createCanvas('');
    const externalDoc = { ...document.document, doc: tiptapDocSchema.parse(tiptapDocFromPlainText('External text')) };
    const externalCanvas = { ...canvas.canvas, viewport: { x: 123, y: 456, zoom: 0.5 } };
    await fs.writeFile(path.join(root, document.path), JSON.stringify(externalDoc));
    await fs.writeFile(path.join(root, `${canvas.path}/${canvas.canvas.title}.yantraC`), JSON.stringify(externalCanvas));
    expect(await repo.readDocument(document.path)).toEqual(externalDoc);
    expect(await repo.readCanvas(canvas.path)).toEqual(externalCanvas);
    await expect(repo.saveDocument(document.document)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await expect(repo.saveCanvas(canvas.canvas)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await repo.readDocument(document.path, 'accept-disk');
    await repo.readCanvas(canvas.path, 'accept-disk');
    await repo.saveDocument(externalDoc);
    await repo.saveCanvas(externalCanvas);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('keeps the prior index and baselines when a subfolder cannot be scanned', async () => {
    const repo = await VaultRepository.open(root, true);
    const document = await repo.createDocument('');
    const canvas = await repo.createCanvas('');
    const blocked = path.join(root, 'Blocked');
    await fs.mkdir(blocked);
    await fs.writeFile(path.join(root, document.path), JSON.stringify({ ...document.document, doc: tiptapDocFromPlainText('External edit') }));
    await fs.chmod(blocked, 0o000);
    try {
      await expect(repo.refresh()).rejects.toThrow();
    } finally {
      await fs.chmod(blocked, 0o700);
    }
    await repo.saveCanvas(canvas.canvas);
    await expect(repo.saveDocument(document.document)).rejects.toMatchObject({ failure: { code: 'conflict' } });
    expect((await repo.refresh()).entries.some((entry) => entry.path === 'Blocked')).toBe(true);
  });
});
