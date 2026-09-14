import { testVaultApi } from "../test/vault-api";
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultRepository } from './vault-repository';
import { createVaultWorkspace } from '../renderer/stores/vaultWorkspace';
import type { VaultOperations } from '../shared/vault-api';
import { documentContentSchema } from '../shared/vault-format';
import { tiptapDocFromPlainText } from '../shared/tiptap-document';
import { documentTitle, withDocumentTitle } from '../shared/document-title';

describe('vault organization and placement', () => {
  let root: string;
  let repo: VaultRepository;
  let api: VaultOperations;
  let store: ReturnType<typeof createVaultWorkspace>;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-organization-'));
    repo = await VaultRepository.open(root, true);
    api = {
      refresh: () => repo.refresh(), deleteEntry: (_session, relative) => repo.deleteEntry(relative), retryRecovery: () => repo.retryRecovery(),
      restore: () => repo.scan(), choose: async () => null,
      readDocument: (_session, relative, mode) => repo.readDocument(relative, mode),
      createDocument: (_session, folder) => repo.createDocument(folder),
      saveDocument: (_session, file) => repo.saveDocument(file),
      readCanvas: (_session, relative, mode) => repo.readCanvas(relative, mode),
      createCanvas: (_session, folder) => repo.createCanvas(folder),
      saveCanvas: (_session, file) => repo.saveCanvas(file),
      createNodeDocument: () => repo.createNodeDocument(),
      createFolder: (_session, folder, name) => repo.createFolder(folder, name),
      renameEntry: (_session, relative, name, title) => repo.renameEntry(relative, name, title),
      moveEntry: (_session, relative, folder) => repo.moveEntry(relative, folder),
    };
    store = createVaultWorkspace(testVaultApi(api));
    await store.getState().restore();
  });
  afterEach(async () => {
    await store.getState().flush().catch(() => { /* Save failures are deliberate in these tests. */ });
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates folders exclusively and rejects invalid or protected names and locations', async () => {
    await repo.createFolder('', 'Research');
    await repo.createFolder('Research', 'Notes');
    await expect(repo.createFolder('', 'Research')).rejects.toThrow();
    await expect(repo.createFolder('../', 'Outside')).rejects.toThrow('Invalid vault path');
    await expect(repo.createFolder('.yantra', 'Hidden')).rejects.toThrow('Invalid vault path');
    for (const name of ['', '..', '.yantra', 'A/B', 'A\\B', ' A', 'A.', 'A\nB']) {
      expect(() => repo.createFolder('', name)).toThrow();
    }
    await fs.symlink(os.tmpdir(), path.join(root, 'Shortcut'));
    await expect(repo.moveEntry('Research', 'Shortcut')).rejects.toThrow('Symbolic links');
  });

  it('renames documents and canvases with stable IDs and aligned titles, and moves both', async () => {
    const document = await repo.createDocument('');
    const canvas = await repo.createCanvas('');
    const renamed = await repo.renameEntry(document.path, 'Notes');
    expect(renamed.document?.id).toBe(document.document.id);
    expect(renamed.document?.title).toBe('Notes');
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
    await repo.renameEntry(canvas.path, 'Map');
    await repo.createFolder('', 'Research');
    await repo.moveEntry('Notes.yantraD', 'Research');
    await repo.moveEntry('Map.yantraC', 'Research');
    await repo.saveDocument({ ...renamed.document!, doc: documentContentSchema.parse(tiptapDocFromPlainText('After move')) });
    expect((await repo.readDocument('Research/Notes.yantraD')).id).toBe(document.document.id);
    expect((await repo.readCanvas('Research/Map.yantraC')).id).toBe(canvas.canvas.id);
    await expect(repo.saveDocument(document.document)).rejects.toThrow('identity');
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
  });

  it('rejects file and folder collisions without altering either source or destination', async () => {
    const first = await repo.createDocument('');
    const second = await repo.createDocument('');
    const before = await fs.readFile(path.join(root, second.path), 'utf8');
    await expect(repo.renameEntry(first.path, second.document.title)).rejects.toThrow();
    expect(await fs.readFile(path.join(root, second.path), 'utf8')).toBe(before);
    expect(await repo.readDocument(first.path)).toEqual(first.document);
    await repo.createFolder('', 'A');
    await repo.createFolder('', 'B');
    await expect(repo.renameEntry('A', 'B')).rejects.toThrow();
    await expect(repo.moveEntry('A', 'A')).rejects.toThrow('inside itself');
    await expect(repo.moveEntry('', 'A')).rejects.toThrow('vault root');
  });

  it('serializes writes with folder moves so old paths are never recreated', async () => {
    await repo.createFolder('', 'A');
    const created = await repo.createDocument('A');
    const first = { ...created.document, doc: documentContentSchema.parse(tiptapDocFromPlainText('Before move')) };
    const second = { ...created.document, doc: documentContentSchema.parse(tiptapDocFromPlainText('After move')) };
    await Promise.all([repo.saveDocument(first), repo.renameEntry('A', 'B'), repo.saveDocument(second)]);
    expect((await repo.readDocument('B/Untitled.yantraD')).doc).toEqual(second.doc);
    await expect(fs.stat(path.join(root, 'A'))).rejects.toThrow();
  });

  it('flushes drafts before renaming and retains the active editor and future saves', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, tiptapDocFromPlainText('Draft before rename'));
    await store.getState().renameEntry('Untitled.yantraD', 'Notes');
    expect(store.getState().error).toBeNull();
    expect(store.getState().activePath).toBe('Notes.yantraD');
    expect(store.getState().activeDocumentId).toBe(id);
    expect(store.getState().documents.get(id)?.file.title).toBe('Notes');
    store.getState().updateDocument(id, tiptapDocFromPlainText('Draft after rename'));
    await store.getState().flush();
    expect((await repo.readDocument('Notes.yantraD')).doc).toEqual(tiptapDocFromPlainText('Draft after rename'));
    await expect(fs.stat(path.join(root, 'Untitled.yantraD'))).rejects.toThrow();
  });

  it('keeps canvas references, reveal paths, and viewport valid through containing-folder moves', async () => {
    await store.getState().createFolder('', 'Research');
    await store.getState().createCanvas('Research');
    const canvasId = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(canvasId, { x: 300, y: 300 });
    const documentId = store.getState().canvases.get(canvasId)!.file.nodes[0]!.documentId;
    const { nodes, edges, groups, layerOrder } = store.getState().canvases.get(canvasId)!.file;
    store.getState().updateCanvas(canvasId, { nodes, edges, groups, layerOrder, viewport: { x: 120, y: -80, zoom: 0.75 } });
    await store.getState().moveEntry('Unfiled/Untitled.yantraD', 'Research');
    await store.getState().renameEntry('Research', 'Projects');
    expect(store.getState().activePath).toBe('Projects/Untitled.yantraC');
    expect(store.getState().documents.get(documentId)?.path).toBe('Projects/Untitled.yantraD');
    await store.getState().renameEntry('Projects/Untitled.yantraC', 'Map');
    expect(store.getState().canvases.get(canvasId)?.file.title).toBe('Map');
    await store.getState().openDocument('Projects/Untitled.yantraD');
    await store.getState().revealDocument(documentId);
    expect(store.getState().activePath).toBe('Projects/Map.yantraC');
    expect(store.getState().revealTarget?.canvasId).toBe(canvasId);
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    expect(reopened.getState().getAppearance(documentId)?.canvasPath).toBe('Projects/Map.yantraC');
    await reopened.getState().revealDocument(documentId);
    expect(reopened.getState().canvases.get(canvasId)?.file.viewport).toEqual({ x: 120, y: -80, zoom: 0.75 });
  });

  it('places a standalone document without copying it, then reveals instead of duplicating', async () => {
    await store.getState().createDocument();
    const documentId = store.getState().activeDocumentId!;
    await store.getState().createCanvas();
    const first = store.getState().activeCanvasId!;
    await store.getState().placeDocument(first, documentId, { x: 400, y: 300 });
    const node = store.getState().canvases.get(first)!.file.nodes[0]!;
    expect(node.documentId).toBe(documentId);
    expect(store.getState().revealTarget?.nodeId).toBe(node.id);
    await store.getState().createCanvas();
    const second = store.getState().activeCanvasId!;
    await store.getState().placeDocument(second, documentId, { x: 700, y: 300 });
    expect(store.getState().activeCanvasId).toBe(first);
    expect(store.getState().canvases.get(first)?.file.nodes).toHaveLength(1);
    expect(store.getState().canvases.get(second)?.file.nodes).toHaveLength(0);
    expect(store.getState().documents.size).toBe(1);
    await store.getState().openDocument('Untitled.yantraD');
    expect(store.getState().revealTarget).toBeNull();
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.yantraD'))).toEqual(['Untitled.yantraD']);
  });

  it('finds appearances on unloaded canvases after reopening', async () => {
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(canvasId, { x: 300, y: 300 });
    const node = store.getState().canvases.get(canvasId)!.file.nodes[0]!;
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    expect(reopened.getState().canvases.size).toBe(0);
    await reopened.getState().createCanvas();
    const destination = reopened.getState().activeCanvasId!;
    await reopened.getState().placeDocument(destination, node.documentId, { x: 0, y: 0 });
    expect(reopened.getState().activeCanvasId).toBe(canvasId);
    expect(reopened.getState().revealTarget?.nodeId).toBe(node.id);
    expect(reopened.getState().canvases.get(destination)?.file.nodes).toHaveLength(0);
  });

  it('does not rename a file when its draft cannot be saved', async () => {
    await store.getState().createDocument();
    store.getState().updateDocument(store.getState().activeDocumentId!, tiptapDocFromPlainText('Keep this draft'));
    api.saveDocument = async () => { throw new Error('Disk full'); };
    await store.getState().renameEntry('Untitled.yantraD', 'Notes');
    expect(store.getState().error).toBe('Disk full');
    expect(store.getState().activePath).toBe('Untitled.yantraD');
    await expect(fs.stat(path.join(root, 'Notes.yantraD'))).rejects.toThrow();
  });

  it('ignores an old-path read that completes after a move', async () => {
    await store.getState().createFolder('', 'Research');
    await store.getState().createDocument();
    const file = store.getState().documents.values().next().value!.file;
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    let release!: (value: typeof file) => void;
    api.readDocument = () => new Promise((resolve) => { release = resolve; });
    const pending = reopened.getState().openDocument('Untitled.yantraD');
    await reopened.getState().moveEntry('Untitled.yantraD', 'Research');
    release(file);
    await pending;
    expect(reopened.getState().documents.size).toBe(0);
    expect(reopened.getState().loadState).toBe('idle');
    expect((await repo.readDocument('Research/Untitled.yantraD')).id).toBe(file.id);
  });

  it('saves title drafts without renaming until an explicit commit, including reopening', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Project 2'));
    await store.getState().flush();
    expect(documentTitle((await repo.readDocument('Untitled.yantraD')).doc)).toBe('Project 2');
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    await reopened.getState().openDocument('Untitled.yantraD');
    expect(reopened.getState().documents.get(id)?.file.title).toBe('Untitled');
    expect((await reopened.getState().commitDocumentTitle(id)).status).toBe('success');
    expect(reopened.getState().activePath).toBe('Project_2.yantraD');
    expect(reopened.getState().activeDocumentId).toBe(id);
    expect((await repo.readDocument('Project_2.yantraD')).id).toBe(id);
    await expect(fs.stat(path.join(root, 'Untitled.yantraD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps canvas node identity and content through title commits and subsequent saves', async () => {
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(canvasId, { x: 100, y: 100 });
    const node = store.getState().canvases.get(canvasId)!.file.nodes[0]!;
    const file = store.getState().documents.get(node.documentId)!.file;
    store.getState().updateDocument(file.id, withDocumentTitle(file.doc, 'Node 42'));
    expect((await store.getState().commitDocumentTitle(file.id)).status).toBe('success');
    expect(store.getState().documents.get(file.id)?.reloadRevision).toBe(0);
    expect(store.getState().canvases.get(canvasId)!.file.nodes[0]).toEqual(node);
    expect(store.getState().documents.get(file.id)?.path).toBe('Unfiled/Node_42.yantraD');
    await store.getState().openNodeDocument(canvasId, node.id);
    expect(store.getState().activePath).toBe('Unfiled/Node_42.yantraD');
    const updated = store.getState().documents.get(file.id)!.file.doc;
    store.getState().updateDocument(file.id, { ...updated, content: [...updated.content!, { type: 'paragraph', content: [{ type: 'text', text: 'More body text' }] }] });
    await store.getState().flush();
    expect((await repo.readDocument('Unfiled/Node_42.yantraD')).doc.content?.[1]?.content?.[0]?.text).toBe('More body text');
  });

  it('retains blank and excessive drafts, and never overwrites colliding files', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    expect((await store.getState().commitDocumentTitle(id)).status).toBe('failure');
    expect(store.getState().titleErrors.get(id)).toContain('Enter a title');
    const existing = await repo.createDocument('');
    await repo.renameEntry(existing.path, 'Project_2');
    const before = await fs.readFile(path.join(root, 'Project_2.yantraD'), 'utf8');
    for (const title of ['A'.repeat(181), 'Project 2']) {
      store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, title));
      expect((await store.getState().commitDocumentTitle(id)).status).toBe('failure');
      expect(store.getState().activePath).toBe('Untitled.yantraD');
      expect(documentTitle((await repo.readDocument('Untitled.yantraD')).doc)).toBe(title);
    }
    expect(store.getState().titleErrors.get(id)).toContain('already exists');
    expect(await fs.readFile(path.join(root, 'Project_2.yantraD'), 'utf8')).toBe(before);
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Project 3'));
    expect((await store.getState().commitDocumentTitle(id)).status).toBe('success');
    expect(store.getState().titleErrors.has(id)).toBe(false);
  });

  it('updates the editor title through sidebar rename, even when the path is unchanged', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    await store.getState().renameEntry('Untitled.yantraD', 'Project_2', 'Project 2');
    expect(documentTitle(store.getState().documents.get(id)!.file.doc)).toBe('Project 2');
    expect(store.getState().documents.get(id)?.reloadRevision).toBe(1);
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Draft 3'));
    await store.getState().renameEntry('Project_2.yantraD', 'Project_2', 'Project 2');
    expect(documentTitle(store.getState().documents.get(id)!.file.doc)).toBe('Project 2');
    expect(documentTitle((await repo.readDocument('Project_2.yantraD')).doc)).toBe('Project 2');
    expect(store.getState().documents.get(id)?.reloadRevision).toBe(2);
  });

  it('waits for in-flight saves and blocks a rename when saving fails', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    let release!: () => void;
    api.saveDocument = async (_session, file) => { await new Promise<void>((resolve) => { release = resolve; }); return repo.saveDocument(file); };
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Title 1'));
    const saving = store.getState().retry(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const committing = store.getState().commitDocumentTitle(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().busy).toBe(true);
    await expect(fs.stat(path.join(root, 'Title_1.yantraD'))).rejects.toMatchObject({ code: 'ENOENT' });
    release();
    await saving;
    expect((await committing).status).toBe('success');
    api.saveDocument = async () => { throw new Error('Disk full'); };
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Title 2'));
    expect((await store.getState().commitDocumentTitle(id)).status).toBe('failure');
    expect(store.getState().titleErrors.get(id)).toContain('Disk full');
    expect(store.getState().activePath).toBe('Title_1.yantraD');
    api.saveDocument = (_session, file) => repo.saveDocument(file);
  });

  it('does not cancel a different document read when committing the title being left', async () => {
    const second = await repo.createDocument('');
    await store.getState().refresh();
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Leaving Title 2'));
    let release!: () => void;
    api.readDocument = async (_session, relative) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return repo.readDocument(relative);
    };
    const opening = store.getState().openDocument(second.path);
    expect(store.getState().loadState).toBe('loading');
    expect((await store.getState().commitDocumentTitle(id)).status).toBe('success');
    expect(store.getState().loadState).toBe('loading');
    release();
    expect((await opening).status).toBe('success');
    expect(store.getState().activeDocumentId).toBe(second.document.id);
    expect(store.getState().activePath).toBe(second.path);
    expect(store.getState().documents.get(id)?.path).toBe('Leaving_Title_2.yantraD');
  });

  it('waits for a file move already started by the click before committing its title', async () => {
    await store.getState().createFolder('', 'Archive');
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Moved Title 3'));
    const moving = store.getState().moveEntry('Untitled.yantraD', 'Archive');
    const committing = store.getState().commitDocumentTitle(id);
    expect((await moving).status).toBe('success');
    expect((await committing).status).toBe('success');
    expect(store.getState().documents.get(id)?.path).toBe('Archive/Moved_Title_3.yantraD');
    expect((await repo.readDocument('Archive/Moved_Title_3.yantraD')).id).toBe(id);
  });

  it('serializes repeated title commits without a second rename or history reset', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, withDocumentTitle(store.getState().documents.get(id)!.file.doc, 'Repeated Title 5'));
    let renames = 0;
    const rename = api.renameEntry;
    api.renameEntry = (...args) => { renames += 1; return rename(...args); };
    const results = await Promise.all([store.getState().commitDocumentTitle(id), store.getState().commitDocumentTitle(id)]);
    expect(results.map((result) => result.status)).toEqual(['success', 'success']);
    expect(renames).toBe(1);
    expect(store.getState().documents.get(id)?.reloadRevision).toBe(0);
    expect(store.getState().titleErrors.size).toBe(0);
  });
});
