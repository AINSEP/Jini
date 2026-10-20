import { nowIso } from "@jini-ai/core/primitives";
import type { FederatedCallConfirmationRequest } from "../ports.js";
import { federatedToolApprovalFingerprint } from "../tool-approvals.js";
import type { ConversationToolApprovalKey } from "../tool-approvals.js";
import type {
  FederatedApprovalDeps, FederatedApprovalDiagnostic, FederatedCallConfirmerOptions, FederatedCardOffers, FederatedConfirmationContext,
} from "./ports.js";
import { scopeOption } from "./scope-option.js";

/** The lookup keys one call's remembered approvals are stored under. A key is absent when the
 *  host cannot persist that scope: no store, no conversation, or (always) not a roster origin. */
export interface ApprovalContext {
  readonly fingerprint: string;
  readonly chatKey: ConversationToolApprovalKey | undefined;
  readonly alwaysKey: { serverId: string; toolName: string } | undefined;
}

/** @complexity O(1) beyond the fingerprint hash. */
export function approvalContext(context: FederatedConfirmationContext, request: FederatedCallConfirmationRequest, approvals: FederatedApprovalDeps | undefined, fingerprintDomain: string): ApprovalContext {
  const fingerprint = federatedToolApprovalFingerprint({ identity: request, fingerprintDomain });
  const conversationId = approvals?.conversationIdForRun?.({ runId: context.run.id });
  return {
    fingerprint,
    chatKey: approvals?.chat && conversationId ? { conversationId, principalId: context.principal.id, connectionId: request.connectionId, toolName: request.remoteName, fingerprint } : undefined,
    alwaysKey: approvals?.always && request.origin?.kind === "roster" ? { serverId: request.connectionId, toolName: request.remoteName } : undefined,
  };
}

/** Whether a saved always grant authorizes this call. A saved grant that does not (stale
 *  fingerprint, or a destructive call) is removed so the operator's list stops claiming it is
 *  still valid. Lookup and delete failures propagate: remembered lookups fail closed. */
async function alwaysGrantAuthorizes(approvals: FederatedApprovalDeps, request: FederatedCallConfirmationRequest, keys: ApprovalContext, options: FederatedCallConfirmerOptions): Promise<boolean> {
  if (!keys.alwaysKey || !approvals.always) return false;
  const saved = await approvals.always.find(keys.alwaysKey, scopeOption(options.scope));
  if (saved && saved.fingerprint === keys.fingerprint && !request.destructive) return true;
  if (saved) await approvals.always.delete(keys.alwaysKey, scopeOption(options.scope));
  return false;
}

/** Whether a remembered grant lets this call skip its card. A write-shaped call never does. */
export async function isRemembered(approvals: FederatedApprovalDeps, request: FederatedCallConfirmationRequest, keys: ApprovalContext, options: FederatedCallConfirmerOptions): Promise<boolean> {
  if (request.writeShapedInputs.length > 0) return false;
  if (await alwaysGrantAuthorizes(approvals, request, keys, options)) return true;
  // Neither a matching chat grant nor an always grant can authorize permanent deletion.
  if (request.destructive) return false;
  return keys.chatKey !== undefined && approvals.chat !== undefined && await approvals.chat.has(keys.chatKey);
}

/** Whether the card may offer "always": only with an always key, approval deps, and the host's
 *  per-principal permission. {@link cardOffers} has already excluded destructive and write-shaped calls. */
async function mayOfferAlways({ principalId, keys, approvals, options }: {
  principalId: string; keys: ApprovalContext; approvals: FederatedApprovalDeps | undefined; options: FederatedCallConfirmerOptions;
}): Promise<boolean> {
  if (keys.alwaysKey === undefined || approvals === undefined) return false;
  return approvals.mayAlwaysAllow({ principalId }, scopeOption(options.scope));
}

/** The remember buttons this call's card may offer. A destructive or write-shaped call offers
 *  none, and the host's always permission is then not even consulted. */
export async function cardOffers({ request, principalId, keys, approvals, options }: {
  request: FederatedCallConfirmationRequest; principalId: string; keys: ApprovalContext;
  approvals: FederatedApprovalDeps | undefined; options: FederatedCallConfirmerOptions;
}): Promise<FederatedCardOffers> {
  if (request.destructive || request.writeShapedInputs.length > 0) return { offerChat: false, offerAlways: false };
  return { offerChat: keys.chatKey !== undefined, offerAlways: await mayOfferAlways({ principalId, keys, approvals, options }) };
}

function report(options: FederatedCallConfirmerOptions, diagnostic: FederatedApprovalDiagnostic): void {
  // Observability must never turn an explicit approval into a failed mutation.
  try { options.onPersistenceError?.(diagnostic); } catch { /* Host diagnostic failures are isolated. */ }
}

interface RememberInput {
  context: FederatedConfirmationContext; request: FederatedCallConfirmationRequest; keys: ApprovalContext;
  approvals: FederatedApprovalDeps; choice: "chat" | "always"; options: FederatedCallConfirmerOptions;
}

/** Writes the chosen grant; `false` when that scope has no key or store, so nothing was saved. */
async function persistGrant({ context, keys, approvals, choice, options }: RememberInput, grantedAt: string): Promise<boolean> {
  if (choice === "chat" && keys.chatKey && approvals.chat) {
    await approvals.chat.grant({ key: keys.chatKey, grantedAt });
    return true;
  }
  if (choice === "always" && keys.alwaysKey && approvals.always) {
    await approvals.always.upsert({
      ...keys.alwaysKey, fingerprint: keys.fingerprint, grantedByPrincipalId: context.principal.id, grantedAt,
    }, scopeOption(options.scope));
    return true;
  }
  return false;
}

/** Saves one explicitly chosen grant, then notifies. Save and notification failures are reported
 *  via `onPersistenceError` and never fail the already approved call. */
export async function rememberApproval(input: RememberInput): Promise<void> {
  const { context, request, keys, choice, options } = input;
  // Defense in depth: a forged remember choice must not persist a destructive call's approval.
  if (request.destructive || request.writeShapedInputs.length > 0) return;
  let grantedAt: string;
  try {
    grantedAt = nowIso({ clock: input.approvals.clock });
    if (!await persistGrant(input, grantedAt)) return;
  } catch (error) { report(options, { toolId: request.toolId, choice, stage: "store", error }); return; }
  try {
    await options.webhooks?.approvalRemembered({ principalId: context.principal.id,
      connectionId: request.connectionId, toolName: request.remoteName, fingerprint: keys.fingerprint, scope: choice, grantedAt }, scopeOption(options.scope));
  } catch (error) { report(options, { toolId: request.toolId, choice, stage: "webhook", error }); }
}
