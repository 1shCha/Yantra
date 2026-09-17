import { testVaultApi } from "../../test/vault-api";
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultOperations } from '../../shared/vault-api';
import { newDocument, type DocumentFile, type VaultSnapshot } from '../../shared/vault-format';
import { tiptapDocFromPlainText } from '../../shared/tiptap-document';
import { createVaultWorkspace } from './vaultWorkspace';
import { createVaultCanvasSession } from '../vault/vault-canvas-session';
import { newCanvas } from '../../shared/vault-canvas';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const a = newDocument('A');
  const b = newDocument('B');
  const vault: VaultSnapshot = {
    sessionId: 'session', root: '/vault', name: 'Vault',
    appearances: [],
    metadata: { formatVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
    entries: [a, b].map((file) => ({ path: `${file.title}.yantraD`, name: `${file.title}.yantraD`, documentId: file.id, kind: 'document' })),
  };
  const reads = new Map<string, ReturnType<typeof deferred<DocumentFile>>>();
  const writes: Array<{ sessionId: string; file: DocumentFile }> = [];
  let failSave = false;
  let choices = 0;
  const api: VaultOperations = {
    refresh: async () => vault, retryRecovery: async () => vault,
    deleteCanvasNodes: async () => { throw new Error('Not used by this test'); },
    deleteEntry: async () => { throw new Error('Not used by this test'); },
    createFolder: async (_session, folder, name) => ({ path: folder ? `${folder}/${name}` : name }),
    renameEntry: async () => { throw new Error('Not used by this test'); },
    moveEntry: async () => { throw new Error('Not used by this test'); },
    moveEntries: async () => ({ changes: [], unchanged: [] }),
    readCanvas: async () => { throw new Error('No test canvas'); },
    createCanvas: async () => ({ path: 'Untitled.yantraC', canvas: newCanvas('Untitled') }),
    saveCanvas: async () => ({ savedAt: new Date().toISOString() }),
    createNodeDocument: async () => ({ path: 'Unfiled/Untitled.yantraD', document: newDocument('Untitled') }),
    restore: async () => vault,
    choose: async () => { choices += 1; return { ...vault, sessionId: 'second-session' }; },
    readDocument: (_session, path) => {
      const result = deferred<DocumentFile>();
      reads.set(path, result);
      return result.promise;
    },
    createDocument: async () => ({ path: 'Untitled.yantraD', document: newDocument('Untitled') }),
    saveDocument: async (sessionId, file) => {
      if (failSave) throw new Error('Disk full');
      writes.push({ sessionId, file });
      return { savedAt: new Date().toISOString() };
    },
  };
  return { store: createVaultWorkspace(testVaultApi(api)), api, a, b, vault, reads, writes, fail: (value: boolean) => { failSave = value; }, choices: () => choices };
}

describe('vault workspace registry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('restores the vault without automatically opening a document', async () => {
    const { store, reads } = setup();
    await store.getState().restore();
    expect(store.getState().vault?.name).toBe('Vault');
    expect(store.getState().activeDocumentId).toBeNull();
    expect(reads.size).toBe(0);
  });

  it('ignores a late load when another document has been selected', async () => {
    const { store, a, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    const second = store.getState().openDocument('B.yantraD');
    reads.get('B.yantraD')!.resolve(b);
    expect((await second).status).toBe('success');
    reads.get('A.yantraD')!.resolve(a);
    expect(await first).toEqual({ status: 'cancelled', reason: 'superseded' });
    expect(store.getState().activeDocumentId).toBe(b.id);
    expect(store.getState().documents.size).toBe(2);
  });

  it('keeps dirty content while navigating and saves the correct document', async () => {
    const { store, a, b, reads, writes } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await first;
    const doc = tiptapDocFromPlainText('Unsaved A');
    store.getState().updateDocument(a.id, doc);
    const second = store.getState().openDocument('B.yantraD');
    reads.get('B.yantraD')!.resolve(b);
    await second;
    await store.getState().openDocument('A.yantraD');
    expect(store.getState().documents.get(a.id)?.file.doc).toEqual(doc);
    expect(store.getState().documents.get(a.id)?.save.state).toBe('dirty');
    await store.getState().flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.file.id).toBe(a.id);
    expect(writes[0]!.file.doc).toEqual(doc);
  });

  it('does not let a stale load failure replace the newer document view', async () => {
    const { store, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    const second = store.getState().openDocument('B.yantraD');
    reads.get('B.yantraD')!.resolve(b);
    await second;
    reads.get('A.yantraD')!.reject(new Error('Missing A'));
    await first;
    expect(store.getState().activeDocumentId).toBe(b.id);
    expect(store.getState().error).toBeNull();
  });

  it('reports a current read failure and permits a later open to retry', async () => {
    const { store, a, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.reject(new Error('Missing A'));
    await first;
    expect(store.getState().loadState).toBe('error');
    const retry = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await retry;
    expect(store.getState().loadState).toBe('ready');
  });

  it('blocks vault switching if unsaved documents cannot be flushed', async () => {
    const { store, fail, choices } = setup();
    await store.getState().restore();
    await store.getState().createDocument();
    const id = store.getState().activeDocumentId!;
    store.getState().updateDocument(id, tiptapDocFromPlainText('Keep this draft'));
    fail(true);
    await store.getState().choose(false);
    expect(choices()).toBe(0);
    expect(store.getState().vault?.sessionId).toBe('session');
    expect(store.getState().documents.get(id)?.save.state).toBe('error');
    fail(false);
    await store.getState().retry(id);
    await store.getState().choose(false);
    expect(store.getState().vault?.sessionId).toBe('second-session');
    expect(store.getState().activeDocumentId).toBeNull();
  });

  it('does not add an old vault load to a new vault registry', async () => {
    const { store, a, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    await store.getState().choose(false);
    reads.get('A.yantraD')!.resolve(a);
    await first;
    expect(store.getState().documents.size).toBe(0);
    expect(store.getState().activePath).toBeNull();
  });

  it('returns cancellation for the vault picker without replacing the workspace or reporting failure', async () => {
    const { store, api } = setup();
    await store.getState().restore();
    const before = store.getState().vault;
    api.choose = async () => null;
    expect(await store.getState().choose(false)).toEqual({ status: 'cancelled', reason: 'user' });
    expect(store.getState().vault).toBe(before);
    expect(store.getState().error).toBeNull();
  });

  it('returns typed failures for unavailable and busy commands', async () => {
    const { store, api } = setup();
    expect(await store.getState().createDocument()).toMatchObject({ status: 'failure', error: { code: 'no-vault' } });
    await store.getState().restore();
    const picker = deferred<VaultSnapshot | null>();
    api.choose = () => picker.promise;
    const pending = store.getState().choose(false);
    expect(await store.getState().createCanvas()).toMatchObject({ status: 'failure', error: { code: 'busy' } });
    picker.resolve(null);
    expect((await pending).status).toBe('cancelled');
  });

  it('keeps a later navigation selected when a document finishes creating', async () => {
    const { store, api, a, reads } = setup();
    await store.getState().restore();
    const create = deferred<{ path: string; document: DocumentFile }>();
    api.createDocument = () => create.promise;
    const pending = store.getState().createDocument();
    const opening = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await opening;
    const document = newDocument('New');
    create.resolve({ path: 'New.yantraD', document });
    expect(await pending).toEqual({ status: 'cancelled', reason: 'superseded' });
    expect(store.getState().activeDocumentId).toBe(a.id);
    expect(store.getState().documents.has(document.id)).toBe(true);
    expect(store.getState().vault!.entries.some((entry) => entry.documentId === document.id)).toBe(true);
  });

  it('queues rapid creations and opens only the latest requested document', async () => {
    const { store, api } = setup();
    await store.getState().restore();
    let index = 0;
    api.createDocument = async () => {
      const document = newDocument(`New_${++index}`);
      return { path: `${document.title}.yantraD`, document };
    };
    const first = store.getState().createDocument();
    const second = store.getState().createDocument();
    expect(store.getState().busy).toBe(false);
    expect((await first).status).toBe('cancelled');
    expect((await second).status).toBe('success');
    expect(store.getState().vault!.entries).toHaveLength(4);
    expect(store.getState().activePath).toBe('New_2.yantraD');
  });

  it('returns command success independently of a separate displayed error', async () => {
    const { store, api } = setup();
    await store.getState().restore();
    const create = deferred<{ path: string; document: DocumentFile }>();
    api.createDocument = () => create.promise;
    const pending = store.getState().createDocument();
    store.setState({ error: 'An unrelated notice' });
    create.resolve({ path: 'New.yantraD', document: newDocument('New') });
    expect(await pending).toEqual({ status: 'success', value: undefined });
    expect(store.getState().error).toBe('An unrelated notice');
  });

  it('returns invalid-input rather than rejecting an invalid creation command', async () => {
    const { store } = setup();
    await store.getState().restore();
    expect(await store.getState().createDocument('MissingFolder')).toMatchObject({ status: 'failure', error: { code: 'invalid-input' } });
    expect(await store.getState().createFolder('', 'Invalid name')).toMatchObject({ status: 'failure', error: { code: 'invalid-input' } });
    expect(store.getState().documents.size).toBe(0);
  });
});


describe('blank node auto-edit', () => {
  it('enters title edit mode after a blank node is created on the active canvas', async () => {
    const { store } = setup();
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      await store.getState().createCanvasNode(canvasId, { x: 400, y: 300 });
      const state = session.flow.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.selectedNodeIds).toEqual([state.nodes[0]!.id]);
      expect(state.editingNodeId).toBe(state.nodes[0]!.id);
      expect(store.getState().blankNodeEditTarget).toBeNull();
    } finally {
      disconnect();
    }
  });

  it('does not enter edit mode when placing an existing document', async () => {
    const { store, a, reads } = setup();
    await store.getState().restore();
    const opening = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await opening;
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      expect((await store.getState().placeDocument(canvasId, a.id, { x: 400, y: 300 })).status).toBe('success');
      const state = session.flow.getState();
      expect(state.editingNodeId).toBeNull();
      expect(store.getState().blankNodeEditTarget).toBeNull();
    } finally {
      disconnect();
    }
  });

  it('does not leave edit state when blank-node creation fails', async () => {
    const { store, api } = setup();
    api.createNodeDocument = async () => { throw new Error('Disk full'); };
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      expect((await store.getState().createCanvasNode(canvasId, { x: 400, y: 300 })).status).toBe('failure');
      expect(session.flow.getState().editingNodeId).toBeNull();
      expect(store.getState().blankNodeEditTarget).toBeNull();
    } finally {
      disconnect();
    }
  });

  it('switches title edit to the newest successfully created blank node', async () => {
    const { store, api } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.createNodeDocument;
    let calls = 0;
    api.createNodeDocument = async (...args) => {
      if (++calls === 1) await gate;
      return original(...args);
    };
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      const first = store.getState().createCanvasNode(canvasId, { x: 400, y: 300 });
      const second = store.getState().createCanvasNode(canvasId, { x: 800, y: 300 });
      release();
      expect((await first).status).toBe('success');
      expect((await second).status).toBe('success');
      const state = session.flow.getState();
      expect(state.nodes).toHaveLength(2);
      expect(state.editingNodeId).toBe(state.nodes[1]!.id);
      expect(state.selectedNodeIds).toEqual([state.nodes[1]!.id]);
    } finally {
      disconnect();
    }
  });

  it('skips auto-edit when the canvas is no longer active', async () => {
    const { store, a, reads } = setup();
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    const opening = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await opening;
    try {
      await store.getState().createCanvasNode(canvasId, { x: 400, y: 300 });
      expect(session.flow.getState().editingNodeId).toBeNull();
      expect(store.getState().blankNodeEditTarget).toBeNull();
    } finally {
      disconnect();
    }
  });
});

describe('canvas node render identity', () => {
  afterEach(() => vi.useRealTimers());
  it('preserves existing flow nodes when adding a node and replaces changed geometry', async () => {
    const { store } = setup();
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(canvasId, { x: 200, y: 200 });
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      const first = session.flow.getState().nodes[0]!;
      await store.getState().createCanvasNode(canvasId, { x: 600, y: 200 });
      expect(session.flow.getState().nodes).toHaveLength(2);
      expect(session.flow.getState().nodes[0]).toBe(first);
      const second = session.flow.getState().nodes[1]!;
      const file = store.getState().canvases.get(canvasId)!.file;
      store.getState().updateCanvas(canvasId, {
        edges: file.edges, groups: file.groups, layerOrder: file.layerOrder, viewport: file.viewport,
        nodes: file.nodes.map((node) => node.id === first.id ? { ...node, x: node.x + 50 } : node),
      });
      expect(session.flow.getState().nodes[0]).not.toBe(first);
      expect(session.flow.getState().nodes[0]!.position.x).toBe(first.position.x + 50);
      expect(session.flow.getState().nodes[1]).toBe(second);
      await store.getState().flush();
    } finally {
      disconnect();
    }
  });

  it('coalesces viewport movement, retains geometry, and flushes the final position', async () => {
    vi.useFakeTimers();
    const { store, api } = setup();
    const writes: ReturnType<typeof newCanvas>[] = [];
    api.saveCanvas = async (_session, file) => { writes.push(file); return { savedAt: new Date().toISOString() }; };
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      const before = store.getState().canvases.get(canvasId)!.file;
      const nodes = session.flow.getState().nodes;
      const revision = store.getState().canvases.get(canvasId)!.save.revision;
      session.setViewport({ x: 10, y: 0, zoom: 1 });
      session.setViewport({ x: 20, y: 4, zoom: 1 });
      session.setViewport({ x: 30, y: 8, zoom: 1 });
      expect(store.getState().canvases.get(canvasId)!.file).toBe(before);
      vi.advanceTimersByTime(100);
      const after = store.getState().canvases.get(canvasId)!;
      expect(after.file.viewport).toEqual({ x: 30, y: 8, zoom: 1 });
      expect(after.file.nodes).toBe(before.nodes);
      expect(after.file.edges).toBe(before.edges);
      expect(session.flow.getState().nodes).toBe(nodes);
      expect(after.save.revision).toBe(revision + 1);
      session.setViewport({ x: 40, y: 12, zoom: 1 });
      await store.getState().flush();
      expect(writes.at(-1)?.viewport).toEqual({ x: 40, y: 12, zoom: 1 });
      session.setViewport({ x: 50, y: 16, zoom: 1 });
    } finally { disconnect(); }
    await store.getState().flush();
    expect(writes.at(-1)?.viewport).toEqual({ x: 50, y: 16, zoom: 1 });
  });

  it('persists the final viewport after closing the tab and flushing', async () => {
    vi.useFakeTimers();
    const { store, api } = setup();
    const writes: ReturnType<typeof newCanvas>[] = [];
    api.saveCanvas = async (_session, file) => { writes.push(file); return { savedAt: new Date().toISOString() }; };
    await store.getState().restore();
    await store.getState().createCanvas();
    const canvasId = store.getState().activeCanvasId!;
    const tabId = store.getState().activeTabId!;
    const session = createVaultCanvasSession(store, canvasId);
    const disconnect = session.connect();
    try {
      session.setViewport({ x: 12, y: 24, zoom: 1.25 });
      vi.advanceTimersByTime(100);
      await store.getState().closeTab(tabId);
      await store.getState().flush();
      expect(store.getState().canvases.get(canvasId)?.file.viewport).toEqual({ x: 12, y: 24, zoom: 1.25 });
      expect(writes.at(-1)?.viewport).toEqual({ x: 12, y: 24, zoom: 1.25 });
    } finally { disconnect(); vi.useRealTimers(); }
  });
});

describe('workspace tabs', () => {
  it('reselecting the current tab cancels a pending creation redirect', async () => {
    const { store, api, a, reads } = setup();
    await store.getState().restore();
    const opening = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a);
    await opening;
    const selected = store.getState().activeTabId!;
    const created = deferred<{ path: string; canvas: ReturnType<typeof newCanvas> }>();
    api.createCanvas = () => created.promise;
    const creating = store.getState().createCanvas();
    await store.getState().activateTab(selected);
    created.resolve({ path: 'New.yantraC', canvas: newCanvas('New') });
    expect((await creating).status).toBe('cancelled');
    expect(store.getState().activeTabId).toBe(selected);
    expect(store.getState().tabs).toHaveLength(1);
  });
  async function cachedCanvasNavigation() {
    const { store, api, vault } = setup();
    const a = newCanvas('Canvas_A');
    const b = newCanvas('Canvas_B');
    const document = newDocument('Referenced');
    b.nodes.push({ id: crypto.randomUUID(), kind: 'document', documentId: document.id, x: 0, y: 0, width: 320, height: 220 });
    b.layerOrder.push(b.nodes[0]!.id);
    vault.entries.push(
      { kind: 'canvas', path: 'A.yantraC', name: 'A.yantraC', canvasId: a.id },
      { kind: 'canvas', path: 'B.yantraC', name: 'B.yantraC', canvasId: b.id },
      { kind: 'document', path: 'Referenced.yantraD', name: 'Referenced.yantraD', documentId: document.id },
    );
    api.readCanvas = async (_session, path) => path === 'A.yantraC' ? a : b;
    const pending = deferred<DocumentFile>();
    let reads = 0;
    api.readDocument = () => ++reads === 1 ? Promise.reject(new Error('Try again')) : pending.promise;
    await store.getState().restore();
    await store.getState().openCanvas('A.yantraC');
    const aTab = store.getState().activeTabId!;
    await store.getState().openCanvas('B.yantraC');
    const bTab = store.getState().activeTabId!;
    await store.getState().activateTab(aTab);
    return { store, a, b, document, aTab, bTab, pending };
  }

  it('keeps a reselected canvas active when an older canvas load finishes', async () => {
    const { store, document, aTab, bTab, pending } = await cachedCanvasNavigation();
    const loading = store.getState().activateTab(bTab);
    expect(store.getState().activeTabId).toBe(bTab);
    expect(store.getState().loadState).toBe('ready');
    await store.getState().activateTab(aTab);
    pending.resolve(document);
    expect((await loading).status).toBe('cancelled');
    expect(store.getState().activeTabId).toBe(aTab);
  });

  it('does not reopen a cached canvas closed while its document loads', async () => {
    const { store, document, aTab, bTab, pending } = await cachedCanvasNavigation();
    const loading = store.getState().activateTab(bTab);
    await store.getState().closeTab(bTab);
    pending.resolve(document);
    expect((await loading).status).toBe('cancelled');
    expect(store.getState().activeTabId).toBe(aTab);
    expect(store.getState().tabs.some((tab) => tab.id === bTab)).toBe(false);
  });
  it('focuses existing files and folds a double-click into the original active slot', async () => {
    const { store, a, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD');
    reads.get('A.yantraD')!.resolve(a); await first;
    const original = store.getState().activeTabId!;
    const second = store.getState().openDocument('B.yantraD');
    const provisional = store.getState().activeTabId!;
    reads.get('B.yantraD')!.resolve(b); await second;
    await store.getState().openDocument('B.yantraD', { replaceTabId: original, provisionalTabId: provisional });
    expect(store.getState().tabs.map((tab) => [tab.id, tab.fileId])).toEqual([[original, b.id]]);
    await store.getState().openDocument('B.yantraD');
    expect(store.getState().tabs).toHaveLength(1);
    expect(store.getState().activeTabId).toBe(original);
  });

  it('gives an already-open file precedence over replacement', async () => {
    const { store, a, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD'); reads.get('A.yantraD')!.resolve(a); await first;
    const firstId = store.getState().activeTabId!;
    const second = store.getState().openDocument('B.yantraD'); reads.get('B.yantraD')!.resolve(b); await second;
    await store.getState().openDocument('A.yantraD', { replaceTabId: store.getState().activeTabId! });
    expect(store.getState().tabs).toHaveLength(2);
    expect(store.getState().activeTabId).toBe(firstId);
  });

  it('does not reopen a tab when its pending read finishes after closing', async () => {
    const { store, a, reads } = setup();
    await store.getState().restore();
    const pending = store.getState().openDocument('A.yantraD');
    await store.getState().closeTab(store.getState().activeTabId!);
    reads.get('A.yantraD')!.resolve(a); await pending;
    expect(store.getState().tabs).toHaveLength(0);
    expect(store.getState().activeDocumentId).toBeNull();
    expect(store.getState().loadState).toBe('idle');
  });

  it('retains and saves dirty documents after their tabs close', async () => {
    const { store, a, reads, writes } = setup();
    await store.getState().restore();
    const pending = store.getState().openDocument('A.yantraD'); reads.get('A.yantraD')!.resolve(a); await pending;
    const doc = tiptapDocFromPlainText('Saved after closing');
    store.getState().updateDocument(a.id, doc);
    await store.getState().closeTab(store.getState().activeTabId!);
    await store.getState().flush();
    expect(writes.at(-1)?.file.doc).toEqual(doc);
  });

  it('restores tab order and active file from preferences with a new session', async () => {
    const { api, vault, a, b } = setup();
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    api.readDocument = async (_session, path) => path === 'A.yantraD' ? a : b;
    const first = createVaultWorkspace(testVaultApi(api), storage);
    await first.getState().restore();
    await first.getState().openDocument('A.yantraD');
    await first.getState().openDocument('B.yantraD');
    await first.getState().activateTab(first.getState().tabs[0]!.id);
    api.restore = async () => ({ ...vault, sessionId: 'fresh-session' });
    const restored = createVaultWorkspace(testVaultApi(api), storage);
    await restored.getState().restore();
    expect(restored.getState().tabs.map((tab) => tab.fileId)).toEqual([a.id, b.id]);
    expect(restored.getState().activeDocumentId).toBe(a.id);
    expect(restored.getState().documents.has(b.id)).toBe(false);
    await restored.getState().closeTab(restored.getState().activeTabId!);
    expect(restored.getState().activeDocumentId).toBe(b.id);
    await restored.getState().closeTab(restored.getState().activeTabId!);
    const empty = createVaultWorkspace(testVaultApi(api), storage);
    await empty.getState().restore();
    expect(empty.getState().tabs).toHaveLength(0);
  });

  it('reconciles renamed and deleted files by identity on refresh', async () => {
    const { api, store, vault, a, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD'); reads.get('A.yantraD')!.resolve(a); await first;
    const second = store.getState().openDocument('B.yantraD'); reads.get('B.yantraD')!.resolve(b); await second;
    api.refresh = async () => ({ ...vault, entries: [{ kind: 'document', path: 'Moved.yantraD', name: 'Moved.yantraD', documentId: a.id }] });
    api.readDocument = async () => ({ ...a, title: 'Moved' });
    await store.getState().refresh();
    expect(store.getState().tabs.map((tab) => [tab.fileId, tab.path, tab.title])).toEqual([[a.id, 'Moved.yantraD', 'Moved']]);
    expect(store.getState().activeDocumentId).toBe(a.id);
  });
});

describe('rename render identity', () => {
  it('retains unrelated resources and the document editor revision on a title rename', async () => {
    const { store, api, a, b, reads } = setup();
    await store.getState().restore();
    const first = store.getState().openDocument('A.yantraD'); reads.get('A.yantraD')!.resolve(a); await first;
    const second = store.getState().openDocument('B.yantraD'); reads.get('B.yantraD')!.resolve(b); await second;
    const before = store.getState();
    api.renameEntry = async () => ({ from: 'A.yantraD', to: 'Renamed.yantraD', document: {
      ...structuredClone(a), title: 'Renamed', doc: { ...a.doc, content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Renamed' }] }, ...(a.doc.content?.slice(1) ?? [])] },
    } });
    expect((await store.getState().renameEntry('A.yantraD', 'Renamed', 'Renamed')).status).toBe('success');
    const after = store.getState();
    expect(after.documents.get(a.id)?.reloadRevision).toBe(before.documents.get(a.id)?.reloadRevision);
    expect(after.documents.get(b.id)).toBe(before.documents.get(b.id));
    expect(after.canvases).toBe(before.canvases);
    expect(after.vault?.appearances).toBe(before.vault?.appearances);
    expect(after.tabs.find((tab) => tab.fileId === b.id)).toBe(before.tabs.find((tab) => tab.fileId === b.id));
    expect(after.vault?.entries.find((entry) => entry.documentId === b.id)).toBe(before.vault?.entries.find((entry) => entry.documentId === b.id));
  });

  it('does not publish a flow update when renaming a canvas', async () => {
    const { store, api } = setup();
    await store.getState().restore();
    await store.getState().createCanvas();
    const id = store.getState().activeCanvasId!;
    await store.getState().createCanvasNode(id, { x: 100, y: 100 });
    const session = createVaultCanvasSession(store, id);
    const disconnect = session.connect();
    const updates = vi.fn();
    const unsubscribe = session.flow.subscribe(updates);
    const before = store.getState();
    const canvas = before.canvases.get(id)!;
    const geometry = session.flow.getState();
    api.renameEntry = async () => ({ from: canvas.path, to: 'Renamed.yantraC', canvas: { ...structuredClone(canvas.file), title: 'Renamed' } });
    try {
      expect((await store.getState().renameEntry(canvas.path, 'Renamed')).status).toBe('success');
      expect(store.getState().canvases.get(id)?.file.title).toBe('Renamed');
      expect(store.getState().documents).toBe(before.documents);
      expect(session.flow.getState()).toBe(geometry);
      expect(updates).not.toHaveBeenCalled();
    } finally { unsubscribe(); disconnect(); }
  });
});
