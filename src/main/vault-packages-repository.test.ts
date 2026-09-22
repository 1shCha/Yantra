import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageDocumentIdsEqual, packageLayoutPath } from '../shared/vault-packages';
import { VaultRepository } from './vault-repository';

describe('strict canvas packages', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-package-')); });
  afterEach(async () => {
    VaultRepository.failNextPackageLayoutWrite = false;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a version-1 vault without modifying it', async () => {
    const metadata = { formatVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    await fs.mkdir(path.join(root, '.yantra'));
    const raw = `${JSON.stringify(metadata, null, 2)}\n`;
    await fs.writeFile(path.join(root, '.yantra', 'vault.json'), raw);
    await fs.writeFile(path.join(root, 'keep.txt'), 'untouched');
    await expect(VaultRepository.open(root)).rejects.toMatchObject({ failure: { code: 'unsupported-format' } });
    expect(await fs.readFile(path.join(root, '.yantra', 'vault.json'), 'utf8')).toBe(raw);
    expect(await fs.readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('untouched');
  });

  it('creates a named package and a matching document node', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const created = await repo.createCanvas('');
    expect(created.path).toBe('Untitled');
    expect(await fs.readFile(path.join(root, packageLayoutPath(created.path)), 'utf8')).toContain(created.canvas.id);
    const note = await repo.createDocument(created.path, { x: 200, y: 200 });
    expect(note.path).toBe('Untitled/Untitled.yantraD');
    expect(note.canvas?.nodes).toHaveLength(1);
    expect(note.canvas?.nodes[0]).toMatchObject({ documentId: note.document.id, x: 90, y: 163 });
    expect(note.nodeId).toBe(note.canvas?.nodes[0]?.id);
    const snapshot = await repo.scan();
    expect(snapshot.entries[0]).toMatchObject({ kind: 'canvas', path: 'Untitled', canvasId: created.canvas.id });
    expect(snapshot.entries[0]?.children?.[0]).toMatchObject({ documentId: note.document.id });
    await expect(repo.saveCanvas({ ...note.canvas!, nodes: [], layerOrder: [] })).rejects.toThrow('membership');
  });

  it('preserves the new document and marks the package unavailable if layout save fails', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const created = await repo.createCanvas('');
    VaultRepository.failNextPackageLayoutWrite = true;
    await expect(repo.createDocument(created.path)).rejects.toThrow('Layout write failed');
    expect(await fs.readFile(path.join(root, 'Untitled/Untitled.yantraD'), 'utf8')).toContain('"title": "Untitled"');
    await expect(repo.saveCanvas(created.canvas)).rejects.toThrow('unavailable');
    const reopened = await VaultRepository.open(root);
    const snapshot = await reopened.scan();
    expect(snapshot.entries[0]?.error).toBeDefined();
    expect(snapshot.appearances).toEqual([]);
  });

  it('renames a package directory, layout file, and title together', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const pack = await repo.createCanvas('');
    const note = await repo.createDocument(pack.path);
    const renamed = await repo.renameEntry(pack.path, 'Map');
    expect(renamed.to).toBe('Map');
    expect(renamed.canvas?.id).toBe(pack.canvas.id);
    expect(renamed.canvas?.title).toBe('Map');
    expect((await repo.readCanvas('Map')).id).toBe(pack.canvas.id);
    expect((await repo.readCanvas('Map')).title).toBe('Map');
    expect((await repo.readDocument('Map/Untitled.yantraD')).id).toBe(note.document.id);
    expect(await fs.readFile(path.join(root, packageLayoutPath('Map')), 'utf8')).toContain('"title": "Map"');
    await expect(fs.stat(path.join(root, 'Untitled'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'Untitled/Untitled.yantraC'))).rejects.toThrow();
    const snapshot = await repo.scan();
    expect(snapshot.entries[0]).toMatchObject({ kind: 'canvas', path: 'Map', canvasId: pack.canvas.id });
    expect(snapshot.entries[0]?.error).toBeUndefined();
    expect(snapshot.entries[0]?.children?.[0]).toMatchObject({ documentId: note.document.id, path: 'Map/Untitled.yantraD' });
  });

  it('moves a package into an ordinary folder without renaming the layout', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    await repo.createFolder('', 'Research');
    const pack = await repo.createCanvas('');
    const note = await repo.createDocument(pack.path);
    const moved = await repo.moveEntry(pack.path, 'Research');
    expect(moved.to).toBe('Research/Untitled');
    expect(moved.canvas).toBeUndefined();
    expect((await repo.readCanvas('Research/Untitled')).id).toBe(pack.canvas.id);
    expect((await repo.readCanvas('Research/Untitled')).title).toBe('Untitled');
    expect((await repo.readDocument('Research/Untitled/Untitled.yantraD')).id).toBe(note.document.id);
    expect(await fs.readFile(path.join(root, packageLayoutPath('Research/Untitled')), 'utf8')).toContain('"title": "Untitled"');
    await expect(fs.stat(path.join(root, 'Untitled'))).rejects.toThrow();
  });

  it('moves document membership between ordinary folders and packages', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    await repo.createFolder('', 'Research');
    const pack = await repo.createCanvas('Research');
    const other = await repo.createCanvas('');
    const standalone = await repo.createDocument('');
    await repo.renameEntry(standalone.path, 'Loose');
    const note = await repo.createDocument(pack.path);
    const intoPackage = await repo.moveEntry('Loose.yantraD', pack.path);
    expect(intoPackage.to).toBe(`${pack.path}/Loose.yantraD`);
    expect((await repo.readDocument(intoPackage.to)).id).toBe(standalone.document.id);
    const packCanvas = await repo.readCanvas(pack.path);
    expect(packCanvas.nodes.some((node) => node.documentId === standalone.document.id)).toBe(true);
    const outOfPackage = await repo.moveEntry(note.path, '');
    expect(outOfPackage.to).toBe(path.basename(note.path));
    expect((await repo.readCanvas(pack.path)).nodes.some((node) => node.documentId === note.document.id)).toBe(false);
    const betweenPackages = await repo.moveEntry(intoPackage.to, other.path);
    expect(betweenPackages.to).toBe(`${other.path}/${path.basename(intoPackage.to)}`);
    expect((await repo.readCanvas(pack.path)).nodes.some((node) => node.documentId === standalone.document.id)).toBe(false);
    expect((await repo.readCanvas(other.path)).nodes.some((node) => node.documentId === standalone.document.id)).toBe(true);
    const snapshot = await repo.scan();
    const sourceEntry = snapshot.entries.flatMap((entry) => [entry, ...(entry.children ?? [])]).find((entry) => entry.path === betweenPackages.to);
    const destBoard = snapshot.entries.find((entry) => entry.path === other.path);
    expect(sourceEntry?.documentId).toBe(standalone.document.id);
    expect(destBoard && packageDocumentIdsEqual(
      new Set((destBoard.children ?? []).flatMap((child) => child.documentId ? [child.documentId] : [])),
      await repo.readCanvas(other.path),
    )).toBe(true);
  });

  it('rolls back a membership move when the destination layout write fails', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const pack = await repo.createCanvas('');
    const standalone = await repo.createDocument('');
    VaultRepository.failNextPackageLayoutWrite = true;
    await repo.renameEntry(standalone.path, 'Loose');
    await expect(repo.moveEntry('Loose.yantraD', pack.path)).rejects.toThrow('Layout write failed');
    expect(await fs.readFile(path.join(root, 'Loose.yantraD'), 'utf8')).toContain(standalone.document.id);
    expect((await repo.readCanvas(pack.path)).nodes).toHaveLength(0);
  });

  it('still rejects hidden layout organize, nesting, and non-document moves into packages', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    await repo.createFolder('', 'Research');
    const pack = await repo.createCanvas('Research');
    await repo.createDocument(pack.path);
    await expect(repo.renameEntry(packageLayoutPath(pack.path), 'Map')).rejects.toThrow('hidden layout');
    await expect(repo.moveEntry(packageLayoutPath(pack.path), '')).rejects.toThrow('hidden layout');
    await expect(repo.createFolder(pack.path, 'Nested')).rejects.toThrow('ordinary folder');
    await expect(repo.createCanvas(pack.path)).rejects.toThrow('ordinary folder');
    await expect(repo.moveEntry('Research', pack.path)).rejects.toThrow('not supported');
    await repo.createFolder('', 'Projects');
    const moved = await repo.moveEntry('Research', 'Projects');
    expect(moved.to).toBe('Projects/Research');
    expect((await repo.readCanvas('Projects/Research/Untitled')).id).toBe(pack.canvas.id);
  });

  it('rejects organizing an invalid package and keeps membership locked', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const pack = await repo.createCanvas('');
    VaultRepository.failNextPackageLayoutWrite = true;
    await expect(repo.createDocument(pack.path)).rejects.toThrow('Layout write failed');
    await expect(repo.renameEntry(pack.path, 'Map')).rejects.toThrow('unavailable');
    await expect(repo.moveEntry(pack.path, '')).rejects.toThrow('unavailable');
    expect((await repo.scan()).entries[0]).toMatchObject({ path: 'Untitled', error: expect.any(String) });
  });

  it('keeps the relocated package path and marks it unavailable if layout rename fails', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const pack = await repo.createCanvas('');
    VaultRepository.failNextPackageLayoutWrite = true;
    const renamed = await repo.renameEntry(pack.path, 'Map');
    expect(renamed.to).toBe('Map');
    expect(renamed.warning).toMatch(/layout could not be renamed/i);
    await expect(repo.saveCanvas(pack.canvas)).rejects.toThrow('unavailable');
    expect((await repo.scan()).entries[0]).toMatchObject({ path: 'Map', error: expect.any(String) });
    expect(await fs.readFile(path.join(root, 'Map/Untitled.yantraC'), 'utf8')).toContain(pack.canvas.id);
  });

  it('allows same-folder reorder and document rename inside a package', async () => {
    const repo = await VaultRepository.open(root, true);
    await repo.scan();
    const first = await repo.createCanvas('');
    const second = await repo.createCanvas('');
    expect((await repo.moveEntry(second.path, '', { anchor: first.path, side: 'before' })).sidebarOrder)
      .toEqual([second.path, first.path]);
    const note = await repo.createDocument(first.path);
    const renamed = await repo.renameEntry(note.path, 'Goals');
    expect(renamed.to).toBe('Untitled/Goals.yantraD');
    expect((await repo.readDocument(renamed.to)).id).toBe(note.document.id);
    expect((await repo.readCanvas(first.path)).nodes[0]?.documentId).toBe(note.document.id);
  });
});
