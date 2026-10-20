/**
 * @file The one error type API-connection operations throw.
 *
 * Exists so hosts branch on a stable `code` and show `message`, which always says what failed and
 * what to do next. Messages never carry tokens, codes, verifiers or provider response bodies;
 * the underlying failure stays on `cause` for server-side diagnosis.
 */
import { IntegrationError } from '../argument-error.js';

export type ApiConnectionErrorCode =
  | 'descriptor-invalid' | 'configuration-invalid' | 'request-invalid' | 'connection-not-found' | 'not-connected'
  | 'reconnect-required' | 'revocation-pending' | 'invalid-attempt' | 'attempt-superseded'
  | 'access-denied' | 'authorization-failed' | 'scope-not-granted' | 'account-mismatch'
  | 'account-changed' | 'account-unchanged' | 'account-identity-invalid' | 'switch-not-staged' | 'switch-in-progress'
  | 'storage-conflict';

export class ApiConnectionError extends IntegrationError {
  readonly code: ApiConnectionErrorCode;
  constructor(
    { code, message }: { code: ApiConnectionErrorCode; message: string },
    { cause }: { cause?: unknown } = {},
  ) {
    super({ message }, cause === undefined ? {} : { options: { cause } });
    this.name = 'ApiConnectionError';
    this.code = code;
  }
}

/** Shared wording keeps every attempt failure indistinguishable to a caller probing states. */
export function invalidAttempt(_requiredArgs: Record<string, never> = {}, { cause }: { cause?: unknown } = {}): ApiConnectionError {
  return new ApiConnectionError({
    code: 'invalid-attempt',
    message: 'The sign-in request could not be matched; it may have expired or already been used. Start connecting again.',
  }, { cause });
}
