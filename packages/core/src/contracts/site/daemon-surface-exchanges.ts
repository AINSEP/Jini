import type { ToolExecutionContext } from "../../tool-registry.js";
import type { ApprovalReceiptObserver } from "../../surface-exchanges.js";
import type { SurfaceExchangeStore } from "../../surface-exchanges.js";

/**
 * Cross-domain machinery a surface-raising tool needs that is not a domain dependency at all.
 *
 * Kept separate from `tool-registrations.ts`'s `AssistantToolRegistryDeps` on purpose: that bag is
 * "the same dependencies the admin HTTP routes are built from", which is what makes a tool call and
 * the equivalent human click reach identical domain code. An exchange store is not part of that
 * equivalence — it belongs to the assistant's transport, and only tools that talk to a human mid-call
 * ever touch it. Declared in this module rather than alongside the registration wiring so a tool can
 * name it without importing the file that imports the tool.
 */
export interface AssistantSurfaceDeps {
  /** The handlers and callback route must share this same in-process store. Opening in one store
   * and delivering to another leaves the human's answer unreachable until the deadline expires. */
  readonly surfaceExchanges: SurfaceExchangeStore;
}

/** Host port carried alongside the existing authenticated human exchange. */
export type ChatDeleteSurfaceDeps = AssistantSurfaceDeps & {
  assertChatDeleteAllowed?: (required: { toolId: string; principalId?: string }, optional?: Record<string, never>) => Promise<void>;
  /** Re-read the human identity before displaying and after accepting a fresh access card. */
  assertAccessApprover?: (required: { toolId: string; principalId: string }, optional?: Record<string, never>) => Promise<void>;
};

/**
 * Surfaces for a confirmation, plus one OPTIONAL observe-only port (P3-T3.T). Why optional and
 * per-call: only a trusted routine run has somewhere to project "waiting for approval", so every
 * other run gets `undefined` and opens exactly the exchange it always did. The port can never answer:
 * it receives the exchange's own receipts and, with `restorable: false`, refuses to restart a closed
 * invocation after a late answer (a routine has no tab that could legitimately bring it back).
 */
export type HumanConfirmSurfaceDeps = ChatDeleteSurfaceDeps & {
  approvalReceiptsFor?: (required: { ctx: Pick<ToolExecutionContext, "run" | "principal"> }, optional?: Record<string, never>) =>
    { onApprovalReceipt: ApprovalReceiptObserver; restorable?: false } | undefined;
};
