import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './atomic-write';
import { createEmptyJsonCanvasDocument, decodeJsonCanvasDocument, encodeJsonCanvasDocument } from '../shared/json-canvas';

describe('atomicWrite', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-save-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('creates and replaces complete files without leaving temporary files', async () => {
    const file = path.join(directory, 'default.canvas');
    await atomicWrite(file, 'first');
    await atomicWrite(file, 'second');
    expect(await fs.readFile(file, 'utf8')).toBe('second');
    expect(await fs.readdir(directory)).toEqual(['default.canvas']);
  });

  it('uses separate temporary files for simultaneous writes', async () => {
    const file = path.join(directory, 'default.canvas');
    await Promise.all([atomicWrite(file, 'a'.repeat(10000)), atomicWrite(file, 'b'.repeat(10000))]);
    expect(['a'.repeat(10000), 'b'.repeat(10000)]).toContain(await fs.readFile(file, 'utf8'));
    expect(await fs.readdir(directory)).toEqual(['default.canvas']);
  });

  it('cleans up the temporary file if replacement fails', async () => {
    const target = path.join(directory, 'occupied');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'keep'), 'original');
    await expect(atomicWrite(target, 'replacement')).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'keep'), 'utf8')).toBe('original');
    expect(await fs.readdir(directory)).toEqual(['occupied']);
  });

  it('round-trips a canvas through a fresh disk read', async () => {
    const document = createEmptyJsonCanvasDocument();
    const file = path.join(directory, 'default.canvas');
    await atomicWrite(file, `${JSON.stringify(encodeJsonCanvasDocument(document))}\n`);
    expect(decodeJsonCanvasDocument(await fs.readFile(file, 'utf8'))).toEqual(document);
  });
});
