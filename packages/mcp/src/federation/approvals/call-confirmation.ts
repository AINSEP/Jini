import { nowIso } from "@jini-ai/core/primitives";
import type { FederationMessages } from "../messages.js";
import type { FederatedCallConfirmationOutcome, FederatedCallConfirmationRequest } from "../ports.js";
import { federatedToolApprovalFingerprint } from "../tool-approvals.js";
import type { ConversationToolApprovalKey } from "../tool-approvals.js";
import type {
  FederatedApprovalDeps, FederatedApprovalDiagnostic, FederatedCallConfirmerOptions, FederatedCallConfirmerRequired,
  FederatedCardOffers, FederatedConfirmationContext, FederatedConfirmationSpec, FederatedConfirmCallInput,
} from "./ports.js";

const INLINE_ARGUMENT_MAX_LENGTH = 60;

function argumentDetail(name: string, value: unknown): FederatedConfirmationSpec["details"][number] {
  if (typeof value === "string") {
    return value.length > INLINE_ARGUMENT_MAX_LENGTH || value.includes("\n") ? { label: name, value, format: "code" } : { label: name, value };
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return { label: name, value: String(value) };
  return { label: name, value: JSON.stringify(value, null, 2) ?? String(value), format: "code" };
}

/** Pure card data. The host supplies branding; the caller supplies already frozen call arguments. */
export function buildFederatedCallConfirmSpec(
  { request, messages, errorCode }: { request: FederatedCallConfirmationRequest; messages: FederationMessages; errorCode: string },
  { offers = { offerChat: false, offerAlways: false } }: { offers?: FederatedCardOffers } = {},
): FederatedConfirmationSpec {
  const argumentRows = Object.entries(request.arguments).map(([name, value]) => argumentDetail(name, value));
  const alternatives: NonNullable<FederatedConfirmationSpec["alternatives"]>[number][] = [];
  if (request.writeShapedInputs.length === 0) {
    if (offers.offerChat) alternatives.push({ id: "allow-chat", label: messages.allowChatLabel, choice: "chat" });
    if (offers.offerAlways && !request.destructive) alternatives.push({ id: "allow-always", label: messages.allowAlwaysLabel, choice: "always" });
  }
  return {
    toolId: request.toolId, errorCode, title: messages.confirmationTitle({ request }),
    description: messages.confirmationDescription,
    details: [{ label: messages.serviceLabel, value: request.connectionLabel }, { label: messages.toolLabel, value: request.remoteName },
      ...(argumentRows.length ? argumentRows : [{ label: messages.argumentsLabel, value: messages.noArguments }])],
    warning: messages.confirmationWarning({ request }),
    danger: request.destructive, confirmLabel: messages.confirmLabel, ...(alternatives.length ? { alternatives } : {}),
  };
}

interface ApprovalContext {
  readonly fingerprint: string;
  readonly chatKey: ConversationToolApprovalKey | undefined;
  readonly alwaysKey: { serverId: string; toolName: string } | undefined;
}

function approvalContext(context: FederatedConfirmationContext, request: FederatedCallConfirmationRequest, approvals: FederatedApprovalDeps | undefined, fingerprintDomain: string): ApprovalContext {
  const fingerprint = federatedToolApprovalFingerprint({ identity: request, fingerprintDomain });
  const conversationId = approvals?.conversationIdForRun?.({ runId: context.run.id });
  return {
    fingerprint,
    chatKey: approvals?.chat && conversationId ? { conversationId, principalId: context.principal.id, connectionId: request.connectionId, toolName: request.remoteName, fingerprint } : undefined,
    alwaysKey: approvals?.always && request.origin?.kind === "roster" ? { serverId: request.connectionId, toolName: request.remoteName } : undefined,
  };
}

async function isRemembered(approvals: FederatedApprovalDeps, request: FederatedCallConfirmationRequest, keys: ApprovalContext, options: FederatedCallConfirmerOptions): Promise<boolean> {
  if (request.writeShapedInputs.length > 0) return false;
  if (keys.alwaysKey && approvals.always) {
    const saved = await approvals.always.find(keys.alwaysKey, options.scope === undefined ? {} : { scope: options.scope });
    if (saved && saved.fingerprint === keys.fingerprint && !request.destructive) return true;
    if (saved) await approvals.always.delete(keys.alwaysKey, options.scope === undefined ? {} : { scope: options.scope });
  }
  return keys.chatKey !== undefined && approvals.chat !== undefined && await approvals.chat.has(keys.chatKey);
}

function report(options: FederatedCallConfirmerOptions, diagnostic: FederatedApprovalDiagnostic): void {
  // Observability must never turn an explicit approval into a failed mutation.
  try { options.onPersistenceError?.(diagnostic); } catch { /* Host diagnostic failures are isolated. */ }
}

async function remember(input: {
  context: FederatedConfirmationContext; request: FederatedCallConfirmationRequest; keys: ApprovalContext;
  approvals: FederatedApprovalDeps; choice: "chat" | "always"; options: FederatedCallConfirmerOptions;
}): Promise<void> {
  const { context, request, keys, approvals, choice, options } = input;
  let grantedAt: string;
  try {
    grantedAt = nowIso({ clock: approvals.clock });
    if (choice === "chat" && keys.chatKey && approvals.chat) await approvals.chat.grant({ key: keys.chatKey, grantedAt });
    else if (choice === "always" && keys.alwaysKey && approvals.always) await approvals.always.upsert({
      ...keys.alwaysKey, fingerprint: keys.fingerprint, grantedByPrincipalId: context.principal.id, grantedAt,
    }, options.scope === undefined ? {} : { scope: options.scope });
    else return;
  } catch (error) { report(options, { toolId: request.toolId, choice, stage: "store", error }); return; }
  try {
    await options.webhooks?.approvalRemembered({ principalId: context.principal.id,
      connectionId: request.connectionId, toolName: request.remoteName, fingerprint: keys.fingerprint, scope: choice, grantedAt }, options.scope === undefined ? {} : { scope: options.scope });
  } catch (error) { report(options, { toolId: request.toolId, choice, stage: "webhook", error }); }
}

/** Remembered-approval orchestration over host-owned storage, presentation and permission ports.
 * The host adapts the returned object-argument function to its federation runtime callback.
 * Lookup failures fail closed. Save failures allow the approved call and are reported via a port.
 */
export function createFederatedCallConfirmer<Context extends FederatedConfirmationContext, Exchanges>(
  required: FederatedCallConfirmerRequired<Context, Exchanges>, options: FederatedCallConfirmerOptions = {},
): (required: FederatedConfirmCallInput<Context>) => Promise<FederatedCallConfirmationOutcome> {
  return async ({ context, request }) => {
    const approvals = options.approvals;
    const keys = approvalContext(context, request, approvals, required.fingerprintDomain);
    if (approvals && await isRemembered(approvals, request, keys, options)) return { confirmed: true };
    const rememberable = request.writeShapedInputs.length === 0;
    const offerAlways = rememberable && !request.destructive && keys.alwaysKey !== undefined && approvals !== undefined
      && await approvals.mayAlwaysAllow({ principalId: context.principal.id }, options.scope === undefined ? {} : { scope: options.scope });
    const spec = buildFederatedCallConfirmSpec({ request, messages: required.messages, errorCode: required.errorCode }, {
      offers: { offerChat: rememberable && keys.chatKey !== undefined, offerAlways },
    });
    const outcome = await required.humanConfirm.ask({ context, surfaceExchanges: required.surfaceExchanges, spec });
    if (!outcome.confirmed) return outcome;
    // Never trust a remember scope the host did not offer, even with a valid one-call answer.
    const choice = spec.alternatives?.find(alternative => alternative.choice === outcome.choice)?.choice;
    if (approvals && choice) await remember({ context, request, keys, approvals, choice, options });
    return { confirmed: true };
  };
}
