import type { FederatedCallTarget } from "../ports.js";
import { refusalForAdmittedToolUnderCurrentGrants } from "../trust.js";

export type ExternalMcpRevocationReason = "removed" | "turned-off" | "disconnected" | "changed" | "tool-not-allowed" | "write-not-allowed" | "unverifiable";

/** Host projection of the current row; revision derivation and credential status stay in adapters. */
export interface ConnectionRosterSnapshot {
  readonly label: string | null;
  readonly enabled: boolean;
  readonly admissionRevision: string;
  readonly disconnected: boolean;
  readonly grants: { readonly allowedToolNames: readonly string[]; readonly writeAllowedToolNames: readonly string[] };
}

/** A primary-key read per call. The host implements this over its ExternalMcpServerRepoPort. */
export interface ConnectionRosterReader {
  findByServerId(required: { serverId: string }, optional?: { scope?: string }): Promise<ConnectionRosterSnapshot | null>;
}

export interface FederatedConnectionRefusal {
  readonly serverId: string;
  readonly label: string | null;
  readonly remoteName: string;
  readonly reason: ExternalMcpRevocationReason;
}

/** Host preserves its error subclass, validation classification and exact model-facing wording. */
export interface FederatedRevocationErrorFactoryPort { create(required: FederatedConnectionRefusal): Error }
export interface FederatedRevocationWebhookPort {
  connectionRefused(required: FederatedConnectionRefusal, optional?: { scope?: string }): Promise<void>;
}
export interface FederatedRevocationDiagnostic {
  readonly connectionId: string;
  readonly stage: "store" | "webhook";
  readonly error: unknown;
}

/** Pure current-row check. Ordering matches admission semantics: identity before mutable grants. */
export function rosterRefusalFor({ record, call }: { record: ConnectionRosterSnapshot | null; call: FederatedCallTarget }): ExternalMcpRevocationReason | null {
  if (call.origin === undefined || call.origin.kind === "preset") return "unverifiable";
  if (record === null) return "removed";
  if (record.admissionRevision !== call.origin.admissionRevision) return "changed";
  if (!record.enabled) return "turned-off";
  if (record.disconnected) return "disconnected";
  const refusal = refusalForAdmittedToolUnderCurrentGrants({ tool: call, grants: record.grants });
  return refusal === null ? null : refusal === "remote-declares-not-read-only" ? "write-not-allowed" : "tool-not-allowed";
}

/** Revocation half of a connection gate; credential refresh/reauth checks are composed by the host.
 * Presets have no roster row. Reads and notification failures never disclose driver errors.
 */
export function createFederatedConnectionRevocationGate(required: {
  roster: ConnectionRosterReader; errorFactory: FederatedRevocationErrorFactoryPort;
}, optional: {
  scope?: string;
  webhooks?: FederatedRevocationWebhookPort;
  onDiagnostic?: (required: FederatedRevocationDiagnostic) => void;
} = {}): (required: { connectionId: string; call: FederatedCallTarget }) => Promise<void> {
  const report = (diagnostic: FederatedRevocationDiagnostic) => {
    try { optional.onDiagnostic?.(diagnostic); } catch { /* Diagnostics cannot bypass refusal. */ }
  };
  return async ({ connectionId, call }) => {
    if (call.origin?.kind === "preset") return;
    let record: ConnectionRosterSnapshot | null = null;
    let reason: ExternalMcpRevocationReason | null;
    try {
      record = await required.roster.findByServerId({ serverId: connectionId }, optional.scope === undefined ? {} : { scope: optional.scope });
      reason = rosterRefusalFor({ record, call });
    } catch (error) { report({ connectionId, stage: "store", error }); reason = "unverifiable"; }
    if (reason === null) return;
    const refusal = { serverId: connectionId, label: record?.label ?? null, remoteName: call.remoteName, reason };
    try { await optional.webhooks?.connectionRefused(refusal, optional.scope === undefined ? {} : { scope: optional.scope }); }
    catch (error) { report({ connectionId, stage: "webhook", error }); }
    throw required.errorFactory.create(refusal);
  };
}
