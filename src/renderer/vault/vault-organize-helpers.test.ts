import { describe, expect, it } from 'vitest';
import type { VaultEntry } from '../../shared/vault-format';
import {
  canDropInto,
  entryTitle,
  expandedWithAncestors,
  friendlyOperationError,
  listFolders,
  locationLabel,
  movedPath,
  nameValidationError,
  parentFolderOf,
  renamedPath,
} from './vault-organize-helpers';

const tree: VaultEntry[] = [
  { path: 'Overview.yantraC', name: 'Overview.yantraC', kind: 'canvas' },
  { path: 'Research', name: 'Research', kind: 'folder', children: [
    { path: 'Research/Notes.yantraD', name: 'Notes.yantraD', kind: 'document' },
    { path: 'Research/Systems', name: 'Systems', kind: 'folder', children: [] },
  ] },
  { path: 'Projects', name: 'Projects', kind: 'folder', children: [] },
];

describe('path helpers', () => {
  it('derives parents, titles, and relocated paths', () => {
    expect(parentFolderOf('Research/Systems/Deep.yantraD')).toBe('Research/Systems');
    expect(parentFolderOf('Top.yantraD')).toBe('');
    expect(entryTitle('Notes.yantraD', 'document')).toBe('Notes');
    expect(entryTitle('Board.yantraC', 'canvas')).toBe('Board');
    expect(entryTitle('Research', 'folder')).toBe('Research');
    expect(movedPath('Research/Notes.yantraD', 'Projects')).toBe('Projects/Notes.yantraD');
    expect(movedPath('Research/Notes.yantraD', '')).toBe('Notes.yantraD');
    expect(renamedPath('Research/Notes.yantraD', 'document', 'Journal')).toBe('Research/Journal.yantraD');
    expect(renamedPath('Research', 'folder', 'Archive')).toBe('Archive');
  });

  it('lists folders depth-first with depths', () => {
    expect(listFolders(tree)).toEqual([
      { path: 'Research', name: 'Research', depth: 0 },
      { path: 'Research/Systems', name: 'Systems', depth: 1 },
      { path: 'Projects', name: 'Projects', depth: 0 },
    ]);
  });

  it('expands a folder together with its ancestors', () => {
    expect([...expandedWithAncestors(new Set(['Projects']), 'Research/Systems')].sort())
      .toEqual(['Projects', 'Research', 'Research/Systems']);
    expect([...expandedWithAncestors(new Set(), '')]).toEqual([]);
  });

  it('labels locations from the vault root', () => {
    expect(locationLabel('My vault', '')).toBe('My vault');
    expect(locationLabel('My vault', 'Research/Systems')).toBe('My vault / Research / Systems');
  });
});

describe('canDropInto', () => {
  it('rejects the current containing folder', () => {
    expect(canDropInto({ path: 'Research/Notes.yantraD', kind: 'document' }, 'Research')).toBe(false);
    expect(canDropInto({ path: 'Top.yantraD', kind: 'document' }, '')).toBe(false);
  });

  it('accepts other folders and the root for files', () => {
    expect(canDropInto({ path: 'Research/Notes.yantraD', kind: 'document' }, 'Projects')).toBe(true);
    expect(canDropInto({ path: 'Research/Notes.yantraD', kind: 'document' }, '')).toBe(true);
  });

  it('rejects moving a folder into itself or its descendants', () => {
    expect(canDropInto({ path: 'Research', kind: 'folder' }, 'Research')).toBe(false);
    expect(canDropInto({ path: 'Research', kind: 'folder' }, 'Research/Systems')).toBe(false);
    expect(canDropInto({ path: 'Research', kind: 'folder' }, 'Projects')).toBe(true);
    // A sibling with a shared name prefix is not a descendant.
    expect(canDropInto({ path: 'Research', kind: 'folder' }, 'Researching')).toBe(true);
  });
});

describe('name validation and error mapping', () => {
  it('flags empty and reserved names', () => {
    expect(nameValidationError('')).toBe('Enter a name.');
    expect(nameValidationError('   ')).toBe('Enter a name.');
    for (const name of ['a/b', 'ends.', 'Reading notes', ' Reading_notes', 'Reading_notes ', 'A\tB', 'café', 'a+b']) {
      expect(nameValidationError(name)).toMatch(/Use only letters/);
    }
    expect(nameValidationError('Reading_notes-2026')).toBeNull();
  });

  it('formats categories without inspecting error wording', () => {
    expect(friendlyOperationError({ code: 'collision', message: 'Different backend wording' }))
      .toBe('An item with this name already exists in this location.');
    expect(friendlyOperationError({ code: 'invalid-input', message: 'A folder cannot be moved inside itself.' }))
      .toBe('A folder cannot be moved inside itself.');
    expect(friendlyOperationError({ code: 'unknown', message: 'EEXIST is just text here.' })).toBe('EEXIST is just text here.');
  });
});
