import { formatUserFacingError, type UserFacingError } from '@jini-ai/core';
import type { UserFacingErrorOptions } from '@jini-ai/core';
import { type Translate } from '@jini-ai/core/text';
import type { OwnerRequestOnce } from './owner-request.js';

export interface OwnerRecoveryStatus { isOwner: boolean; available: boolean; desktopOwnerReset: boolean }
export interface OwnerRecoveryPort {
  status(): Promise<OwnerRecoveryStatus>;
  issue(input: { password: string; code?: string }, optional?: Record<string, never>): Promise<{ codes: string[] }>;
  reset(input: { password: string }, optional?: Record<string, never>): Promise<void>;
  recover(input: { code: string; password: string }, optional?: Record<string, never>): Promise<void>;
}

/** `failure` arguments: the caught error, translatable copy, the step id and the submitted secrets. */
export interface OwnerRecoveryFailureArgs { error: unknown; message: string; action: string; step: string; t: Translate; secrets?: string[] }

/**
 * The host injects its single-send `requestOnce`, its API-error describer and its product
 * redaction options (they stay in the host); it builds one client for the page.
 * @complexity O(1) to build.
 */
export function createOwnerRecoveryClient(
  { requestOnce, describeApiError, redactionOptions }: {
    requestOnce: OwnerRequestOnce;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    redactionOptions: UserFacingErrorOptions;
  },
  _optional: Record<string, never> = {},
): { port: OwnerRecoveryPort; failure: (required: OwnerRecoveryFailureArgs, _options?: Record<string, never>) => UserFacingError } {
  /** Single-send client: never retry a rotation/redemption whose response may have been lost.
   * @complexity O(1), one request per action, kit responses bounded to ten 64-character codes.
   */
  const post = <T,>({ path, body }: { path: string; body: unknown }, _options = {}): Promise<T> => requestOnce<T>({ path: `/auth/${path}`, init: {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  } });

  const port: OwnerRecoveryPort = {
    status: () => requestOnce<OwnerRecoveryStatus>({ path: '/auth/owner-recovery', init: { cache: 'no-store' } }),
    issue: (input, _optional = {}) => post({ path: 'recovery-codes', body: input }),
    reset: (input, _optional = {}) => post({ path: 'reset-owner', body: input }),
    recover: (input, _optional = {}) => post({ path: 'recover-owner', body: input }),
  };

  /** Preserve the server's specific explanation and provide selectable, redacted incident evidence.
   * Submitted secrets are exact redaction hints because a driver may echo them without a label.
   * @complexity O(diagnostic characters), no requests, clocks or clipboard effects.
   * @example failure({ error, message: 'Recovery settings could not load.', action: 'Reload this page.', step: 'owner-recovery-status', t });
   */
  const failure = ({ error, message, action, step, t, secrets = [] }: OwnerRecoveryFailureArgs, _options = {}): UserFacingError =>
    formatUserFacingError({ message: describeApiError({ e: error, fallback: t(message) }), action: t(action), step, cause: error },
      { ...redactionOptions, exactSecrets: secrets.filter(Boolean) });

  return { port, failure };
}
