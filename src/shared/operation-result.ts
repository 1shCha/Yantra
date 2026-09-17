import { z } from 'zod';

export const operationFailureSchema = z.strictObject({
  code: z.enum(['conflict', 'collision', 'missing', 'permission', 'invalid-input', 'unsupported-format',
    'invalid-format', 'invalid-session', 'busy', 'no-vault', 'unavailable', 'recovery-required', 'io', 'unknown']),
  message: z.string(),
  path: z.string().optional(),
  systemCode: z.string().optional(),
});

export type OperationFailure = z.infer<typeof operationFailureSchema>;
export type OperationResult<T = void> =
  | { status: 'success'; value: T }
  | { status: 'cancelled'; reason: 'user' | 'superseded' | 'not-applicable' }
  | { status: 'failure'; error: OperationFailure }
  | { status: 'recovery-required'; value: T; error: OperationFailure };

export class OperationError extends Error {
  constructor(readonly failure: OperationFailure) {
    super(failure.message);
    this.name = 'OperationError';
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the boundary normalizing arbitrary thrown values into the domain contract.
export function operationFailure(error: unknown): OperationFailure {
  if (error instanceof OperationError) return error.failure;
  if (error instanceof z.ZodError) return { code: 'invalid-input', message: error.message };
  if (error instanceof SyntaxError) return { code: 'invalid-format', message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  const systemError = z.object({ code: z.string() }).safeParse(error);
  if (error instanceof Error && systemError.success) {
    const systemCode = systemError.data.code;
    const code = systemCode === 'EEXIST' ? 'collision' : systemCode === 'ENOENT' ? 'missing'
      : systemCode === 'EACCES' || systemCode === 'EPERM' ? 'permission' : 'io';
    return { code, message, systemCode };
  }
  return { code: 'unknown', message };
}

export function success<T>(value: T): OperationResult<T> { return { status: 'success', value }; }
export function cancelled(reason: 'user' | 'superseded' | 'not-applicable'): OperationResult<never> { return { status: 'cancelled', reason }; }
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught values are immediately normalized before returning a typed result.
export function failure(error: unknown): OperationResult<never> { return { status: 'failure', error: operationFailure(error) }; }

export async function captureOperation<T>(work: () => Promise<T>, classify: (value: T) => OperationResult<T> = success): Promise<OperationResult<T>> {
  try { return classify(await work()); }
  catch (error) { return failure(error); }
}

// Reconstitute typed failures after Electron's structured-clone transport.
export function unwrapOperation<T>(result: OperationResult<T>): T {
  if (result.status === 'failure') throw new OperationError(operationFailureSchema.parse(result.error));
  if (result.status === 'cancelled') throw new OperationError({ code: 'unavailable', message: 'Operation was cancelled.' });
  return result.value;
}
