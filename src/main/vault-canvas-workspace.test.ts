import { testVaultApi } from "../test/vault-api";
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultRepository } from './vault-repository';
import type { VaultOperations } from '../shared/vault-api';
import { type CanvasFile, type CanvasPresentation } from '../shared/vault-canvas';
import { tiptapDocFromPlainText } from '../shared/tiptap-document';
import { createVaultWorkspace } from '../renderer/stores/vaultWorkspace';
import { createVaultCanvasSession } from '../renderer/vault/vault-canvas-session';

function presentation(file: CanvasFile): CanvasPresentation {
  const { nodes, edges, groups, layerOrder, viewport } = file;
  return { nodes, edges, groups, layerOrder, viewport };
}

describe('vault canvas registry', () => {
  let root: string;
  let repo: VaultRepository;
  let api: VaultOperations;
  let store: ReturnType<typeof createVaultWorkspace>;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-canvas-registry-'));
    repo = await VaultRepository.open(root, true);
    api = {
      deleteCanvasNodes: (_session, canvasId, nodeIds) => repo.deleteCanvasNodes(canvasId, nodeIds),
      refresh: () => repo.refresh(), deleteEntry: (_session, relative) => repo.deleteEntry(relative), retryRecovery: () => repo.retryRecovery(),
      createFolder: (_session, folder, name) => repo.createFolder(folder, name),
      renameEntry: (_session, relative, name, title) => repo.renameEntry(relative, name, title),
      moveEntry: (_session, relative, folder) => repo.moveEntry(relative, folder),
      restore: () => repo.scan(), choose: async () => null,
      readDocument: (_session, relative, mode) => repo.readDocument(relative, mode),
      createDocument: (_session, folder) => repo.createDocument(folder),
      saveDocument: (_session, document) => repo.saveDocument(document),
      readCanvas: (_session, relative, mode) => repo.readCanvas(relative, mode),
      createCanvas: (_session, folder) => repo.createCanvas(folder),
      saveCanvas: (_session, canvas) => repo.saveCanvas(canvas),
      createNodeDocument: () => repo.createNodeDocument(),
    };
    store = createVaultWorkspace(testVaultApi(api));
    await store.getState().restore();
  });
  afterEach(async () => {
    await store.getState().flush().catch(() => { /* Failed drafts are intentional in failure tests. */ });
    await fs.rm(root, { recursive: true, force: true });
  });

  async function createNode() {
    await store.getState().createCanvas();
    const id = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(id, { x: 500, y: 400 });
    return id;
  }

  it('creates a durable Unfiled document before writing its canvas reference', async () => {
    const order: string[] = [];
    api.createNodeDocument = async () => {
      const result = await repo.createNodeDocument();
      order.push('document');
      return result;
    };
    api.saveCanvas = async (_session, canvas) => {
      expect(await fs.readFile(path.join(root, 'Unfiled/Untitled.yantraD'), 'utf8')).toContain(canvas.nodes[0]!.documentId);
      order.push('canvas');
      return repo.saveCanvas(canvas);
    };
    const id = await createNode();
    expect(order).toEqual(['document', 'canvas']);
    const loaded = store.getState().canvases.get(id)!;
    expect(loaded.file.nodes[0]!.id).not.toBe(loaded.file.nodes[0]!.documentId);
    expect(loaded.file.nodes[0]).toMatchObject({ x: 340, y: 290, width: 320, height: 220 });
    expect(loaded.save.state).toBe('clean');
    expect(store.getState().vault?.entries.find((entry) => entry.path === 'Unfiled')?.children).toHaveLength(1);
  });

  it('keeps editing live during queued creations and commits the latest canvas without losing changes', async () => {
    const id = await createNode();
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    const first = store.getState().canvases.get(id)!.file.nodes[0]!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.createNodeDocument;
    let calls = 0;
    api.createNodeDocument = async (...args) => { if (++calls === 1) await gate; return original(...args); };
    const adding = store.getState().createCanvasNode(id, { x: 700, y: 500 });
    const queued = store.getState().createCanvasNode(id, { x: 1100, y: 500 });
    await Promise.resolve();
    expect(store.getState().busy).toBe(false);
    session.flow.getState().setNodePosition(first.id, { x: 80, y: 100 });
    store.getState().updateDocument(first.documentId, tiptapDocFromPlainText('Edited while creating'));
    let closed = false;
    const closing = store.getState().flush().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    expect((await adding).status).toBe('success');
    expect((await queued).status).toBe('success');
    await closing;
    expect(calls).toBe(2);
    const canvas = await repo.readCanvas('Untitled.yantraC');
    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.nodes[0]).toMatchObject({ id: first.id, x: 80, y: 100 });
    expect((await repo.readDocument('Unfiled/Untitled.yantraD')).doc).toEqual(tiptapDocFromPlainText('Edited while creating'));
    disconnect();
  });

  it('publishes a complete addition and changes selection without replacing unrelated nodes or edges', async () => {
    const id = await createNode();
    await store.getState().createCanvasNode(id, { x: 800, y: 400 });
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    const first = session.flow.getState().nodes[0]!;
    session.flow.getState().selectNode(session.flow.getState().nodes[1]!.id);
    const before = session.flow.getState();
    const stop = store.subscribe((state) => {
      for (const node of state.canvases.get(id)!.file.nodes) {
        expect(state.documents.has(node.documentId)).toBe(true);
        expect(state.vault!.entries.find((entry) => entry.path === 'Unfiled')!.children!.some((entry) => entry.documentId === node.documentId)).toBe(true);
      }
    });
    expect((await store.getState().createCanvasNode(id, { x: 1200, y: 400 })).status).toBe('success');
    const after = session.flow.getState();
    expect(after.nodes[0]).toBe(first);
    expect(after.edges).toBe(before.edges);
    expect(after.nodes[1]?.selected).toBe(false);
    expect(after.selectedNodeIds).toEqual([after.nodes[2]!.id]);
    stop(); disconnect();
  });

  it('uses the same working document in node and standalone presentations, including unsaved edits', async () => {
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    const node = loaded.file.nodes[0]!;
    store.getState().updateDocument(node.documentId, tiptapDocFromPlainText('From canvas'));
    await store.getState().openNodeDocument(id, node.id);
    expect(store.getState().activeDocumentId).toBe(node.documentId);
    expect(store.getState().activeCanvasId).toBeNull();
    store.getState().updateDocument(node.documentId, tiptapDocFromPlainText('From standalone editor'));
    await store.getState().openCanvas(loaded.path);
    expect(store.getState().activeDocumentId).toBeNull();
    expect(store.getState().documents.get(node.documentId)?.file.doc).toEqual(tiptapDocFromPlainText('From standalone editor'));
    expect(store.getState().canvases.get(id)?.save.revision).toBe(1);
    await store.getState().flush();
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    expect(reopened.getState().activeCanvasId).toBeNull();
    await reopened.getState().openCanvas(loaded.path);
    expect(reopened.getState().documents.get(node.documentId)?.file.doc).toEqual(tiptapDocFromPlainText('From standalone editor'));
  });

  it('retains layout, edges, explicit groups, stacking, and viewport across canvas switching and restart', async () => {
    const id = await createNode();
    await store.getState().createCanvasNode(id, { x: 900, y: 400 });
    const loaded = store.getState().canvases.get(id)!;
    const nodes = loaded.file.nodes.map((node) => ({ ...node, width: 500, color: '#fff' }));
    const group = { id: crypto.randomUUID(), nodeIds: nodes.map((node) => node.id) };
    const layout: CanvasPresentation = { nodes, groups: [group], layerOrder: [group.id],
      edges: [{ id: 'relationship', fromNode: nodes[0]!.id, toNode: nodes[1]!.id, label: 'supports' }],
      viewport: { x: -50, y: 80, zoom: 0.8 } };
    store.getState().updateCanvas(id, layout);
    await store.getState().createCanvas();
    await store.getState().openCanvas(loaded.path);
    expect(presentation(store.getState().canvases.get(id)!.file)).toEqual(layout);
    await store.getState().flush();
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    await reopened.getState().openCanvas(loaded.path);
    expect(presentation(reopened.getState().canvases.get(id)!.file)).toEqual(layout);
  });

  it('does not create a node when document creation fails', async () => {
    api.createNodeDocument = async () => { throw new Error('Cannot create document'); };
    const id = await createNode();
    expect(store.getState().canvases.get(id)?.file.nodes).toEqual([]);
    expect(store.getState().documents.size).toBe(0);
    expect(store.getState().error).toContain('Cannot create document');
  });

  it('retains the standalone document and retryable canvas draft if canvas saving fails', async () => {
    api.saveCanvas = async () => { throw new Error('Canvas write failed'); };
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    expect(loaded.save.state).toBe('error');
    expect((await repo.readCanvas(loaded.path)).nodes).toEqual([]);
    expect(await repo.readDocument('Unfiled/Untitled.yantraD')).toBeDefined();
    await store.getState().choose(false);
    expect(store.getState().error).toContain('Canvas write failed');
    api.saveCanvas = (_session, file) => repo.saveCanvas(file);
    await store.getState().retryCanvas(id);
    expect((await repo.readCanvas(loaded.path)).nodes).toEqual(loaded.file.nodes);
  });

  it('retains missing-document nodes and reports an error per reference', async () => {
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    const documentId = loaded.file.nodes[0]!.documentId;
    await fs.unlink(path.join(root, 'Unfiled/Untitled.yantraD'));
    const reopened = createVaultWorkspace(testVaultApi(api));
    await reopened.getState().restore();
    await reopened.getState().openCanvas(loaded.path);
    expect(reopened.getState().loadState).toBe('ready');
    expect(reopened.getState().canvases.get(id)?.file.nodes).toEqual(loaded.file.nodes);
    expect(reopened.getState().canvases.get(id)?.documentErrors.get(documentId)).toContain('missing');
    expect(reopened.getState().documents.has(documentId)).toBe(false);
  });

  it('does not let a late canvas load replace a newer document selection', async () => {
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    let release!: (file: CanvasFile) => void;
    api.readCanvas = () => new Promise((resolve) => { release = resolve; });
    const next = createVaultWorkspace(testVaultApi(api));
    await next.getState().restore();
    const pending = next.getState().openCanvas(loaded.path);
    await next.getState().openDocument('Unfiled/Untitled.yantraD');
    release(loaded.file);
    await pending;
    expect(next.getState().activeCanvasId).toBeNull();
    expect(next.getState().activeDocumentId).toBe(loaded.file.nodes[0]!.documentId);
  });

  it('rejects a second appearance in another loaded canvas', async () => {
    const first = await createNode();
    const loaded = store.getState().canvases.get(first)!;
    await store.getState().createCanvas();
    const second = store.getState().activeCanvasId!;
    expect(() => store.getState().updateCanvas(second, presentation(loaded.file))).toThrow('only one canvas');
    expect(store.getState().canvases.get(second)?.file.nodes).toEqual([]);
  });

  it('publishes only persisted canvas changes and keeps unchanged arrays stable', async () => {
    const id = await createNode();
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    const update = vi.spyOn(store.getState(), 'updateCanvas');
    try {
      const node = session.flow.getState().nodes[0]!;
      const original = store.getState().canvases.get(id)!.file;
      session.flow.getState().selectNode(node.id);
      session.flow.getState().editNode(node.id);
      session.flow.getState().clearSelection();
      session.setViewport({ ...original.viewport });
      expect(update).not.toHaveBeenCalled();
      expect(store.getState().canvases.get(id)!.file).toBe(original);

      session.setViewport({ x: 25, y: 30, zoom: 0.8 });
      expect(update).toHaveBeenCalledTimes(1);
      const panned = store.getState().canvases.get(id)!.file;
      expect(panned.nodes).toBe(original.nodes);
      expect(panned.edges).toBe(original.edges);
      expect(panned.groups).toBe(original.groups);
      expect(panned.layerOrder).toBe(original.layerOrder);

      session.flow.getState().setNodeGeometry(node.id, { x: 100, y: 120, width: 450, height: 350 });
      expect(update).toHaveBeenCalledTimes(2);
      const resized = store.getState().canvases.get(id)!.file;
      expect(resized.nodes[0]).toMatchObject({ x: 100, y: 120, width: 450, height: 350 });
      expect(resized.viewport).toBe(panned.viewport);
      expect(resized.edges).toBe(original.edges);
      await store.getState().flush();
      expect((await repo.readCanvas(store.getState().canvases.get(id)!.path)).nodes).toEqual(resized.nodes);
    } finally { update.mockRestore(); disconnect(); }
  });

  it('keeps canvas interaction state content-free', async () => {
    const id = await createNode();
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    try {
      const node = session.flow.getState().nodes[0]!;
      const revision = store.getState().canvases.get(id)!.save.revision;
      session.flow.getState().selectNode(node.id);
      expect(store.getState().canvases.get(id)!.save.revision).toBe(revision);
      session.flow.getState().updateNodeDoc(node.id, tiptapDocFromPlainText('Shared content'));
      expect(session.flow.getState().nodes[0]!.data.doc).toBeUndefined();
      expect(store.getState().documents.get(node.data.documentId!)?.file.doc).toEqual(tiptapDocFromPlainText('Shared content'));
      session.flow.getState().setNodeGeometry(node.id, { x: 300, y: 400, width: 580, height: 360 });
      session.setViewport({ x: 40, y: 60, zoom: 0.8 });
      await store.getState().flush();
      expect(store.getState().canvases.get(id)?.file.nodes[0]).toMatchObject({ x: 300, y: 400, width: 580, height: 360 });
      expect(store.getState().canvases.get(id)?.file.viewport).toEqual({ x: 40, y: 60, zoom: 0.8 });

    } finally { disconnect(); }
  });

  it('adds and selects a new reference without opening its editor or overwriting saved geometry', async () => {
    const id = await createNode();
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    try {
      const first = session.flow.getState().nodes[0]!;
      session.flow.getState().setNodeGeometry(first.id, { x: 200, y: 100, width: 640, height: 300 });
      await store.getState().createCanvasNode(id, { x: 900, y: 400 });
      const state = session.flow.getState();
      expect(state.nodes).toHaveLength(2);
      expect(state.nodes[0]!.width).toBe(640);
      expect(state.selectedNodeIds).toEqual([state.nodes[1]!.id]);
      expect(state.editingNodeId).toBeNull();
      expect(state.nodes.every((node) => node.data.doc === undefined)).toBe(true);
    } finally { disconnect(); }
  });

  it('saves the latest layout when an edit arrives during a pending write', async () => {
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const positions: number[] = [];
    api.saveCanvas = async (_session, file) => {
      positions.push(file.nodes[0]!.x);
      started();
      await gate;
      return repo.saveCanvas(file);
    };
    const initial = presentation(loaded.file);
    store.getState().updateCanvas(id, { ...initial, nodes: initial.nodes.map((node) => ({ ...node, x: 600 })) });
    const flushing = store.getState().flush();
    await writing;
    store.getState().updateCanvas(id, { ...initial, nodes: initial.nodes.map((node) => ({ ...node, x: 800 })) });
    release();
    await flushing;
    expect(positions).toEqual([600, 800]);
    expect((await repo.readCanvas(loaded.path)).nodes[0]!.x).toBe(800);
    expect(store.getState().canvases.get(id)?.save.state).toBe('clean');
  });

  it('discards a late old-vault canvas load after changing vaults', async () => {
    const id = await createNode();
    const loaded = store.getState().canvases.get(id)!;
    let release!: (file: CanvasFile) => void;
    api.readCanvas = () => new Promise((resolve) => { release = resolve; });
    const otherRoot = path.join(root, 'Other vault');
    await fs.mkdir(otherRoot);
    const other = await VaultRepository.open(otherRoot, true);
    api.choose = () => other.scan();
    const next = createVaultWorkspace(testVaultApi(api));
    await next.getState().restore();
    const pending = next.getState().openCanvas(loaded.path);
    await next.getState().choose(false);
    release(loaded.file);
    await pending;
    expect(next.getState().vault?.sessionId).toBe(other.sessionId);
    expect(next.getState().canvases.size).toBe(0);
    expect(next.getState().documents.size).toBe(0);
    expect(next.getState().activeCanvasId).toBeNull();
  });
});
