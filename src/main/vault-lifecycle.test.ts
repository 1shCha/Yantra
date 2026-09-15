import { tiptapDocSchema } from '../shared/tiptap-document';
import { testVaultApi } from "../test/vault-api";
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultRepository } from './vault-repository';
import { createVaultCanvasSession } from '../renderer/vault/vault-canvas-session';
import { createVaultWorkspace } from '../renderer/stores/vaultWorkspace';
import { newCanvas, removeCanvasNodes } from '../shared/vault-canvas';
import { newDocument } from '../shared/vault-format';
import { tiptapDocFromPlainText } from '../shared/tiptap-document';
import type { VaultOperations } from '../shared/vault-api';

describe('vault lifecycle', () => {
  let temporary: string;
  let root: string;
  let repo: VaultRepository;
  let store: ReturnType<typeof createVaultWorkspace>;
  let api: VaultOperations;
  let failTrash: boolean;
  let failTrashAfter: number;
  const trashed: string[] = [];
  const trash = async (absolute: string) => {
    if (failTrash || trashed.length >= failTrashAfter) throw new Error('Trash unavailable');
    const destination = path.join(temporary, `trashed-${trashed.length}`);
    await fs.rename(absolute, destination);
    trashed.push(destination);
  };
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-lifecycle-'));
    root = path.join(temporary, 'vault');
    await fs.mkdir(root);
    failTrash = false;
    failTrashAfter = Infinity;
    trashed.length = 0;
    repo = await VaultRepository.open(root, true, trash);
    api = {
      deleteCanvasNodes: (_session, canvasId, nodeIds) => repo.deleteCanvasNodes(canvasId, nodeIds),
      restore: () => repo.scan(), choose: async () => null, refresh: () => repo.refresh(),
      retryRecovery: () => repo.retryRecovery(), deleteEntry: (_session, relative) => repo.deleteEntry(relative),
      readDocument: (_session, relative, mode) => repo.readDocument(relative, mode), createDocument: (_session, folder) => repo.createDocument(folder),
      saveDocument: (_session, file, overwrite) => repo.saveDocument(file, overwrite),
      readCanvas: (_session, relative, mode) => repo.readCanvas(relative, mode), createCanvas: (_session, folder) => repo.createCanvas(folder),
      saveCanvas: (_session, file, overwrite) => repo.saveCanvas(file, overwrite), createNodeDocument: () => repo.createNodeDocument(),
      createFolder: (_session, folder, name) => repo.createFolder(folder, name),
      renameEntry: (_session, relative, name, title) => repo.renameEntry(relative, name, title), moveEntry: (_session, relative, folder) => repo.moveEntry(relative, folder),
    };
    store = createVaultWorkspace(testVaultApi(api));
    await store.getState().restore();
  });
  afterEach(async () => {
    await store.getState().flush().catch(() => { /* Deliberate failed drafts must remain unsaved. */ });
    await fs.rm(temporary, { recursive: true, force: true });
  });

  async function canvasAndDocument() {
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(canvasId, { x: 200, y: 200 });
    const canvas = store.getState().canvases.get(canvasId)!;
    const node = canvas.file.nodes[0]!;
    const document = store.getState().documents.get(node.documentId)!;
    return { canvasId, node, document, canvas };
  }

  it('removes connected edges and dissolves small groups without losing remaining layer order', () => {
    const canvas = newCanvas('Map');
    const nodes = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), kind: 'document' as const, documentId: crypto.randomUUID(), x: 0, y: 0, width: 200, height: 200 }));
    const group = { id: 'group', nodeIds: [nodes[0]!.id, nodes[1]!.id] };
    const result = removeCanvasNodes({ ...canvas, nodes, groups: [group], layerOrder: [group.id, nodes[2]!.id],
      edges: [{ id: 'edge', fromNode: nodes[0]!.id, toNode: nodes[2]!.id }] }, new Set([nodes[0]!.id]));
    expect(result.groups).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.layerOrder).toEqual([nodes[1]!.id, nodes[2]!.id]);
  });

  it('removes an appearance while preserving the document and allowing placement again', async () => {
    const { canvasId, node, document } = await canvasAndDocument();
    await store.getState().removeFromCanvas(canvasId, [node.id]);
    expect(store.getState().getAppearance(node.documentId)).toBeNull();
    expect(await repo.readDocument(document.path)).toEqual(document.file);
    await store.getState().placeDocument(canvasId, node.documentId, { x: 0, y: 0 });
    expect(store.getState().canvases.get(canvasId)?.file.nodes).toHaveLength(1);
  });

  it('flushes a pending draft before Trash and never recreates its deleted file', async () => {
    const { node, document, canvas } = await canvasAndDocument();
    store.getState().updateDocument(node.documentId, tiptapDocFromPlainText('Final pending draft'));
    await store.getState().deleteEntry(document.path);
    expect(store.getState().error).toBeNull();
    expect(store.getState().documents.has(node.documentId)).toBe(false);
    expect((await repo.readCanvas(canvas.path)).nodes).toEqual([]);
    expect(await fs.readFile(trashed[0]!, 'utf8')).toContain('Final pending draft');
    await store.getState().flush();
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
    await expect(repo.saveDocument(document.file)).rejects.toThrow('not registered');
  });

  it.each(['selection', 'group', 'flow'] as const)('trashes canvas documents through %s deletion and saves pending edits', async (mode) => {
    const { canvasId, node, document, canvas } = await canvasAndDocument();
    await store.getState().createCanvasNode(canvasId, { x: 600, y: 200 });
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    let pending: ReturnType<ReturnType<typeof store.getState>['deleteCanvasNodes']>;
    const deleteNodes = store.getState().deleteCanvasNodes;
    store.setState({ deleteCanvasNodes: (...args) => (pending = deleteNodes(...args)) });
    try {
      store.getState().updateDocument(node.documentId, tiptapDocFromPlainText('Final canvas draft'));
      const ids = session.flow.getState().nodes.map((item) => item.id);
      session.flow.getState().selectNode(ids[0]!);
      session.flow.getState().toggleNodeSelection(ids[1]!);
      session.flow.getState().groupSelectedNodes();
      session.flow.setState({ edges: [{ id: 'connection', source: ids[0]!, target: ids[1]! }] });
      if (mode === 'group') session.flow.getState().deleteSelectedGroup();
      else if (mode === 'flow') session.flow.getState().onNodesChange([{ type: 'remove', id: node.id }]);
      else {
        session.flow.getState().selectNode(ids[0]!);
        session.flow.getState().toggleNodeSelection(ids[1]!);
        session.flow.getState().deleteSelectedNodes();
      }
      expect((await pending!).status).toBe('success');
      await store.getState().flush();
      const saved = await repo.readCanvas(canvas.path);
      expect(saved.nodes).toHaveLength(mode === 'flow' ? 1 : 0);
      expect(saved.groups).toEqual([]);
      expect(saved.edges).toEqual([]);
      expect(trashed).toHaveLength(mode === 'flow' ? 1 : 2);
      expect(await fs.readFile(trashed[0]!, 'utf8')).toContain('Final canvas draft');
      await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
      expect(session.flow.getState().selectedNodeIds).toEqual([]);
    } finally { disconnect(); }
  });

  it('surfaces Trash recovery errors when deleting canvas nodes', async () => {
    const { canvasId, node, document, canvas } = await canvasAndDocument();
    failTrash = true;
    const result = await store.getState().deleteCanvasNodes(canvasId, [node.id]);
    expect(result.status).toBe('recovery-required');
    expect(store.getState().error).toContain('Trash unavailable');
    expect(trashed).toEqual([]);
    expect(await fs.readFile(path.join(root, document.path), 'utf8')).toContain(node.documentId);
    expect(store.getState().canvases.get(canvasId)!.file.nodes).toEqual((await repo.readCanvas(canvas.path)).nodes);
  });

  it('reports a canvas deletion failure and does not trash subsequent documents', async () => {
    const { canvasId, canvas } = await canvasAndDocument();
    await store.getState().createCanvasNode(canvasId, { x: 600, y: 200 });
    await store.getState().createCanvasNode(canvasId, { x: 900, y: 200 });
    const nodes = store.getState().canvases.get(canvasId)!.file.nodes;
    failTrashAfter = 1;
    const result = await store.getState().deleteCanvasNodes(canvasId, nodes.map((node) => node.id));
    expect(result.status).toBe('recovery-required');
    expect(store.getState().error).toBe('Trash unavailable');
    expect(trashed).toHaveLength(1);
    expect(store.getState().canvases.get(canvasId)!.file.nodes).toEqual((await repo.readCanvas(canvas.path)).nodes);
    expect(store.getState().canvases.get(canvasId)!.file.nodes).toHaveLength(1);
  });

  it('retains the active canvas, surviving node identities and editable save resources', async () => {
    const { canvasId, node, canvas } = await canvasAndDocument();
    await store.getState().createCanvasNode(canvasId, { x: 600, y: 200 });
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    const survivor = session.flow.getState().nodes[1]!;
    const document = store.getState().documents.get(survivor.data.documentId!)!;
    const entry = store.getState().vault!.entries.find((item) => item.path === canvas.path);
    const activeChanges: (string | null)[] = [];
    const stop = store.subscribe((state, before) => {
      if (state.activeCanvasId !== before.activeCanvasId) activeChanges.push(state.activeCanvasId);
    });
    try {
      expect((await store.getState().deleteCanvasNodes(canvasId, [node.id])).status).toBe('success');
      expect(activeChanges).toEqual([]);
      expect(session.flow.getState().nodes[0]).toBe(survivor);
      expect(store.getState().documents.get(document.file.id)).toBe(document);
      expect(store.getState().vault!.entries.find((item) => item.path === canvas.path)).toBe(entry);
      session.flow.getState().setNodePosition(survivor.id, { x: 800, y: 300 });
      store.getState().updateDocument(document.file.id, tiptapDocFromPlainText('Surviving draft'));
      await store.getState().flush();
      expect((await repo.readCanvas(canvas.path)).nodes[0]).toMatchObject({ x: 800, y: 300 });
      expect((await repo.readDocument(document.path)).doc).toEqual(tiptapDocFromPlainText('Surviving draft'));
    } finally { stop(); disconnect(); }
  });

  it('allows unrelated editing and navigation while deletion waits, and close waits for deletion', async () => {
    const { canvasId, node } = await canvasAndDocument();
    await store.getState().createDocument();
    const other = store.getState().documents.get(store.getState().activeDocumentId!)!;
    await store.getState().openCanvas(store.getState().canvases.get(canvasId)!.path);
    const original = api.deleteCanvasNodes;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    api.deleteCanvasNodes = async (...args) => { started(); await gate; return original(...args); };
    const deletion = store.getState().deleteCanvasNodes(canvasId, [node.id]);
    await ready;
    expect(store.getState().busy).toBe(false);
    expect(store.getState().deletingCanvasId).toBe(canvasId);
    await store.getState().openDocument(other.path);
    store.getState().updateDocument(other.file.id, tiptapDocFromPlainText('Concurrent draft'));
    let closed = false;
    const closing = store.getState().flush().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    expect((await deletion).status).toBe('success');
    await closing;
    expect(store.getState().activeDocumentId).toBe(other.file.id);
    expect((await repo.readDocument(other.path)).doc).toEqual(tiptapDocFromPlainText('Concurrent draft'));
    expect(store.getState().deletingCanvasId).toBeNull();
  });

  it('scans unrelated documents twice for an entire batch and preserves external-edit conflicts', async () => {
    const { canvasId } = await canvasAndDocument();
    await store.getState().createCanvasNode(canvasId, { x: 600, y: 200 });
    await store.getState().createDocument();
    const other = store.getState().documents.get(store.getState().activeDocumentId!)!;
    const external = { ...other.file, doc: tiptapDocFromPlainText('External edit') };
    await fs.writeFile(path.join(root, other.path), JSON.stringify(external));
    const spy = vi.spyOn(fs, 'readFile');
    try {
      const ids = store.getState().canvases.get(canvasId)!.file.nodes.map((node) => node.id);
      expect((await store.getState().deleteCanvasNodes(canvasId, ids)).status).toBe('success');
      expect(spy.mock.calls.filter(([file]) => String(file) === path.join(repo.root, other.path))).toHaveLength(2);
    } finally { spy.mockRestore(); }
    await expect(repo.saveDocument(other.file)).rejects.toThrow();
    expect(trashed).toHaveLength(2);
  });

  it('deleting a canvas preserves its documents and closes its active view', async () => {
    const { canvas, document } = await canvasAndDocument();
    await store.getState().deleteEntry(canvas.path);
    expect(store.getState().activePath).toBeNull();
    expect(await repo.readDocument(document.path)).toEqual(document.file);
    expect(store.getState().vault?.appearances).toEqual([]);
  });

  it('waits for an already active save before deleting its document', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    const loaded = store.getState().documents.get(id)!;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { started = resolve; });
    api.saveDocument = async (_session, file, overwrite) => { started(); await gate; return repo.saveDocument(file, overwrite); };
    store.getState().updateDocument(id, tiptapDocFromPlainText('In-flight edit'));
    const saving = store.getState().flush();
    await writing;
    const deleting = store.getState().deleteEntry(loaded.path);
    expect(trashed).toEqual([]);
    release();
    await Promise.all([saving, deleting]);
    await store.getState().flush();
    expect(await fs.readFile(trashed[0]!, 'utf8')).toContain('In-flight edit');
    await expect(fs.stat(path.join(root, loaded.path))).rejects.toThrow();
  });

  it('rejects protected paths and standalone unknown files; trashes an empty folder', async () => {
    await repo.createFolder('', 'Folder');
    await fs.writeFile(path.join(root, 'Folder/unknown.txt'), 'keep');
    await expect(repo.deleteEntry('Folder/unknown.txt')).rejects.toThrow('Only valid');
    await expect(repo.deleteEntry('.yantra')).rejects.toThrow();
    await expect(repo.deleteEntry('')).rejects.toThrow();
    await repo.createFolder('', 'Empty');
    await repo.deleteEntry('Empty');
    expect((await fs.stat(trashed[0]!)).isDirectory()).toBe(true);
  });

  it('trashes a nested folder once, flushes its drafts and cleans only outside canvas references', async () => {
    const { document, canvas, canvasId } = await canvasAndDocument();
    await store.getState().createFolder('', 'Archive');
    await store.getState().createFolder('Archive', 'Nested');
    await store.getState().moveEntry(document.path, 'Archive/Nested');
    const insideCanvas = await repo.createCanvas('Archive');
    await fs.writeFile(path.join(root, 'Archive/Nested/notes.txt'), 'Extra file');
    const outside = path.join(temporary, 'outside.txt');
    await fs.writeFile(outside, 'Leave untouched');
    await fs.symlink(outside, path.join(root, 'Archive/link'));
    store.getState().updateDocument(document.file.id, tiptapDocFromPlainText('Draft before folder deletion'));
    expect((await store.getState().deleteEntry('Archive')).status).toBe('success');
    expect(trashed).toHaveLength(1);
    expect(await fs.readFile(path.join(trashed[0]!, 'Nested', path.basename(document.path)), 'utf8')).toContain('Draft before folder deletion');
    expect(await fs.readFile(path.join(trashed[0]!, 'Nested/notes.txt'), 'utf8')).toBe('Extra file');
    expect(await fs.readFile(path.join(trashed[0]!, path.basename(insideCanvas.path)), 'utf8')).toContain(insideCanvas.canvas.id);
    expect(await fs.readFile(outside, 'utf8')).toBe('Leave untouched');
    expect((await repo.readCanvas(canvas.path)).nodes).toEqual([]);
    expect(store.getState().activeCanvasId).toBe(canvasId);
    expect(store.getState().documents.has(document.file.id)).toBe(false);
    await store.getState().flush();
    await expect(fs.stat(path.join(root, 'Archive'))).rejects.toThrow();
  });

  it('stops folder recovery after content changes, then safely retries unchanged content', async () => {
    const { document, canvas } = await canvasAndDocument();
    await store.getState().createFolder('', 'Archive');
    await store.getState().moveEntry(document.path, 'Archive');
    await fs.writeFile(path.join(root, 'Archive/notes.txt'), 'Original');
    failTrash = true;
    expect((await store.getState().deleteEntry('Archive')).status).toBe('recovery-required');
    expect((await repo.readCanvas(canvas.path)).nodes).toEqual([]);
    await fs.writeFile(path.join(root, 'Archive/notes.txt'), 'Changed');
    failTrash = false;
    failTrashAfter = Infinity;
    expect((await repo.retryRecovery()).recovery?.message).toContain('contents changed externally');
    expect(trashed).toHaveLength(0);
    await fs.writeFile(path.join(root, 'Archive/notes.txt'), 'Original');
    expect((await store.getState().retryRecovery()).status).toBe('success');
    expect(trashed).toHaveLength(1);
    expect((await repo.readCanvas(canvas.path)).nodes).toEqual([]);
  });

  it('refuses folder deletion when documents cannot be identified safely', async () => {
    await repo.createFolder('', 'Archive');
    await fs.writeFile(path.join(root, 'Archive/Broken.yantraD'), '{}');
    await expect(repo.deleteEntry('Archive')).rejects.toThrow('unavailable files');
    expect(trashed).toHaveLength(0);
  });

  it('retains local drafts on conflict and requires an explicit overwrite', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    const loaded = store.getState().documents.get(id)!;
    const external = { ...loaded.file, doc: tiptapDocSchema.parse(tiptapDocFromPlainText('External text')) };
    await fs.writeFile(path.join(root, loaded.path), JSON.stringify(external));
    store.getState().updateDocument(id, tiptapDocFromPlainText('Local draft'));
    await expect(store.getState().flush()).rejects.toMatchObject({ failure: { code: 'conflict' } });
    expect(store.getState().conflicts.has(`document:${id}`)).toBe(true);
    await store.getState().refresh();
    expect(store.getState().documents.get(id)?.file.doc).toEqual(tiptapDocFromPlainText('Local draft'));
    expect(JSON.parse(await fs.readFile(path.join(root, loaded.path), 'utf8'))).toEqual(external);
    await store.getState().resolveConflict('document', id, 'overwrite');
    expect(store.getState().conflicts.size).toBe(0);
    expect((await repo.readDocument(loaded.path)).doc).toEqual(tiptapDocFromPlainText('Local draft'));
  });

  it('explicit reload discards only the chosen local draft and keeps the external content', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    const loaded = store.getState().documents.get(id)!;
    store.getState().updateDocument(id, tiptapDocFromPlainText('Local draft'));
    const external = { ...loaded.file, doc: tiptapDocSchema.parse(tiptapDocFromPlainText('External text')) };
    await fs.writeFile(path.join(root, loaded.path), JSON.stringify(external));
    await expect(store.getState().flush()).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await store.getState().resolveConflict('document', id, 'reload');
    expect(store.getState().documents.get(id)?.file).toEqual(external);
    expect(store.getState().documents.get(id)?.save.state).toBe('clean');
    expect(store.getState().documents.get(id)?.reloadRevision).toBe(1);
    expect(store.getState().conflicts.size).toBe(0);
    await store.getState().flush();
    expect(await fs.readFile(path.join(root, loaded.path), 'utf8')).toBe(JSON.stringify(external));
  });

  it('does not overwrite missing, malformed, unsupported or identity-replaced files even explicitly', async () => {
    const { document, path: relative } = await repo.createDocument('');
    for (const raw of ['{broken', JSON.stringify({ ...document, formatVersion: 99 }), JSON.stringify(newDocument(document.title))]) {
      await fs.writeFile(path.join(root, relative), raw);
      await expect(repo.saveDocument(document, true)).rejects.toThrow();
      expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(raw);
    }
    await fs.unlink(path.join(root, relative));
    await expect(repo.saveDocument(document, true)).rejects.toThrow();
    await expect(fs.stat(path.join(root, relative))).rejects.toThrow();
  });

  it('refresh picks up external moves, content changes, missing references and unsupported files', async () => {
    const { document, canvas } = await canvasAndDocument();
    await fs.mkdir(path.join(root, 'Moved'));
    await fs.rename(path.join(root, canvas.path), path.join(root, 'Moved', canvas.path));
    await fs.unlink(path.join(root, document.path));
    await fs.writeFile(path.join(root, 'Broken.yantraD'), '{}');
    await store.getState().refresh();
    expect(store.getState().activePath).toBe(`Moved/${canvas.path}`);
    expect(store.getState().canvases.get(canvas.file.id)?.documentErrors.get(document.file.id)).toContain('missing');
    expect(store.getState().vault?.entries.find((entry) => entry.path === 'Broken.yantraD')?.error).toBeTruthy();
    expect(store.getState().canvases.get(canvas.file.id)?.file.nodes).toHaveLength(1);
  });

  it('retains the active workspace after failed refresh and saves normally when the vault returns', async () => {
    const { canvasId, node, document } = await canvasAndDocument();
    const before = store.getState();
    const unavailable = path.join(temporary, 'unavailable');
    await fs.rename(root, unavailable);
    try {
      await store.getState().refresh();
      expect(store.getState().error).toBeTruthy();
      expect(store.getState().vault).toBe(before.vault);
      expect(store.getState().documents).toBe(before.documents);
      expect(store.getState().canvases).toBe(before.canvases);
      expect(store.getState().activeCanvasId).toBe(canvasId);
    } finally {
      await fs.rename(unavailable, root);
    }
    store.getState().updateDocument(node.documentId, tiptapDocFromPlainText('Still editable'));
    await store.getState().flush();
    expect((await repo.readDocument(document.path)).doc).toEqual(tiptapDocFromPlainText('Still editable'));
    await store.getState().refresh();
    expect(store.getState().error).toBeNull();
    expect(store.getState().activeCanvasId).toBe(canvasId);
  });

  it('conflicts on canvas changes and reloads the external layout', async () => {
    const { canvasId, canvas } = await canvasAndDocument();
    const external = { ...canvas.file, viewport: { x: 70, y: 80, zoom: 0.5 } };
    await fs.writeFile(path.join(root, canvas.path), JSON.stringify(external));
    const { nodes, edges, groups, layerOrder } = canvas.file;
    store.getState().updateCanvas(canvasId, { nodes, edges, groups, layerOrder, viewport: { x: 1, y: 2, zoom: 1 } });
    await expect(store.getState().flush()).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await store.getState().resolveConflict('canvas', canvasId, 'reload');
    expect(store.getState().canvases.get(canvasId)?.file.viewport).toEqual(external.viewport);
    expect(store.getState().conflicts.size).toBe(0);
  });

  it('stops deletion on a conflicted pending save', async () => {
    const { document } = await canvasAndDocument();
    store.getState().updateDocument(document.file.id, tiptapDocFromPlainText('Local'));
    await fs.writeFile(path.join(root, document.path), JSON.stringify({ ...document.file, doc: tiptapDocFromPlainText('External') }));
    await store.getState().deleteEntry(document.path);
    expect(store.getState().conflicts.size).toBe(1);
    expect(trashed).toEqual([]);
    expect(store.getState().documents.has(document.file.id)).toBe(true);
  });

  it('reports a failed Trash operation, blocks writes, and recovers on reopen', async () => {
    const { document, canvas } = await canvasAndDocument();
    failTrash = true;
    expect(await store.getState().deleteEntry(document.path)).toMatchObject({ status: 'recovery-required', error: { code: 'recovery-required', message: 'Trash unavailable' } });
    expect(store.getState().vault?.recovery?.message).toBe('Trash unavailable');
    expect((await repo.readCanvas(canvas.path)).nodes).toEqual([]);
    await expect(repo.saveDocument(document.file)).rejects.toThrow('recovery');
    failTrash = false;
    failTrashAfter = Infinity;
    const reopened = await VaultRepository.open(root, false, trash);
    expect((await reopened.scan()).recovery).toBeNull();
    expect((await reopened.readCanvas(canvas.path)).nodes).toEqual([]);
    await expect(fs.stat(path.join(root, document.path))).rejects.toThrow();
    expect(trashed).toHaveLength(1);
  });

  it('retries recovery through the workspace without resurrecting removed appearances', async () => {
    const { document, canvas } = await canvasAndDocument();
    failTrash = true;
    await store.getState().deleteEntry(document.path);
    failTrash = false;
    failTrashAfter = Infinity;
    expect((await store.getState().retryRecovery()).status).toBe('success');
    expect(store.getState().vault?.recovery).toBeNull();
    expect(store.getState().canvases.get(canvas.file.id)?.file.nodes).toEqual([]);
    await store.getState().flush();
    expect(trashed).toHaveLength(1);
  });

  it('does not guess when an interrupted deletion source disappears', async () => {
    const { document } = await canvasAndDocument();
    failTrash = true;
    await store.getState().deleteEntry(document.path);
    await fs.rename(path.join(root, document.path), path.join(temporary, 'external-move'));
    failTrash = false;
    failTrashAfter = Infinity;
    const snapshot = await repo.retryRecovery();
    expect(snapshot.recovery?.message).toContain('source is missing');
    expect(await fs.readFile(path.join(root, '.yantra/deletion.json'), 'utf8')).toContain(document.file.id);
    expect(trashed).toEqual([]);
  });

  it('leaves an externally changed recovery canvas untouched', async () => {
    const { document, canvas } = await canvasAndDocument();
    failTrash = true;
    await store.getState().deleteEntry(document.path);
    const raw = JSON.stringify({ ...newCanvas(canvas.file.title), id: canvas.file.id });
    await fs.writeFile(path.join(root, canvas.path), raw);
    failTrash = false;
    failTrashAfter = Infinity;
    expect((await repo.retryRecovery()).recovery?.message).toContain('Canvas changed externally');
    expect(await fs.readFile(path.join(root, canvas.path), 'utf8')).toBe(raw);
    expect(trashed).toEqual([]);
  });

  it('refuses document deletion when unknown canvases make reference cleanup unsafe', async () => {
    const created = await repo.createDocument('');
    await fs.writeFile(path.join(root, 'Unknown.yantraC'), JSON.stringify({ ...newCanvas('Unknown'), formatVersion: 99 }));
    await expect(repo.deleteEntry(created.path)).rejects.toThrow('unavailable canvases');
    expect(trashed).toEqual([]);
  });

  it('replays a deletion interrupted before the canvas update', async () => {
    const { document, canvas, node } = await canvasAndDocument();
    const before = await fs.readFile(path.join(root, canvas.path), 'utf8');
    const after = `${JSON.stringify(removeCanvasNodes(canvas.file, new Set([node.id])), null, 2)}\n`;
    await fs.writeFile(path.join(root, '.yantra/deletion.json'), JSON.stringify({
      version: 1, path: document.path, kind: 'document', original: await fs.readFile(path.join(root, document.path), 'utf8'),
      canvases: [{ path: canvas.path, before, after }],
    }));
    const reopened = await VaultRepository.open(root, false, trash);
    expect((await reopened.scan()).recovery).toBeNull();
    expect(await fs.readFile(path.join(root, canvas.path), 'utf8')).toBe(after);
    expect(trashed).toHaveLength(1);
  });

  it('reports a malformed recovery record without changing vault files', async () => {
    const { document } = await canvasAndDocument();
    await fs.writeFile(path.join(root, '.yantra/deletion.json'), '{broken');
    const reopened = await VaultRepository.open(root, false, trash);
    expect((await reopened.scan()).recovery?.message).toBeTruthy();
    await expect(reopened.createDocument('')).rejects.toThrow('recovery');
    expect(await reopened.readDocument(document.path)).toEqual(document.file);
    expect(trashed).toEqual([]);
  });

  it('refresh reports duplicate IDs and preserves both files', async () => {
    await store.getState().createDocument();
    const file = store.getState().documents.get(store.getState().activeDocumentId!)!.file;
    const copy = JSON.stringify({ ...file, title: 'Copy' });
    await fs.writeFile(path.join(root, 'Copy.yantraD'), copy);
    await store.getState().refresh();
    expect(store.getState().vault?.entries.filter((entry) => entry.error?.includes('Duplicate'))).toHaveLength(2);
    expect(await fs.readFile(path.join(root, 'Copy.yantraD'), 'utf8')).toBe(copy);
    await expect(repo.deleteEntry('Copy.yantraD')).rejects.toThrow('Only valid');
  });

  it('does not erase a local draft when reload encounters unsupported content', async () => {
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    const loaded = store.getState().documents.get(id)!;
    store.getState().updateDocument(id, tiptapDocFromPlainText('Keep local'));
    const raw = JSON.stringify({ ...loaded.file, formatVersion: 99 });
    await fs.writeFile(path.join(root, loaded.path), raw);
    await expect(store.getState().flush()).rejects.toMatchObject({ failure: { code: 'conflict' } });
    await store.getState().resolveConflict('document', id, 'reload');
    expect(store.getState().documents.get(id)?.file.doc).toEqual(tiptapDocFromPlainText('Keep local'));
    expect(store.getState().conflicts.size).toBe(1);
    expect(await fs.readFile(path.join(root, loaded.path), 'utf8')).toBe(raw);
  });
});
