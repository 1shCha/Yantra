import type { CloseFlushResult } from '../shared/canvas-api';

interface FlushTransport {
  send: (requestId: number) => void;
  subscribe: (listener: (requestId: number, result: CloseFlushResult) => void) => () => void;
}

export function requestCloseFlush(transport: FlushTransport, requestId: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out while waiting for canvas flush before close.'));
    }, timeoutMs);
    const unsubscribe = transport.subscribe((completedId, result) => {
      if (completedId !== requestId) return;
      clearTimeout(timeout);
      unsubscribe();
      if (result.ok === true) resolve();
      else reject(new Error(result.error ?? 'Unable to flush canvas before close.'));
    });
    try {
      transport.send(requestId);
    } catch (error) {
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    }
  });
}

interface CloseActions {
  flush: () => Promise<void>;
  close: () => void;
  failed: (error: Error) => void;
}

export function createCloseHandler(actions: CloseActions) {
  let allowed = false;
  let closing = false;
  return (event: { preventDefault: () => void }) => {
    if (allowed) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void Promise.resolve().then(actions.flush).then(() => {
      allowed = true;
      actions.close();
    }).catch((error) => {
      actions.failed(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => { closing = false; });
  };
}
