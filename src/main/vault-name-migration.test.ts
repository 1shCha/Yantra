import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultRepository } from './vault-repository';
import { newDocument } from '../shared/vault-format';
import { newCanvas } from '../shared/vault-canvas';
import { vaultNameSchema } from '../shared/vault-organization';

describe('vault names and migration', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-migration-'));
    await VaultRepository.open(root, true);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('enforces the same allowed names for file factories and folder operations', async () => {
    const repo = await VaultRepository.open(root);
    for (const title of ['A B', ' A', 'B ', 'a.b', 'a/b', 'a\\b', 'a+b', 'a\nb', 'A\n', 'café', '']) {
      expect(vaultNameSchema.safeParse(title).success).toBe(false);
      expect(() => newDocument(title)).toThrow();
      expect(() => newCanvas(title)).toThrow();
      expect(() => repo.createFolder('', title)).toThrow();
    }
    for (const title of ['Notes_2026-v2', 'ABC', '123', '_draft', '-draft']) {
      expect(newDocument(title).title).toBe(title);
      expect(newCanvas(title).title).toBe(title);
    }
  });

  it('migrates nested names and extensions, preserving content, IDs and canvas references', async () => {
    await fs.mkdir(path.join(root, 'My notes'));
    const document = { ...newDocument('Draft'), title: 'First draft' };
    const canvas = { ...newCanvas('Map'), title: 'My map' };
    const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId: document.id, x: 10, y: 20, width: 300, height: 200 };
    canvas.nodes.push(node);
    canvas.layerOrder.push(node.id);
    const original = JSON.stringify(document);
    await fs.writeFile(path.join(root, 'My notes/First draft.yantra_doc'), original);
    await fs.writeFile(path.join(root, 'My map.yantra_canvas'), JSON.stringify(canvas));
    const repo = await VaultRepository.open(root);
    const snapshot = await repo.scan();
    expect(await repo.readDocument('My_notes/First_draft.yantraD')).toEqual({ ...document, title: 'First_draft' });
    expect(await repo.readCanvas('My_map.yantraC')).toEqual({ ...canvas, title: 'My_map' });
    expect(snapshot.appearances[0]?.documentId).toBe(document.id);
    const backup = (await fs.readdir(path.join(root, '.yantra'))).find((name) => name.startsWith('name-migration-backup-'))!;
    const saved = JSON.parse(await fs.readFile(path.join(root, '.yantra', backup), 'utf8'));
    expect(saved.operations.some((op: { original?: string }) => op.original === original)).toBe(true);
    await VaultRepository.open(root);
    expect((await fs.readdir(path.join(root, '.yantra'))).filter((name) => name.startsWith('name-migration-backup-'))).toHaveLength(1);
  });

  it('resolves collisions without overwriting and preserves unknown contents and symlinks', async () => {
    const existing = newDocument('A_B');
    await fs.writeFile(path.join(root, 'A_B.yantraD'), JSON.stringify(existing));
    await fs.writeFile(path.join(root, 'A B.yantra_doc'), JSON.stringify({ ...newDocument('A'), title: 'A B' }));
    await fs.writeFile(path.join(root, 'Broken.yantra_doc'), '{broken');
    const future = JSON.stringify({ ...newCanvas('Future'), formatVersion: 99 });
    await fs.writeFile(path.join(root, 'Future.yantra_canvas'), future);
    await fs.symlink(os.tmpdir(), path.join(root, 'External link'));
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git/Hidden.yantra_doc'), 'metadata');
    const repo = await VaultRepository.open(root);
    await repo.scan();
    expect(await repo.readDocument('A_B.yantraD')).toEqual(existing);
    expect((await repo.readDocument('A_B_2.yantraD')).title).toBe('A_B_2');
    expect(await fs.readFile(path.join(root, 'Broken.yantraD'), 'utf8')).toBe('{broken');
    expect(await fs.readFile(path.join(root, 'Future.yantraC'), 'utf8')).toBe(future);
    expect((await fs.lstat(path.join(root, 'External link'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(root, '.git/Hidden.yantra_doc'), 'utf8')).toBe('metadata');
  });

  it('resumes a file migration interrupted between creation and source removal', async () => {
    const document = newDocument('Notes');
    const content = JSON.stringify(document);
    const operation = { kind: 'file', from: 'Notes.yantra_doc', to: 'Notes.yantraD', original: content, content };
    await fs.writeFile(path.join(root, operation.from), content);
    await fs.writeFile(path.join(root, operation.to), content);
    await fs.writeFile(path.join(root, '.yantra/name-migration.json'), JSON.stringify({ cursor: 0, operations: [operation] }));
    const repo = await VaultRepository.open(root);
    await repo.scan();
    expect(await repo.readDocument(operation.to)).toEqual(document);
    await expect(fs.stat(path.join(root, operation.from))).rejects.toThrow();
  });

  it('stops recovery if the destination has changed, without removing the source', async () => {
    const original = JSON.stringify(newDocument('Notes'));
    const operation = { kind: 'file', from: 'Notes.yantra_doc', to: 'Notes.yantraD', original, content: original };
    await fs.writeFile(path.join(root, operation.from), original);
    await fs.writeFile(path.join(root, operation.to), 'External changes');
    await fs.writeFile(path.join(root, '.yantra/name-migration.json'), JSON.stringify({ cursor: 0, operations: [operation] }));
    await expect(VaultRepository.open(root)).rejects.toThrow('destination changed');
    expect(await fs.readFile(path.join(root, operation.from), 'utf8')).toBe(original);
    expect(await fs.readFile(path.join(root, operation.to), 'utf8')).toBe('External changes');
  });
});
