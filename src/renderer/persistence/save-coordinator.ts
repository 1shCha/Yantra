import { OperationError, operationFailure, type OperationFailure } from '../../shared/operation-result';
import { vaultTrace } from './vault-diagnostics';

export interface SaveStatus {
  failure: OperationFailure | null;
  revision: number;
  savedRevision: number;
  state: 'clean' | 'dirty' | 'saving' | 'error';
  error: string | null;
  savedAt: string | null;
}

interface Resource<T> {
  snapshot: T;
  signature: string;
  revision: number;
  savedRevision: number;
  savedAt: string | null;
  error: OperationFailure | null;
  pendingSince: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void> | null;
}

interface SaveCoordinatorOptions<T> {
  write: (id: string, snapshot: T) => Promise<string>;
  serialize: (snapshot: T) => string;
  debounceMs?: number;
  maxWaitMs?: number;
}

export class SaveCoordinator<T> {
  private readonly resources = new Map<string, Resource<T>>();
  private readonly listeners = new Set<(id: string, status: SaveStatus) => void>();

  constructor(private readonly options: SaveCoordinatorOptions<T>) {}

  register(id: string, snapshot: T): void {
    if (this.resources.has(id)) throw new Error(`Already registered: ${id}`);
    this.resources.set(id, {
      snapshot: structuredClone(snapshot), signature: this.options.serialize(snapshot),
      revision: 0, savedRevision: 0, savedAt: null, error: null,
      pendingSince: null, timer: null, active: null,
    });
  }

  private resource(id: string): Resource<T> {
    const resource = this.resources.get(id);
    if (!resource) throw new Error(`Unknown save resource: ${id}`);
    return resource;
  }

  status(id: string): SaveStatus {
    const resource = this.resource(id);
    return {
      revision: resource.revision, savedRevision: resource.savedRevision,
      state: resource.error ? 'error' : resource.active ? 'saving'
        : resource.revision === resource.savedRevision ? 'clean' : 'dirty',
      error: resource.error?.message ?? null, failure: resource.error, savedAt: resource.savedAt,
    };
  }

  subscribe(listener: (id: string, status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(id: string): void {
    const status = this.status(id);
    for (const listener of this.listeners) listener(id, status);
  }

  update(id: string, snapshot: T): void {
    const resource = this.resource(id);
    const signature = this.options.serialize(snapshot);
    if (signature === resource.signature) return;
    resource.snapshot = structuredClone(snapshot);
    resource.signature = signature;
    resource.revision += 1;
    resource.pendingSince ??= Date.now();
    this.clearTimer(resource);
    // A failed draft stays unsaved until explicitly retried, including on close.
    if (!resource.active && !resource.error) {
      const wait = Math.min(
        this.options.debounceMs ?? 750,
        Math.max(0, (this.options.maxWaitMs ?? 5000) - (Date.now() - resource.pendingSince)),
      );
      resource.timer = setTimeout(() => { void this.write(id); }, wait);
    }
    this.publish(id);
  }

  private clearTimer(resource: Resource<T>): void {
    if (resource.timer !== null) clearTimeout(resource.timer);
    resource.timer = null;
  }

  private write(id: string): Promise<void> {
    const resource = this.resource(id);
    if (resource.active) return resource.active;
    this.clearTimer(resource);
    if (resource.revision === resource.savedRevision) return Promise.resolve();
    const revision = resource.revision;
    const traceResource = vaultTrace.resource(id);
    vaultTrace.record('save.start', { resource: traceResource, revision });
    const snapshot = resource.snapshot;
    resource.pendingSince = null;
    resource.error = null;
    // Assign active before invoking the writer, including writers that throw synchronously.
    resource.active = Promise.resolve()
      .then(() => this.options.write(id, snapshot))
      .then((savedAt) => {
        resource.savedRevision = revision;
        resource.savedAt = savedAt;
      })
      .catch((error) => {
        resource.error = operationFailure(error);
      })
      .then(() => {
        resource.active = null;
        vaultTrace.record('save.finish', { resource: traceResource, revision,
          outcome: resource.error ? 'failure' : 'success', code: resource.error?.code });
        this.publish(id);
        if (!resource.error && resource.revision !== resource.savedRevision) {
          void this.write(id);
        }
      });
    this.publish(id);
    return resource.active;
  }

  async flush(id: string): Promise<void> {
    const resource = this.resource(id);
    this.clearTimer(resource);
    resource.error = null;
    while (resource.active || resource.revision !== resource.savedRevision) {
      await (resource.active ?? this.write(id));
      if (resource.error) throw new OperationError(resource.error);
    }
  }

  async flushAll(): Promise<void> {
    // A resource already flushed can change while a different resource is saving.
    do {
      await Promise.all(Array.from(this.resources.keys(), (id) => this.flush(id)));
    } while (Array.from(this.resources.values()).some(
      (resource) => resource.active !== null || resource.revision !== resource.savedRevision,
    ));
  }

  retry(id: string): Promise<void> {
    return this.flush(id);
  }

  async waitForIdle(id: string): Promise<void> {
    const resource = this.resource(id);
    while (resource.active) await resource.active;
  }

  unregister(id: string): void {
    const resource = this.resource(id);
    if (resource.active || resource.revision !== resource.savedRevision) throw new Error('Flush pending edits before removing a resource.');
    this.clearTimer(resource);
    this.resources.delete(id);
  }

  replaceCleanSnapshot(id: string, snapshot: T): void {
    const resource = this.resource(id);
    if (resource.active || resource.revision !== resource.savedRevision || resource.error) throw new Error('Flush pending edits before replacing saved metadata.');
    resource.snapshot = structuredClone(snapshot);
    resource.signature = this.options.serialize(snapshot);
  }

  discardDraft(id: string, snapshot: T): void {
    const resource = this.resource(id);
    if (resource.active) throw new Error('Wait for the active save before discarding a draft.');
    this.clearTimer(resource);
    resource.snapshot = structuredClone(snapshot);
    resource.signature = this.options.serialize(snapshot);
    resource.revision += 1;
    resource.savedRevision = resource.revision;
    resource.error = null;
    resource.pendingSince = null;
    this.publish(id);
  }
}
