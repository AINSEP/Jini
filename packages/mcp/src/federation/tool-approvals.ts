import { createHash } from "node:crypto";


import type { FederatedConnectionOrigin, RemoteToolDescriptor } from "./ports.js";

/**
 * Shared remembered approvals for external servers, agent plugins and integrations; no plugin
 * configuration is read here. Chat grants belong to a conversation AND a person, so another
 * person's conversation id cannot reuse them. Always grants belong beside a connection in the
 * host store, for its operator to list and revoke. A fingerprint pins both scopes to exactly the
 * admitted tool; changes to server identity, hints, description or schema ask again.
 * Destructive calls always require a fresh one-call answer and never use either remembered scope.
 *
 * How long a person's answer on the card should count. `once` is the plain "Allow".
 */
export type FederatedApprovalScope = "once" | "chat" | "always";

/** Everything that identifies a tool for a remembered approval — change any of it and it asks again. */
export interface FederatedToolIdentity {
  readonly connectionId: string;
  readonly remoteName: string;
  /** The hints recorded when the tool was admitted (`AdmittedFederatedTool.declaredAnnotations`). */
  readonly declaredAnnotations: RemoteToolDescriptor["annotations"] | undefined;
  /**
   * Where the connection came from. A roster connection's `admissionRevision` already changes when
   * its url/command/args/transport/auth mode/credential or the row itself changes
   * (`externalMcpAdmissionRevision`), which is what "the server changed" means here.
   */
  readonly origin: FederatedConnectionOrigin | undefined;
  /** The description the model reads, as admitted (`AdmittedFederatedTool.description`). */
  readonly description: string;
  /** The input schema, as admitted. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** Stable JSON: object keys sorted at every depth, so the same hints always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The fingerprint a remembered approval is saved under and later matched against: the connection,
 * the server it reaches (its origin and admission revision), the remote tool name, its declared
 * hints, the description the model reads and its input schema — so any drift in what the tool says
 * about itself voids the approval. Object keys are sorted first, so key order alone never counts as
 * drift. Hashed, because an admission revision is itself derived from values that can carry
 * credentials and this string is stored and compared, never shown.
 *
 * The host supplies the persisted domain. Changing it invalidates remembered grants.
 * The v2 revision (2026-09-27, "hint drift") added description and input schema: v1 grants
 * no longer matched, asked once and were saved again. A host must keep its chosen bytes stable.
 *
 * @complexity O(h + s) in the size of the hints and the schema.
 */
export function federatedToolApprovalFingerprint({ identity, fingerprintDomain }: { identity: FederatedToolIdentity; fingerprintDomain: string }): string {
  const origin = identity.origin === undefined ? null : identity.origin.kind === "roster" ? ["roster", identity.origin.admissionRevision] : ["preset"];
  return createHash("sha256")
    .update(
      canonicalJson([
        fingerprintDomain,
        identity.connectionId,
        origin,
        identity.remoteName,
        identity.declaredAnnotations ?? null,
        identity.description,
        identity.inputSchema,
      ]),
    )
    .digest("hex");
}

/** One saved "Always allow". */
export interface ExternalMcpToolApprovalRecord {
  readonly scope?: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly fingerprint: string;
  readonly grantedByPrincipalId: string;
  readonly grantedAt: string;
}

/** The "Always allow" store (`external_mcp_tool_approvals`). */
export interface ExternalMcpToolApprovalRepoPort {
  find(input: { serverId: string; toolName: string }, optional?: { scope?: string }): Promise<ExternalMcpToolApprovalRecord | null>;
  /** Inserts, or replaces the fingerprint/grant of, the one row for scope + connection + tool. */
  upsert(record: Omit<ExternalMcpToolApprovalRecord, "scope">, optional?: { scope?: string }): Promise<void>;
  listByScope(input: Record<string, never>, optional?: { scope?: string }): Promise<ExternalMcpToolApprovalRecord[]>;
  /** @returns Whether a row was removed. */
  delete(input: { serverId: string; toolName: string }, optional?: { scope?: string }): Promise<boolean>;
}

/** One saved "Allow for this chat". */
export interface ConversationToolApprovalKey {
  readonly conversationId: string;
  readonly principalId: string;
  readonly connectionId: string;
  readonly toolName: string;
  readonly fingerprint: string;
}

/** The "Allow for this chat" store, kept with the conversation (`chat.db`). */
export interface ConversationToolApprovalStore {
  /** True only for this conversation AND this person AND this exact fingerprint. */
  has(key: ConversationToolApprovalKey): Promise<boolean>;
  grant(input: { key: ConversationToolApprovalKey; grantedAt: string }): Promise<void>;
}
