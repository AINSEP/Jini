/** @file Typed failures of the vault-backed OAuth token store.
 * Exists so callers can branch on a stable code while messages stay fixed text: no token,
 * key, owner id or vault material ever reaches an error message, status or log line. */
import { IntegrationError } from "../../argument-error.js";

export type OAuthTokenStoreErrorCode =
  | "configuration" | "lease-not-held" | "lease-lost" | "stale-generation" | "owner-mismatch" | "invalid-record" | "write-conflict";

const TEXT: Readonly<Record<OAuthTokenStoreErrorCode, { message: string; nextAction: string }>> = {
  configuration: { message: "OAuth token store: the vault scope does not belong to the expected workspace.",
    nextAction: "Fix the host composition so the vault scope and connection owner name the same workspace." },
  "lease-not-held": { message: "OAuth token store: tokens can only be written while holding this connection's refresh lease.",
    nextAction: "Acquire the refresh lease, write, then release it." },
  "lease-lost": { message: "OAuth token store: a newer attempt took over this connection, so this result was discarded.",
    nextAction: "Retry; the newer attempt's tokens are kept." },
  "stale-generation": { message: "OAuth token store: the connection was disconnected, switched or reconnected while this attempt ran, so its tokens were discarded.",
    nextAction: "Retry against the current connection." },
  "owner-mismatch": { message: "OAuth token store: the stored credential belongs to a different connection owner.",
    nextAction: "Reconnect this connection." },
  "write-conflict": { message: "OAuth token store: the connection kept changing while its credential was being written or removed.",
    nextAction: "Retry the sign-in or the disconnect." },
  "invalid-record": { message: "OAuth token store: the stored credential is not a valid OAuth token record.",
    nextAction: "Reconnect this connection." },
};

/** Refusal raised by the token store; `cause` keeps the underlying vault error when there is one. */
export class OAuthTokenStoreError extends IntegrationError {
  readonly code: OAuthTokenStoreErrorCode;
  readonly nextAction: string;
  constructor({ code }: { code: OAuthTokenStoreErrorCode }, { cause }: { cause?: unknown } = {}) {
    super({ message: TEXT[code].message }, cause === undefined ? {} : { options: { cause } });
    this.name = "OAuthTokenStoreError";
    this.code = code;
    this.nextAction = TEXT[code].nextAction;
  }
}

/** True for a stored row this owner cannot open (sealed for another client id, or malformed). Only
 * a new sign-in can replace such a row, so callers treat it as "no usable credential" instead of
 * failing for good. Other store failures (vault outages, conflicts) are not this. */
export function isUnreadableTokenRecord(error: unknown): boolean {
  return error instanceof OAuthTokenStoreError && (error.code === "owner-mismatch" || error.code === "invalid-record");
}
