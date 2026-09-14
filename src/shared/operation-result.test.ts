import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cancelled, captureOperation, failure, OperationError, operationFailure, unwrapOperation } from './operation-result';

describe('operation results', () => {
  it('keeps typed failures serializable without interpreting their text', async () => {
    const outcome = await captureOperation(async () => { throw new OperationError({ code: 'conflict', message: 'Completely different wording', path: 'Notes.yantraD' }); });
    expect(outcome).toEqual({ status: 'failure', error: { code: 'conflict', message: 'Completely different wording', path: 'Notes.yantraD' } });
    expect(() => unwrapOperation(structuredClone(outcome))).toThrow(OperationError);
    expect(operationFailure(new Error('VAULT_CONFLICT: this is only text'))).toEqual({ code: 'unknown', message: 'VAULT_CONFLICT: this is only text' });
  });

  it('uses filesystem codes and validation types rather than message matching', () => {
    expect(operationFailure(Object.assign(new Error('arbitrary'), { code: 'EEXIST' })).code).toBe('collision');
    expect(operationFailure(Object.assign(new Error('arbitrary'), { code: 'EACCES' })).code).toBe('permission');
    expect(operationFailure(Object.assign(new Error('arbitrary'), { code: 'ENOENT' })).code).toBe('missing');
    expect(operationFailure(Object.assign(new Error('arbitrary'), { code: 'ENOSPC' })).code).toBe('io');
    const parsed = z.string().safeParse(3);
    if (parsed.success) throw new Error('Expected validation to fail');
    expect(operationFailure(parsed.error).code).toBe('invalid-input');
    expect(operationFailure(new SyntaxError('Bad JSON')).code).toBe('invalid-format');
    expect(failure('Non-error rejection')).toEqual({ status: 'failure', error: { code: 'unknown', message: 'Non-error rejection' } });
  });

  it('distinguishes cancellation and recovery-required from success', async () => {
    expect(await captureOperation(async () => null, () => cancelled('user'))).toEqual({ status: 'cancelled', reason: 'user' });
    const value = { pending: true };
    const outcome = await captureOperation(async () => value, (snapshot) => ({ status: 'recovery-required', value: snapshot,
      error: { code: 'recovery-required', message: 'Trash unavailable' } }));
    expect(structuredClone(outcome)).toEqual({ status: 'recovery-required', value, error: { code: 'recovery-required', message: 'Trash unavailable' } });
  });
});
