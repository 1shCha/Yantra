import type { DocumentFile } from '../../shared/vault-format';
import { vaultTrace } from '../persistence/vault-diagnostics';

// Navigation changes the visible item; invalidation also retires pending path reads.
export class WorkspaceRequests {
  generation = 0;
  navigation = 0;
  readonly loading = new Map<string, Promise<DocumentFile>>();
  begin(): number {
    this.navigation += 1;
    vaultTrace.record('navigation.begin', { operation: this.navigation });
    return this.navigation;
  }
  invalidate(): void {
    this.generation += 1;
    this.begin();
    this.loading.clear();
    vaultTrace.record('navigation.invalidate');
  }
}
