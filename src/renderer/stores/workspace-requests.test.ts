import { describe, expect, it } from 'vitest';
import { WorkspaceRequests } from './workspace-requests';
import { newDocument } from '../../shared/vault-format';

describe('workspace request boundaries', () => {
  it('navigation preserves pending resource reads but path changes invalidate them', () => {
    const requests = new WorkspaceRequests();
    const pending = Promise.resolve(newDocument('Example'));
    requests.loading.set('Example.yantraD', pending);
    expect(requests.begin()).toBe(1);
    expect(requests.generation).toBe(0);
    expect(requests.loading.get('Example.yantraD')).toBe(pending);
    requests.invalidate();
    expect(requests.generation).toBe(1);
    expect(requests.navigation).toBe(2);
    expect(requests.loading.size).toBe(0);
  });
});
