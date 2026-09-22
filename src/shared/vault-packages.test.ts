import { describe, expect, it } from 'vitest';
import { newCanvas } from './vault-canvas';
import {
  CANVAS_NODE_DEFAULT_HEIGHT,
  CANVAS_NODE_DEFAULT_WIDTH,
  assertPresentationOnlySave,
  canvasNodePlacement,
  collectPackagePaths,
  findVaultEntry,
  isContainerKind,
  isOrdinaryFolder,
  membershipKey,
  owningPackagePath,
  packageDocumentIdsEqual,
  packageLayoutPath,
  packagePathFromLayout,
} from './vault-packages';

describe('package path helpers', () => {
  it('resolves a public package path to its hidden layout file', () => {
    expect(packageLayoutPath('Research/Planning')).toBe('Research/Planning/Planning.yantraC');
    expect(packageLayoutPath('Untitled')).toBe('Untitled/Untitled.yantraC');
    expect(packagePathFromLayout('Research/Planning/Planning.yantraC')).toBe('Research/Planning');
  });

  it('treats folders and packages as containers', () => {
    expect(isContainerKind('folder')).toBe(true);
    expect(isContainerKind('canvas')).toBe(true);
    expect(isContainerKind('document')).toBe(false);
    expect(isOrdinaryFolder({ kind: 'folder' })).toBe(true);
    expect(isOrdinaryFolder({ kind: 'canvas' })).toBe(false);
  });

  it('finds entries and owning packages without treating every directory as a package', () => {
    const entries = [
      { path: 'Research', name: 'Research', kind: 'folder' as const, children: [
        { path: 'Research/Planning', name: 'Planning', kind: 'canvas' as const, canvasId: 'c1', children: [
          { path: 'Research/Planning/Goals.yantraD', name: 'Goals.yantraD', kind: 'document' as const, documentId: 'd1' },
        ] },
        { path: 'Research/Notes.yantraD', name: 'Notes.yantraD', kind: 'document' as const, documentId: 'd2' },
      ] },
    ];
    expect(findVaultEntry(entries, 'Research/Planning')?.kind).toBe('canvas');
    const packages = collectPackagePaths(entries);
    expect(owningPackagePath('Research/Planning/Goals.yantraD', packages)).toBe('Research/Planning');
    expect(owningPackagePath('Research/Notes.yantraD', packages)).toBeUndefined();
    expect(owningPackagePath('Research', packages)).toBeUndefined();
  });

  it('places explicit double-clicks from center and sidebar creates at the origin', () => {
    expect(canvasNodePlacement()).toEqual({
      x: 0, y: 0, width: CANVAS_NODE_DEFAULT_WIDTH, height: CANVAS_NODE_DEFAULT_HEIGHT,
    });
    expect(canvasNodePlacement({ x: 200, y: 200 })).toEqual({
      x: 90, y: 163, width: CANVAS_NODE_DEFAULT_WIDTH, height: CANVAS_NODE_DEFAULT_HEIGHT,
    });
  });

  it('rejects presentation saves that change membership or identity', () => {
    const canvas = { ...newCanvas('Planning'), nodes: [
      { id: '11111111-1111-4111-8111-111111111111', kind: 'document' as const,
        documentId: '22222222-2222-4222-8222-222222222222', x: 0, y: 0, width: 220, height: 75 },
    ], layerOrder: ['11111111-1111-4111-8111-111111111111'] };
    const documents = new Set([canvas.nodes[0]!.documentId]);
    expect(() => assertPresentationOnlySave(canvas, { ...canvas, viewport: { x: 10, y: 10, zoom: 1 } }, documents)).not.toThrow();
    expect(() => assertPresentationOnlySave(canvas, { ...canvas, nodes: [] }, documents)).toThrow('membership');
    expect(() => assertPresentationOnlySave(canvas, { ...canvas, title: 'Other' }, documents)).toThrow('identity');
    expect(() => assertPresentationOnlySave(canvas, canvas, new Set())).toThrow('documents in this package');
    expect(membershipKey(canvas)).not.toBe(membershipKey({ ...canvas, nodes: [] }));
    expect(packageDocumentIdsEqual(documents, canvas)).toBe(true);
    expect(packageDocumentIdsEqual(new Set([...documents, '33333333-3333-4333-8333-333333333333']), canvas)).toBe(false);
  });
});
