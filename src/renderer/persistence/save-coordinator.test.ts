import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveCoordinator } from './save-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const writes: Array<{ id: string; value: string; completion: ReturnType<typeof deferred<string>> }> = [];
  const coordinator = new SaveCoordinator<string>({
    serialize: (value) => value,
    write(id, value) {
      const completion = deferred<string>();
      writes.push({ id, value, completion });
      return completion.promise;
    },
  });
  coordinator.register('canvas', 'initial');
  return { coordinator, writes };
}

describe('SaveCoordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes and ignores unchanged content', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'initial');
    expect(coordinator.status('canvas').revision).toBe(0);
    coordinator.update('canvas', 'a');
    await vi.advanceTimersByTimeAsync(700);
    coordinator.update('canvas', 'b');
    await vi.advanceTimersByTimeAsync(749);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes.map((write) => write.value)).toEqual(['b']);
    writes[0]!.completion.resolve('saved');
    await coordinator.flushAll();
    expect(coordinator.status('canvas')).toMatchObject({ state: 'clean', revision: 2, savedRevision: 2 });
  });

  it('starts a save within five seconds of continuous editing', async () => {
    const { coordinator, writes } = setup();
    for (let i = 0; i < 10; i += 1) {
      coordinator.update('canvas', String(i));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(writes.map((write) => write.value)).toEqual(['9']);
    writes[0]!.completion.resolve('saved');
    await coordinator.flushAll();
  });

  it('serializes writes and coalesces pending changes without marking them saved early', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'a');
    await vi.advanceTimersByTimeAsync(750);
    coordinator.update('canvas', 'b');
    coordinator.update('canvas', 'c');
    await vi.advanceTimersByTimeAsync(6000);
    expect(writes).toHaveLength(1);
    writes[0]!.completion.resolve('first');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map((write) => write.value)).toEqual(['a', 'c']);
    expect(coordinator.status('canvas')).toMatchObject({ state: 'saving', revision: 3, savedRevision: 1 });
    writes[1]!.completion.resolve('second');
    await coordinator.flushAll();
    expect(coordinator.status('canvas')).toMatchObject({ state: 'clean', savedRevision: 3 });
  });

  it('retains failed drafts and retries the latest snapshot only when requested', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'a');
    await vi.advanceTimersByTimeAsync(750);
    writes[0]!.completion.reject(new Error('Disk full'));
    await vi.advanceTimersByTimeAsync(0);
    coordinator.update('canvas', 'b');
    await vi.advanceTimersByTimeAsync(6000);
    expect(writes).toHaveLength(1);
    expect(coordinator.status('canvas')).toMatchObject({ state: 'error', savedRevision: 0, error: 'Disk full' });
    const retry = coordinator.retry('canvas');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[1]!.value).toBe('b');
    writes[1]!.completion.resolve('retried');
    await retry;
    expect(coordinator.status('canvas').state).toBe('clean');
  });

  it('flush waits for edits queued while closing and concurrent flush requests', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'a');
    let finished = false;
    const first = coordinator.flushAll().then(() => { finished = true; });
    const second = coordinator.flushAll();
    await vi.advanceTimersByTimeAsync(0);
    coordinator.update('canvas', 'b');
    writes[0]!.completion.resolve('first');
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    expect(writes).toHaveLength(2);
    writes[1]!.completion.resolve('second');
    await Promise.all([first, second]);
    expect(finished).toBe(true);
  });

  it('rejects a failed flush instead of reporting success', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'a');
    const flush = expect(coordinator.flushAll()).rejects.toThrow('Permission denied');
    await vi.advanceTimersByTimeAsync(0);
    writes[0]!.completion.reject(new Error('Permission denied'));
    await flush;
    expect(coordinator.status('canvas').savedRevision).toBe(0);
  });

  it('allows independent resources to save concurrently', async () => {
    const { coordinator, writes } = setup();
    coordinator.register('document', 'initial');
    coordinator.update('canvas', 'a');
    coordinator.update('document', 'b');
    const flush = coordinator.flushAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map((write) => write.id)).toEqual(['canvas', 'document']);
    writes[1]!.completion.resolve('document-saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.status('canvas').state).toBe('saving');
    expect(coordinator.status('document').state).toBe('clean');
    writes[0]!.completion.resolve('canvas-saved');
    await flush;
  });

  it('saves a revert made during an in-flight write', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'changed');
    await vi.advanceTimersByTimeAsync(750);
    coordinator.update('canvas', 'initial');
    writes[0]!.completion.resolve('first');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[1]!.value).toBe('initial');
    writes[1]!.completion.resolve('second');
    await coordinator.flushAll();
  });

  it('rechecks resources changed after their portion of flush-all completed', async () => {
    const { coordinator, writes } = setup();
    coordinator.register('document', 'initial');
    coordinator.update('document', 'first');
    let finished = false;
    const flush = coordinator.flushAll().then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(0);
    coordinator.update('canvas', 'late edit');
    writes[0]!.completion.resolve('document-saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    expect(writes[1]!.value).toBe('late edit');
    writes[1]!.completion.resolve('canvas-saved');
    await flush;
    expect(finished).toBe(true);
  });

  it('explicitly discards a failed draft without retrying or queuing the old snapshot', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'local');
    const failed = expect(coordinator.flush('canvas')).rejects.toThrow('Conflict');
    await vi.advanceTimersByTimeAsync(0);
    writes[0]!.completion.reject(new Error('Conflict'));
    await failed;
    coordinator.discardDraft('canvas', 'external');
    await coordinator.flushAll();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(1);
    expect(coordinator.status('canvas').state).toBe('clean');
    coordinator.update('canvas', 'external');
    expect(coordinator.status('canvas').state).toBe('clean');
  });

  it('waits for an active write before allowing a discard', async () => {
    const { coordinator, writes } = setup();
    coordinator.update('canvas', 'local');
    await vi.advanceTimersByTimeAsync(750);
    expect(() => coordinator.discardDraft('canvas', 'external')).toThrow('active save');
    let idle = false;
    const waiting = coordinator.waitForIdle('canvas').then(() => { idle = true; });
    expect(idle).toBe(false);
    writes[0]!.completion.resolve('saved');
    await waiting;
    coordinator.discardDraft('canvas', 'external');
    expect(coordinator.status('canvas').state).toBe('clean');
  });
});
