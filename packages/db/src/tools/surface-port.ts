import type { ApprovalAnswer, ToolExecutionContext, ToolExecutionOptions } from "@jini-ai/core";
/** Structural surface protocol: transport, confirmation policy and builders belong to the consumer. */
import type { SurfaceEmission, SurfaceExchangeConversation, SurfaceExchangeStore, SurfaceAskThenReport } from "@jini-ai/core";
export type { SurfaceExchangeConversation as SurfaceExchange, SurfaceMessage } from "@jini-ai/core";
import type { DatabaseTransferPlan } from "./plan-store.js";
// The shared exchange ABI owns the deadline when the host tracks one. Read it immediately before
// constructing a card, so the host's countdown closes when the exchange stops waiting.
export interface TransferSurfacePorts {
  open(required: Parameters<SurfaceExchangeStore["open"]>[0], optional?: Record<string, never>): SurfaceExchangeConversation;
  /** Host transport only. The core approval owner calls it once for a replacement plan;
   * the host binds principal/tool/expiry and never accepts model input as consent. */
  confirmApproval(required: { ctx: ToolExecutionContext; plan: DatabaseTransferPlan }, optional: ToolExecutionOptions): Promise<ApprovalAnswer>;
  /** Must close in finally; outcome-delivery failures cannot replace a settled result. */
  askThenReport: SurfaceAskThenReport;
  destinationForm(exchangeId: string): SurfaceEmission;
  destinationOutcome(input: { exchangeId: string; state: "failure" | "success"; message: string }): SurfaceEmission;
  readonly dismissedParam: string;
  readonly addressField: string;
}
