import { describe, expect, it } from 'vitest';
import { batchMoveTargets, normalizeBatchMoveSources, remapSelectedPaths, rejectNestedBatchDestination } from './vault-batch-move';

describe('vault batch move helpers', () => {
  it('normalizes sidebar order, deduplicates, and drops carried descendants', () => {
    expect(normalizeBatchMoveSources(['B', 'A', 'A/Nested', 'Unfiled', 'B'], ['A', 'B', 'C'])).toEqual(['A', 'B', 'Unfiled']);
  });

  it('detects nested destinations and unchanged targets', () => {
    expect(rejectNestedBatchDestination(['Research'], 'Research/Notes')).toBe(true);
    const split = batchMoveTargets(['A', 'Research/B'], 'Research');
    expect(split.unchanged).toEqual(['Research/B']);
    expect(split.toMove).toEqual(['A']);
    expect(split.targets).toEqual(['Research/A']);
  });

  it('remaps selected paths across multiple changes', () => {
    const remapped = remapSelectedPaths(new Set(['A', 'Research/B']), [
      { from: 'A', to: 'Archive/A' },
      { from: 'Research/B', to: 'Research/Renamed/B' },
    ]);
    expect([...remapped]).toEqual(['Archive/A', 'Research/Renamed/B']);
  });
});
