import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultRepository } from './vault-repository';
import { newDocument } from '../shared/vault-format';
import { newCanvas } from '../shared/vault-canvas';
import { vaultNameSchema } from '../shared/vault-organization';

describe('vault names', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-names-'));
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

  it('rejects a version-1 vault without migrating names or extensions', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-legacy-'));
    const metadata = { formatVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    await fs.mkdir(path.join(other, '.yantra'));
    const raw = `${JSON.stringify(metadata, null, 2)}\n`;
    await fs.writeFile(path.join(other, '.yantra', 'vault.json'), raw);
    await fs.writeFile(path.join(other, 'First draft.yantra_doc'), JSON.stringify(newDocument('Draft')));
    await expect(VaultRepository.open(other)).rejects.toMatchObject({ failure: { code: 'unsupported-format' } });
    expect(await fs.readFile(path.join(other, '.yantra', 'vault.json'), 'utf8')).toBe(raw);
    expect(await fs.readdir(other)).toEqual(expect.arrayContaining(['.yantra', 'First draft.yantra_doc']));
    await fs.rm(other, { recursive: true, force: true });
  });
});
