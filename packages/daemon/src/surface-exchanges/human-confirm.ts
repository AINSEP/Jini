import { createApprovalHandler, createBatchApprovalHandler, type ApprovalSteps, type HumanConfirmer, type RememberedApprovalPort, type ToolHandler } from '@jini-ai/core';
import { ToolInputError, type AccessApprovalDescription, type SurfaceEmitter, type ToolExecutionContext, type ToolExecutionOptions } from "@jini-ai/core";
import type { ChatDeleteSurfaceDeps, HumanConfirmSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec, HumanConfirmAlternative } from "@jini-ai/core/contracts/site/human-confirm";
import type { UIResource } from "@jini-ai/core/contracts/site/protocol-mcp-ui";
import { askOnce, classifyConfirmationAnswer, type ConfirmationOutcome } from "../surface-exchanges.js";

/** Keep the lease (signal, run, principal) but make its retry a no-op, so a late answer restores nothing. */
function withoutRestore(emit: SurfaceEmitter, _optional = {}): SurfaceEmitter {
  const lifetime = emit.exchangeLifetime;
  if (!lifetime) return emit;
  return Object.assign((emission: Parameters<SurfaceEmitter>[0]) => emit(emission), { exchangeLifetime: { ...lifetime, retry: async () => {} } });
}

/** The params key an alternative's `choice` rides under. */
export const HUMAN_CONFIRM_CHOICE_PARAM = "choice";

/**
 * {@link ConfirmationOutcome}, plus which offered alternative the person clicked. `choice` is set
 * only on a confirm made through an alternative that was actually on the card.
 */
export type HumanConfirmOutcome = { confirmed: true; choice?: string } | Extract<ConfirmationOutcome, { confirmed: false }>;

/**
 * Shows the confirmation dialog and waits for the human's answer.
 *
 * @throws {ToolInputError} `<errorCode>_NO_CONFIRMATION_CHANNEL` when the call has no
 *   `emitSurface` (a headless run): no human can be asked, so nothing runs.
 * @returns Fail-closed: only an explicit confirm click is `{ confirmed: true }`.
 * @complexity O(d) card rendering time/space for d detail bytes, two injected grant reads for
 * permanent-delete tools, plus the wait for the human.
 */
export async function requireHumanConfirm(
  { ctx, surfaces, spec, requireDeleteGrant, render }: { ctx: ToolExecutionContext; surfaces: HumanConfirmSurfaceDeps; spec: HumanConfirmSpec; requireDeleteGrant: (required: { surfaces: ChatDeleteSurfaceDeps; toolId: string; principalId: string }) => Promise<void>; render: (required: { spec: HumanConfirmSpec; exchange: ReturnType<ChatDeleteSurfaceDeps["surfaceExchanges"]["open"]>; alternatives: readonly HumanConfirmAlternative[] }) => UIResource },
  { emitSurface }: ToolExecutionOptions = {},
): Promise<HumanConfirmOutcome> {
  await requireDeleteGrant({ surfaces, toolId: spec.toolId, principalId: ctx.principal.id });
  await requireAccessApprover({ surfaces, principalId: ctx.principal.id, toolId: spec.toolId, access: spec.access });
  if (!emitSurface) {
    throw new ToolInputError({ message: `${spec.errorCode}_NO_CONFIRMATION_CHANNEL: ${spec.toolId}: this execution context has no interactive ` +
        "confirmation channel (no emitSurface), so a human cannot approve this action here. Nothing was changed." });
  }
  // An abort listener cannot observe an event that already fired. Refuse before opening an
  // exchange so a completed run never creates a new card or waits for its idle deadline.
  if (ctx.signal.aborted) return { confirmed: false, reason: "abandoned" };
  const exchange = openConfirmation({ ctx, surfaces, spec, emitSurface });
  const alternatives = spec.alternatives ?? [];
  const resource = render({ spec, exchange, alternatives });

  const closeOnAbort = () => exchange.close({});
  ctx.signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    const answer = await askOnce({ exchange, emission: { channel: "mcp-ui", payload: { resource } } });
    const outcome = classifyConfirmationAnswer({ answer });
    if (!outcome.confirmed || answer.status !== "received") return outcome;
    await requireAccessApprover({ surfaces, principalId: ctx.principal.id, toolId: spec.toolId, access: spec.access });
    // A revoke while the human reads the card takes effect before the domain effect resumes.
    await requireDeleteGrant({ surfaces, toolId: spec.toolId, principalId: ctx.principal.id });
    const choice = answer.params[HUMAN_CONFIRM_CHOICE_PARAM];
    const offered = alternatives.some((alternative) => alternative.choice === choice);
    return offered && typeof choice === "string" ? { confirmed: true, choice } : { confirmed: true };
  } finally {
    ctx.signal.removeEventListener("abort", closeOnAbort);
  }
}

/** Re-read the active person before disclosure and before resuming the domain writer.
 * Domain writers retain their own current permission and revision checks. */
export async function requireAccessApprover({ surfaces, principalId, toolId, access }: {
  surfaces: ChatDeleteSurfaceDeps; principalId: string; toolId: string; access: AccessApprovalDescription | undefined;
}, _optional = {}): Promise<void> {
  if (!access) return;
  if (access.resources.some(resource => resource.scope.personId !== principalId)) throw new ToolInputError({ message: `${toolId}: this access proposal belongs to another person. Nothing was changed. Request access for your own signed-in session.` });
  if (!surfaces.assertAccessApprover) throw new ToolInputError({ message: `${toolId}: this chat cannot verify the person approving access. Nothing was changed. Reopen the chat in your signed-in admin session.` });
  await surfaces.assertAccessApprover({ toolId, principalId });
}

function openConfirmation({ ctx, surfaces, spec, emitSurface }: { ctx: ToolExecutionContext; surfaces: HumanConfirmSurfaceDeps; spec: HumanConfirmSpec; emitSurface: SurfaceEmitter }) {
  // Shorthand `{ toolId }` on purpose: the allowlist completeness scan resolves the `toolId` of
  // each `requireHumanConfirm` CALL instead, and skips this parameterised open.
  const { toolId } = spec;
  // Observe-only and synchronous inside the exchange; the answer below still comes only from the card.
  const receipts = surfaces.approvalReceiptsFor?.({ ctx });
  const exchange = receipts
    ? surfaces.surfaceExchanges.open({ binding: { toolId, principalId: ctx.principal.id },
      emit: receipts.restorable === false ? withoutRestore(emitSurface) : emitSurface }, { onApprovalReceipt: receipts.onApprovalReceipt })
    : surfaces.surfaceExchanges.open({ binding: { toolId, principalId: ctx.principal.id }, emit: emitSurface });
  return exchange;
}

/**
 * The model-facing result for an answer that was not a confirm — one wording for every gated tool,
 * so the model learns one shape: `cancelled: true` means the human said no; otherwise `reason` says
 * why no answer came. Spread it next to the tool's own `<verb>ed: false` flag.
 *
 * @complexity O(1).
 */
export function notConfirmedResult(outcome: Extract<ConfirmationOutcome, { confirmed: false }>): {
  cancelled: boolean;
  reason?: "expired" | "abandoned";
  note: string;
} {
  if (outcome.reason === "declined") return { cancelled: true, note: "The user cancelled. Nothing was changed." };
  return {
    cancelled: false,
    reason: outcome.reason,
    note:
      outcome.reason === "expired"
        ? "The user did not answer the confirmation dialog before it expired. Nothing was changed. Do not retry this action or reopen its confirmation automatically. Tell the user it expired and nothing changed, then wait for a new explicit request."
        : "The confirmation dialog was closed because the run ended. Nothing was changed.",
  };
}

/** Bind domain descriptions to the one Jini approval lifecycle and authenticated browser transport.
 * The host keeps wording and result flags; Jini freezes inputs, binds the actor and handles aborts.
 * Existing gated-mutation handlers use the compatibility adapter above so their gateway ceremonies
 * and actor-rule registration proof stay intact.
 * @returns A branded handler; missing transport and storage failures remain fail-closed.
 * @example approvalToolHandler({ surfaces, prepare, describe, run }, { flag: 'removed' });
 */
export function approvalToolHandler<TPrepared>(
  { surfaces, prepare, describe, run, confirm, combineDescriptions }: {
    surfaces: HumanConfirmSurfaceDeps;
    confirm: (required: { ctx: ToolExecutionContext; surfaces: HumanConfirmSurfaceDeps; spec: HumanConfirmSpec }, optional: ToolExecutionOptions) => Promise<HumanConfirmOutcome>;
    combineDescriptions: (required: { descriptions: readonly HumanConfirmSpec[] }) => HumanConfirmSpec;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<TPrepared>;
    describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  },
  { flag = 'executed', ask = () => true, rememberKey, remembered, declined, batch = false }: {
    flag?: string;
    ask?: (required: { prepared: TPrepared }) => boolean;
    rememberKey?: (required: { prepared: TPrepared }) => string | undefined;
    remembered?: RememberedApprovalPort;
    declined?: (required: { reason: 'declined' | 'expired' | 'abandoned'; prepared?: TPrepared }) => unknown;
    batch?: boolean;
  } = {},
): ToolHandler {
  const steps: ApprovalSteps<TPrepared, HumanConfirmSpec> = {
    prepare,
    describe: async ({ ctx, prepared }) => {
      const description = await describe({ ctx, prepared });
      return description.access
        ? { kind: 'access', ask: true, description, access: description.access }
        : { ask: ask({ prepared }), description, rememberKey: rememberKey?.({ prepared }) };
    },
    askHuman: ({ ctx, description }, options) => confirm({ ctx, surfaces, spec: description }, options),
    run,
    notConfirmed: declined ?? (({ reason }) => ({ [flag]: false, ...notConfirmedResult({ confirmed: false, reason }) })),
  };
  if (batch) return createBatchApprovalHandler({ steps, combineDescriptions });
  return createApprovalHandler(steps, { remembered });
}
