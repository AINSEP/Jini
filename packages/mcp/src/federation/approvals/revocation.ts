import type { FederatedCallTarget, FederatedGateVerdict } from "../ports.js";
import { refusalForAdmittedToolUnderCurrentGrants } from "../trust.js";
import { revocationReasonForToolRefusal } from "./revocation-reason.js";
import { scopeOption } from "./scope-option.js";

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
  return revocationReasonForToolRefusal(refusalForAdmittedToolUnderCurrentGrants({ tool: call, grants: record.grants }));
}

/** One roster read plus its refusal. A failed read or check is reported and fails closed as
 *  `"unverifiable"`, so the driver error never reaches the refusal. @complexity O(1). */
async function readRosterRefusal(
  { roster, connectionId, call }: { roster: ConnectionRosterReader; connectionId: string; call: FederatedCallTarget },
  { scope, report }: { scope: string | undefined; report: (required: FederatedRevocationDiagnostic) => void },
): Promise<{ record: ConnectionRosterSnapshot | null; reason: ExternalMcpRevocationReason | null }> {
  // A row that was read but cannot be judged keeps its label on the refusal.
  let record: ConnectionRosterSnapshot | null = null;
  try {
    record = await roster.findByServerId({ serverId: connectionId }, scopeOption(scope));
    return { record, reason: rosterRefusalFor({ record, call }) };
  } catch (error) {
    report({ connectionId, stage: "store", error });
    return { record, reason: "unverifiable" };
  }
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
} = {}): (required: { connectionId: string; call: FederatedCallTarget }) => Promise<void | FederatedGateVerdict> {
  const report = (diagnostic: FederatedRevocationDiagnostic) => {
    try { optional.onDiagnostic?.(diagnostic); } catch { /* Diagnostics cannot bypass refusal. */ }
  };
  return async ({ connectionId, call }) => {
    if (call.origin?.kind === "preset") return;
    const { record, reason } = await readRosterRefusal({ roster: required.roster, connectionId, call }, { scope: optional.scope, report });
    if (reason === null) return "current-grants-checked";
    const refusal = { serverId: connectionId, label: record?.label ?? null, remoteName: call.remoteName, reason };
    try { await optional.webhooks?.connectionRefused(refusal, scopeOption(optional.scope)); }
    catch (error) { report({ connectionId, stage: "webhook", error }); }
    throw required.errorFactory.create(refusal);
  };
}
