import type { FederationMessages } from "../messages.js";
import type { FederatedCallConfirmationOutcome, FederatedCallConfirmationRequest } from "../ports.js";
import type {
  FederatedCallConfirmerOptions, FederatedCallConfirmerRequired,
  FederatedCardOffers, FederatedConfirmationContext, FederatedConfirmationSpec, FederatedConfirmCallInput,
} from "./ports.js";
import { approvalContext, cardOffers, isRemembered, rememberApproval } from "./remembered-approval.js";

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
  // Permanent deletion always needs this call's explicit answer, even if a host asks for scopes.
  if (!request.destructive && request.writeShapedInputs.length === 0) {
    if (offers.offerChat) alternatives.push({ id: "allow-chat", label: messages.allowChatLabel, choice: "chat" });
    if (offers.offerAlways) alternatives.push({ id: "allow-always", label: messages.allowAlwaysLabel, choice: "always" });
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

/** Remembered-approval orchestration over host-owned storage, presentation and permission ports.
 * The host adapts the returned object-argument function to its federation runtime callback.
 * Lookup failures fail closed. Save failures allow the approved call and are reported via a port.
 * A destructive or write-shaped call always asks again: neither remembered scope can skip its
 * card and no remember button is offered. The card and lookups are one mechanism for every
 * external server, agent plugin and integration; no per-plugin consent setting is read.
 * A stale always grant is removed so the operator's list stops claiming it is still valid.
 * Frozen arguments shown on the card are the arguments that run; a remembered grant changes
 * only whether a card is required, never what is sent. One explicit answer authorizes one call.
 */
export function createFederatedCallConfirmer<Context extends FederatedConfirmationContext, Exchanges>(
  required: FederatedCallConfirmerRequired<Context, Exchanges>, options: FederatedCallConfirmerOptions = {},
): (required: FederatedConfirmCallInput<Context>) => Promise<FederatedCallConfirmationOutcome> {
  return async ({ context, request }) => {
    const approvals = options.approvals;
    const keys = approvalContext(context, request, approvals, required.fingerprintDomain);
    if (approvals && await isRemembered(approvals, request, keys, options)) return { confirmed: true };
    const offers = await cardOffers({ request, principalId: context.principal.id, keys, approvals, options });
    const spec = buildFederatedCallConfirmSpec({ request, messages: required.messages, errorCode: required.errorCode }, { offers });
    const outcome = await required.humanConfirm.ask({ context, surfaceExchanges: required.surfaceExchanges, spec });
    if (!outcome.confirmed) return outcome;
    // Never trust a remember scope the host did not offer, even with a valid one-call answer.
    const choice = spec.alternatives?.find(alternative => alternative.choice === outcome.choice)?.choice;
    if (approvals && choice) await rememberApproval({ context, request, keys, approvals, choice, options });
    return { confirmed: true };
  };
}
