import { expect, it } from 'vitest';
import type { VaultEntry } from './vault-format';
import { relocateEntries } from './vault-organization';

it('preserves unrelated expanded branches during rename and move', () => {
  const untouched: VaultEntry = { kind: 'folder', path: 'Other', name: 'Other', children: [{ kind: 'document', path: 'Other/Note.yantraD', name: 'Note.yantraD' }] };
  const changed: VaultEntry = { kind: 'folder', path: 'Work', name: 'Work', children: [{
    kind: 'canvas', path: 'Work/Canvas', name: 'Canvas',
    children: [{ kind: 'document', path: 'Work/Canvas/Note.yantraD', name: 'Note.yantraD' }],
  }] };
  const renamed = relocateEntries([untouched, changed], 'Work/Canvas', 'Work/Renamed');
  expect(renamed.find((entry) => entry.path === 'Other')).toBe(untouched);
  expect(renamed.find((entry) => entry.path === 'Work')?.children?.[0]?.path).toBe('Work/Renamed');
  expect(renamed.find((entry) => entry.path === 'Work')?.children?.[0]?.children?.[0]?.path).toBe('Work/Renamed/Note.yantraD');
  const moved = relocateEntries([untouched, changed], 'Work', 'Renamed');
  expect(moved.find((entry) => entry.path === 'Other')).toBe(untouched);
  expect(moved.find((entry) => entry.path === 'Renamed')?.children?.[0]?.path).toBe('Renamed/Canvas');
});
