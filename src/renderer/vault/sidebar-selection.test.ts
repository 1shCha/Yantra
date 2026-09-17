import { describe, expect, it } from 'vitest';
import type { VaultTreeEntry } from '../vault-ui/VaultSidebar';
import { applySelectionGesture, collectVisibleSidebarRows, selectableVisiblePaths } from './sidebar-selection';

const entries: VaultTreeEntry[] = [
  { id: 'A', name: 'A', kind: 'folder', children: [
    { id: 'A/One', name: 'One.yantraD', kind: 'document' },
    { id: 'A/Two', name: 'Two.yantraD', kind: 'document' },
  ] },
  { id: 'Unfiled', name: 'Unfiled', kind: 'folder', children: [
    { id: 'Unfiled/Draft', name: 'Draft.yantraD', kind: 'document' },
  ] },
  { id: 'B', name: 'B.yantraC', kind: 'canvas', unavailable: true },
  { id: 'C', name: 'C.yantraD', kind: 'document' },
];

describe('sidebar selection', () => {
  it('collects visible rows and excludes root Unfiled and unavailable entries from range selection', () => {
    const rows = collectVisibleSidebarRows(entries, new Set(['A', 'Unfiled']));
    expect(rows.map((row) => row.path)).toEqual(['A', 'A/One', 'A/Two', 'Unfiled', 'Unfiled/Draft', 'B', 'C']);
    expect(selectableVisiblePaths(rows)).toEqual(['A', 'A/One', 'A/Two', 'Unfiled/Draft', 'C']);
  });

  it('applies shift range, additive toggle, and missing-anchor fallbacks', () => {
    const rows = collectVisibleSidebarRows(entries, new Set(['A', 'Unfiled']));
    expect([...applySelectionGesture(new Set(), null, { path: 'C', additive: false, range: false }, rows).paths]).toEqual(['C']);
    expect([...applySelectionGesture(new Set(['A/One']), 'A/One', { path: 'C', additive: false, range: true }, rows).paths])
      .toEqual(['A/One', 'A/Two', 'Unfiled/Draft', 'C']);
    const toggled = applySelectionGesture(new Set(['C']), 'C', { path: 'A/One', additive: true, range: false }, rows);
    expect([...toggled.paths]).toEqual(['C', 'A/One']);
    const addedRange = applySelectionGesture(new Set(['C']), 'C', { path: 'A/One', additive: true, range: true }, rows);
    expect([...addedRange.paths].sort()).toEqual(['A/One', 'A/Two', 'C', 'Unfiled/Draft'].sort());
  });
});
