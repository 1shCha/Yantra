import { describe, expect, it } from 'vitest';
import { VaultTrace } from './vault-trace';

describe('vault trace', () => {
  it('bounds events, returns copies, and masks resource identifiers', () => {
    const trace = new VaultTrace(true, 'main', 2);
    const resource = trace.resource('private-document-id');
    expect(trace.resource('private-document-id')).toBe(resource);
    expect(new VaultTrace(true, 'renderer').resource('private-document-id')).toBe(resource);
    trace.record('save.start', { resource, revision: 1 });
    trace.record('save.finish', { resource, revision: 1 });
    trace.record('save.start', { resource, revision: 2 });
    expect(trace.snapshot().map((event) => event.sequence)).toEqual([2, 3]);
    expect(JSON.stringify(trace.snapshot())).not.toContain('private-document-id');
    trace.snapshot()[0]!.event = 'modified';
    expect(trace.snapshot()[0]!.event).toBe('save.finish');
    trace.clear();
    expect(trace.snapshot()).toEqual([]);
  });
  it('does not collect events or resource identifiers when disabled', () => {
    const trace = new VaultTrace(false, 'renderer');
    trace.record('save.start', { resource: trace.resource('secret') });
    expect(trace.snapshot()).toEqual([]);
    expect(trace.next()).toBe(0);
  });
});
