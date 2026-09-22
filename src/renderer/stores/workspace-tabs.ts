import { z } from 'zod';
import type { VaultEntry, VaultSnapshot } from '../../shared/vault-format';

export interface WorkspaceTab {
  id: string;
  kind: 'document' | 'canvas';
  fileId: string;
  path: string;
  title: string;
}
export interface TabSession { tabs: WorkspaceTab[]; activeTabId: string | null }
export interface OpenTabOptions { replaceTabId?: string; provisionalTabId?: string }
export type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function fileEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === 'folder') return fileEntries(entry.children ?? []);
    if (entry.kind === 'canvas') return [entry, ...fileEntries(entry.children ?? [])];
    return [entry];
  });
}
export function tabForEntry(entry: VaultEntry): WorkspaceTab | undefined {
  const fileId = entry.kind === 'canvas' ? entry.canvasId : entry.documentId;
  if (entry.kind === 'folder') return;
  return { id: crypto.randomUUID(), kind: entry.kind, fileId: fileId ?? entry.path, path: entry.path,
    title: entry.name.replace(/\.yantra[DC]$/, '') };
}
export function openTab(session: TabSession, tab: WorkspaceTab, options: OpenTabOptions = {}): TabSession {
  const existing = session.tabs.find((item) => item.kind === tab.kind && item.fileId === tab.fileId);
  // Only the tab created by this click gesture may be folded into a replacement.
  if (existing && existing.id !== options.provisionalTabId) return { tabs: session.tabs, activeTabId: existing.id };
  const target = session.tabs.find((item) => item.id === options.replaceTabId);
  if (target) {
    const tabs = session.tabs.filter((item) => item.id !== options.provisionalTabId)
      .map((item) => item.id === target.id ? { ...tab, id: target.id } : item);
    return { tabs, activeTabId: target.id };
  }
  if (existing) return { tabs: session.tabs, activeTabId: existing.id };
  const index = session.tabs.findIndex((item) => item.id === session.activeTabId);
  const tabs = [...session.tabs];
  tabs.splice(index < 0 ? tabs.length : index + 1, 0, tab);
  return { tabs, activeTabId: tab.id };
}
export function reorderTab(session: TabSession, id: string, toIndex: number): TabSession {
  const from = session.tabs.findIndex((tab) => tab.id === id);
  if (from < 0 || toIndex < 0 || toIndex >= session.tabs.length || from === toIndex) return session;
  const tabs = session.tabs.slice();
  const [tab] = tabs.splice(from, 1);
  tabs.splice(toIndex, 0, tab!);
  return { tabs, activeTabId: session.activeTabId };
}
export function closeTab(session: TabSession, id: string): TabSession {
  const index = session.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return session;
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  return { tabs, activeTabId: session.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : session.activeTabId };
}
export function reconcileTabs(session: TabSession, vault: VaultSnapshot): TabSession {
  const entries = fileEntries(vault.entries);
  const seen = new Set<string>();
  const tabs = session.tabs.flatMap((tab) => {
    const entry = entries.find((entry) => tab.kind === entry.kind &&
      (tab.fileId === (entry.kind === 'canvas' ? entry.canvasId : entry.documentId) || tab.fileId === entry.path));
    if (!entry) return [];
    const key = `${tab.kind}:${tab.fileId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const title = entry.name.replace(/\.yantra[DC]$/, '');
    return [tab.path === entry.path && tab.title === title ? tab : { ...tab, path: entry.path, title }];
  });
  let activeTabId = session.activeTabId;
  if (activeTabId && !tabs.some((tab) => tab.id === activeTabId)) {
    const removedIndex = session.tabs.findIndex((tab) => tab.id === activeTabId);
    activeTabId = tabs[Math.min(removedIndex, tabs.length - 1)]?.id ?? null;
  }
  return { tabs, activeTabId };
}
const keyFor = (vault: VaultSnapshot) => `yantra:tabs:v1:${vault.metadata.id}:${vault.root}`;
export function readTabs(storage: TabStorage | undefined, vault: VaultSnapshot): TabSession {
  try {
    const session = z.object({
      tabs: z.array(z.object({ id: z.string(), kind: z.enum(['document', 'canvas']), fileId: z.string(), path: z.string(), title: z.string() })),
      activeTabId: z.string().nullable(),
    }).safeParse(JSON.parse(storage?.getItem(keyFor(vault)) ?? 'null'));
    if (session.success) return reconcileTabs(session.data, vault);
  } catch { /* Unavailable or malformed preferences must not prevent opening a vault. */ }
  return { tabs: [], activeTabId: null };
}
export function writeTabs(storage: TabStorage | undefined, vault: VaultSnapshot, session: TabSession) {
  try { storage?.setItem(keyFor(vault), JSON.stringify({ tabs: session.tabs, activeTabId: session.activeTabId })); }
  catch { /* File editing remains available if local preferences cannot be written. */ }
}
export function browserTabStorage(): TabStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
