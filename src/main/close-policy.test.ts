import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloseFlushResult } from '../shared/canvas-api';
import { createCloseHandler, requestCloseFlush } from './close-policy';

describe('close-time save policy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function transport() {
    const listeners = new Set<(id: number, result: CloseFlushResult) => void>();
    const requests: number[] = [];
    return {
      listeners, requests,
      send: (id: number) => { requests.push(id); },
      subscribe(listener: (id: number, result: CloseFlushResult) => void) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      complete(id: number, result: CloseFlushResult) {
        for (const listener of listeners) listener(id, result);
      },
    };
  }

  it('requires success for the matching request and removes its listener', async () => {
    const channel = transport();
    const flush = requestCloseFlush(channel, 42);
    channel.complete(41, { ok: true });
    expect(channel.listeners.size).toBe(1);
    channel.complete(42, { ok: true });
    await flush;
    expect(channel.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects failed and ambiguous acknowledgements', async () => {
    const channel = transport();
    const failed = expect(requestCloseFlush(channel, 1)).rejects.toThrow('Disk full');
    channel.complete(1, { error: 'Disk full' });
    await failed;
    const ambiguous = expect(requestCloseFlush(channel, 2)).rejects.toThrow('Unable to flush');
    channel.complete(2, {});
    await ambiguous;
  });

  it('times out without accepting a late acknowledgement', async () => {
    const channel = transport();
    const flush = expect(requestCloseFlush(channel, 42)).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(3000);
    await flush;
    expect(channel.listeners.size).toBe(0);
    channel.complete(42, { ok: true });
  });

  it('keeps the window open after failure and allows a subsequent close to retry', async () => {
    let attempts = 0;
    let closed = 0;
    const failures: string[] = [];
    const handler = createCloseHandler({
      flush: async () => { if (++attempts === 1) throw new Error('Disk full'); },
      close: () => { closed += 1; },
      failed: (error) => { failures.push(error.message); },
    });
    let prevented = 0;
    const event = { preventDefault: () => { prevented += 1; } };
    handler(event);
    handler(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(closed).toBe(0);
    expect(failures).toEqual(['Disk full']);
    handler(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(1);
    expect(prevented).toBe(3);
    handler(event);
    expect(prevented).toBe(3);
  });
});
