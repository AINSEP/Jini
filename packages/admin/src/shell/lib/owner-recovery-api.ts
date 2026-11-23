import { formatUserFacingError, type UserFacingError } from "@jini-ai/core";
import type { Translate } from "@jini-ai/core/text";

import type { AdminRequestOnceOps } from "./owner-mfa-api.js";

type Empty = Record<string, never>;
export interface OwnerRecoveryStatus { isOwner: boolean; available: boolean; desktopOwnerReset: boolean }
export interface OwnerRecoveryPort {
  status(): Promise<OwnerRecoveryStatus>;
  issue(input: { password: string; code?: string }, optional?: Empty): Promise<{ codes: string[] }>;
  reset(input: { password: string }, optional?: Empty): Promise<void>;
  recover(input: { code: string; password: string }, optional?: Empty): Promise<void>;
}

/** The secret-redaction options the host's incident evidence uses (product vocabulary stays in the host). */
export type OwnerRecoveryRedactionOptions = NonNullable<Parameters<typeof formatUserFacingError>[1]>;

export interface OwnerRecoveryFailureInput { error: unknown; message: string; action: string; step: string; t: Translate; secrets?: string[] }

/** Single-send client: never retry a rotation/redemption whose response may have been lost.
 * The host injects its bound `requestOnce`; a host binds once.
 * @complexity O(1), one request per action, kit responses bounded to ten 64-character codes.
 */
export function createOwnerRecoveryPort({ http }: { http: AdminRequestOnceOps }, _optional: Empty = {}): OwnerRecoveryPort {
  const post = <T,>({ path, body }: { path: string; body: unknown }, _options = {}): Promise<T> => http.requestOnce<T>({ path: `/auth/${path}`, init: {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  } });
  return {
    status: () => http.requestOnce<OwnerRecoveryStatus>({ path: "/auth/owner-recovery", init: { cache: "no-store" } }),
    issue: (input, _optional = {}) => post({ path: "recovery-codes", body: input }),
    reset: (input, _optional = {}) => post({ path: "reset-owner", body: input }),
    recover: (input, _optional = {}) => post({ path: "recover-owner", body: input }),
  };
}

/** Preserve the server's specific explanation and provide selectable, redacted incident evidence.
 * Submitted secrets are exact redaction hints because a driver may echo them without a label.
 * The host injects its request-error describer and its redaction options; a host binds once.
 * @complexity O(diagnostic characters), no requests, clocks or clipboard effects.
 * @example ownerRecoveryFailure({ error, message: 'Recovery settings could not load.', action: 'Reload this page.', step: 'owner-recovery-status', t });
 */
export function createOwnerRecoveryFailure(
  { describeError, redactionOptions }: {
    describeError: (required: { e: unknown; fallback: string }, optional?: Empty) => string;
    redactionOptions: OwnerRecoveryRedactionOptions;
  },
  _optional: Empty = {},
): (required: OwnerRecoveryFailureInput, optional?: Empty) => UserFacingError {
  return ({ error, message, action, step, t, secrets = [] }, _options = {}) =>
    formatUserFacingError({ message: describeError({ e: error, fallback: t(message) }), action: t(action), step, cause: error },
      { ...redactionOptions, exactSecrets: secrets.filter(Boolean) });
}
