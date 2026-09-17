import { describe, expect, it } from 'vitest';
import { newDocument, type VaultSnapshot } from '../../shared/vault-format';
import { readTabs, reorderTab, writeTabs, tabForEntry, type TabStorage } from './workspace-tabs';

const document = newDocument('Notes');
const vault: VaultSnapshot = { sessionId: 'first', root: '/vault', name: 'Vault', appearances: [],
  metadata: { id: crypto.randomUUID(), formatVersion: 1, createdAt: new Date().toISOString() },
  entries: [{ kind: 'document', documentId: document.id, path: 'Notes.yantraD', name: 'Notes.yantraD' }],
};
const tab = tabForEntry(vault.entries[0]!)!;

describe('tab session preferences', () => {
  it('isolates vaults and restores by stable identity after moving a file', () => {
    const values = new Map<string, string>();
    const storage: TabStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
    writeTabs(storage, vault, { tabs: [tab], activeTabId: tab.id });
    expect(readTabs(storage, { ...vault, metadata: { ...vault.metadata, id: crypto.randomUUID() } }).tabs).toEqual([]);
    const moved = readTabs(storage, { ...vault, sessionId: 'second', entries: [
      { kind: 'folder', path: 'Folder', name: 'Folder', children: [{ ...vault.entries[0]!, path: 'Folder/Renamed.yantraD', name: 'Renamed.yantraD' }] },
    ] });
    expect(moved.tabs).toEqual([{ ...tab, path: 'Folder/Renamed.yantraD', title: 'Renamed' }]);
    expect(moved.activeTabId).toBe(tab.id);
  });

  it('prunes deleted files and handles unavailable or malformed preferences', () => {
    expect(readTabs({ getItem: () => '{broken', setItem: () => {} }, vault).tabs).toEqual([]);
    expect(readTabs({ getItem: () => JSON.stringify({ tabs: [{ id: 1 }], activeTabId: null }), setItem: () => {} }, vault).tabs).toEqual([]);
    const unavailable = { getItem: () => { throw new Error('Storage disabled'); }, setItem: () => { throw new Error('Storage disabled'); } };
    expect(readTabs(unavailable, vault).tabs).toEqual([]);
    expect(() => writeTabs(unavailable, vault, { tabs: [tab], activeTabId: tab.id })).not.toThrow();
    const missing = readTabs({ getItem: () => JSON.stringify({ tabs: [tab], activeTabId: tab.id }), setItem: () => {} }, { ...vault, entries: [] });
    expect(missing).toEqual({ tabs: [], activeTabId: null });
  });

  it('moves a tab without changing its identity or the active tab', () => {
    const second = { ...tab, id: 'other', fileId: 'other', path: 'Other.yantraD', title: 'Other' };
    const session = { tabs: [tab, second], activeTabId: tab.id };
    expect(reorderTab(session, tab.id, 1).tabs.map((item) => item.id)).toEqual(['other', tab.id]);
    expect(reorderTab(session, tab.id, 1).tabs[1]).toBe(tab);
    expect(reorderTab(session, tab.id, 1).activeTabId).toBe(tab.id);
    expect(reorderTab(session, tab.id, 0)).toBe(session);
    expect(reorderTab(session, 'missing', 1)).toBe(session);
    const values = new Map<string, string>();
    const storage: TabStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
    const reordered = reorderTab(session, tab.id, 1);
    const both: VaultSnapshot = { ...vault, entries: [...vault.entries, { kind: 'document', documentId: 'other', path: 'Other.yantraD', name: 'Other.yantraD' }] };
    writeTabs(storage, both, reordered);
    expect(readTabs(storage, both).tabs.map((item) => item.id)).toEqual(['other', tab.id]);
    expect(readTabs(storage, both).activeTabId).toBe(tab.id);
  });
});
