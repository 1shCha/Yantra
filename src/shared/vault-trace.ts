import type { OperationFailure } from './operation-result';

export interface VaultTraceEvent {
  sequence: number;
  time: number;
  source: 'main' | 'renderer';
  event: string;
  operation?: number;
  resource?: string;
  revision?: number;
  outcome?: string;
  code?: OperationFailure['code'];
}

// Callers supply event names, never error messages, paths, titles, or snapshots.
export class VaultTrace {
  private events: VaultTraceEvent[] = [];
  private sequence = 0;
  private counter = 0;
  private readonly resources = new Map<string, string>();

  constructor(readonly enabled: boolean, private readonly source: VaultTraceEvent['source'], private readonly limit = 500) {}

  next(): number { return this.enabled ? ++this.counter : 0; }

  resource(id: string): string {
    if (!this.enabled) return '';
    let key = this.resources.get(id);
    if (key === undefined) {
      // Stable across Electron and renderer without retaining IDs in exported events.
      let hash = 14695981039346656037n;
      for (const character of id) hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 1099511628211n);
      key = `r${hash.toString(16)}`;
      if (this.resources.size >= this.limit) this.resources.delete(this.resources.keys().next().value!);
      this.resources.set(id, key);
    }
    return key;
  }

  record(event: string, detail: Pick<VaultTraceEvent, 'operation' | 'resource' | 'revision' | 'outcome' | 'code'> = {}): void {
    if (!this.enabled) return;
    // Whitelist fields even when a caller has extra runtime properties.
    const { operation, resource, revision, outcome, code } = detail;
    this.events.push({ sequence: ++this.sequence, time: Date.now(), source: this.source, event, operation, resource, revision, outcome, code });
    if (this.events.length > this.limit) this.events.shift();
  }

  snapshot(): VaultTraceEvent[] { return this.events.map((event) => ({ ...event })); }
  clear(): void { this.events = []; this.resources.clear(); }
}

export const VAULT_TRACE_CHANNEL = 'vault:development-trace';
declare global {
  interface Window {
    yantraVaultTrace?: { snapshot: () => Promise<VaultTraceEvent[]>; clear: () => Promise<void> };
    yantraDebug?: { snapshot: () => Promise<VaultTraceEvent[]>; clear: () => Promise<void> };
  }
}
