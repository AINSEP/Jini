/**
 * @file Per-call operator-revocation checks for an already-admitted federated tool — the roster half
 * of `mcp-federation/registrations.ts`'s `FederationDeps.assertConnectionUsable`, consumed by
 * `external-mcp-oauth.ts`'s `createExternalMcpConnectionGate`.
 *
 * Why this exists at all: `mcp-federation/`'s registry is append-only (see
 * `registrations.ts`'s `FederationDeps.assertConnectionUsable` doc), so a connection deleted,
 * disabled, narrowed, or edited after admission cannot be un-registered — its tools stay both
 * listed and, absent this gate, callable. This file is what turns that stale admission into a
 * refusal at the next call, by re-reading the connection's CURRENT row against what the tool was
 * admitted under.
 *
 * Deliberately does NOT import `external-mcp-oauth.ts` — that file imports FROM this one (its gate
 * calls `rosterRefusalFor`), so the reverse import would be a cycle. `resolveExternalMcpAuthMode`/
 * `resolveExternalMcpOAuthStatus` are read straight from `external-mcp-store.ts` instead.
 *
 * `ExternalMcpConnectionRevokedError` extends `ToolInputError` rather than being reported through a
 * `ToolPolicy` deny — the same D1 argument `registrations.ts`'s own gate doc and
 * `federated-refusal-diagnosis.ts` both make: every consumer maps a policy `denied` to a fixed
 * "denied by policy"-shaped string, which sends an operator who DOES have the permission looking in
 * the wrong place. A handler-side `ToolInputError` reaches the model as `errorKind: 'validation'`
 * with this file's own text instead.
 */
import type { ExternalMcpRevocationReason } from "@jini-ai/core/contracts/hosted-mcp";
import { ToolInputError } from "@jini-ai/core";

import { externalMcpAdmissionRevision, readExternalMcpToolGrants } from "./access.js";
import { resolveExternalMcpOAuthStatus } from "./auth.js";
import { resolveExternalMcpAuthMode } from "./auth.js";
import { type ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { FederatedCallTarget } from "../ports.js";
import { refusalForAdmittedToolUnderCurrentGrants } from "../trust.js";

/** What a revocation message may name: the connection, its operator label, the remote tool and why. */
/** @agent-note Built by the host's connection gate from the admitted call and the current row; `label` is operator-entered display text. */
export interface ExternalMcpRevocationMessageInput {
  readonly serverId: string;
  readonly label: string | null;
  readonly remoteName: string;
  readonly reason: ExternalMcpRevocationReason;
}

/** Model-facing text for each revocation reason, supplied by the host (its settings path and wording). */
/** @agent-note Host input: every reason must have a sentence; each must tell the model not to retry (except `unverifiable`) and must never carry a provider message, token or URL. */
export type ExternalMcpRevocationMessages = Readonly<Record<ExternalMcpRevocationReason, (input: ExternalMcpRevocationMessageInput) => string>>;

/** @complexity O(1). */
function revocationMessage({ messages, ...input }: ExternalMcpRevocationMessageInput & { messages: ExternalMcpRevocationMessages }): string {
  return messages[input.reason](input);
}

/**
 * The terminal, non-retryable failure a federated tool returns once its connection has been revoked
 * since admission — deleted, disabled, narrowed, edited, or OAuth-disconnected. Sibling of
 * `external-mcp-oauth.ts`'s `ExternalMcpReauthRequiredError`, with the same "always false, present
 * as a field" `retryable` convention.
 */
export class ExternalMcpConnectionRevokedError extends ToolInputError {
  readonly code: string;
  readonly retryable = false;
  readonly serverId: string;
  readonly reason: ExternalMcpRevocationReason;

  /** @agent-note `messages` (model-facing text) and `code` (the host's stable error code) are bound once by the host; a host subclass keeps the old one-argument constructor. `code`, `name` and `retryable` are stable error identity. */
  constructor({ code, ...input }: ExternalMcpRevocationMessageInput & { messages: ExternalMcpRevocationMessages; code: string }) {
    super({ message: revocationMessage(input) });
    this.code = code;
    this.name = "ExternalMcpConnectionRevokedError";
    this.serverId = input.serverId;
    this.reason = input.reason;
  }
}

/** {@link rosterRefusalFor}'s OAuth check: `disconnected` refuses, `pending`/`connected`/`needs_reauth`
 *  do not — `needs_reauth` is the legacy check the gate still runs afterwards, unchanged, so it must
 *  not also be caught here. @complexity O(1). */
function isOAuthDisconnected(record: ExternalMcpServerRecord): boolean {
  return resolveExternalMcpAuthMode(record) === "oauth" && resolveExternalMcpOAuthStatus(record) === "disconnected";
}

/** {@link rosterRefusalFor}'s grant check: reapplies R2 and "may write" to the connection's CURRENT
 *  allowlist and write list — narrowing only, never granting, exactly as {@link refusalForAdmittedToolUnderCurrentGrants}
 *  documents. Maps the one grant-refusal reason that means "a write tool without a write grant" onto
 *  the write-specific D3 message; every other reason (today, only `not-in-operator-allowlist`) maps
 *  to the generic one. @complexity O(a + w) in the two list lengths. */
function grantRefusalFor(record: ExternalMcpServerRecord, call: FederatedCallTarget): ExternalMcpRevocationReason | null {
  const grants = readExternalMcpToolGrants(record);
  const refusal = refusalForAdmittedToolUnderCurrentGrants({ tool: {
    remoteName: call.remoteName, declaredAnnotations: call.declaredAnnotations, requiresWriteGrant: call.requiresWriteGrant,
  }, grants });
  if (refusal === null) return null;
  return refusal === "remote-declares-not-read-only" ? "write-not-allowed" : "tool-not-allowed";
}

/**
 * Re-checks one already-admitted roster tool against its connection's CURRENT row — steps 3-8 of the
 * design doc's D2. Pure: takes the row (already read by the caller) and the call's identity, and
 * returns why it should now be refused, or `null` when it still clears every check.
 *
 * The caller (`external-mcp-oauth.ts`'s gate) invokes this ONLY for a non-preset origin — a preset
 * has no row to compare against and gets only the legacy `needs_reauth` check. The `call.origin.kind
 * === "preset"` branch below exists purely as a bug-guard for a roster-shaped call built outside
 * `toResolvedFederatedConnections`, mirroring the `undefined` branch immediately before it: both fail
 * closed to `unverifiable` rather than assume a shape this function was never handed at admission.
 *
 * @complexity O(1).
 */
/** @agent-note Pure: the caller passes the row it already read (the store's repository, once per call) and the admitted call identity; no I/O and no state. */
export function rosterRefusalFor(record: ExternalMcpServerRecord | null, call: FederatedCallTarget): ExternalMcpRevocationReason | null {
  if (call.origin === undefined || call.origin.kind === "preset") return "unverifiable";
  if (record === null) return "removed";
  if (externalMcpAdmissionRevision(record) !== call.origin.admissionRevision) return "changed";
  if (!record.enabled) return "turned-off";
  if (isOAuthDisconnected(record)) return "disconnected";
  return grantRefusalFor(record, call);
}
