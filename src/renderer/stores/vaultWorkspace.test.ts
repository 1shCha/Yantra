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


describe('canvas node render identity', () => {
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
});
