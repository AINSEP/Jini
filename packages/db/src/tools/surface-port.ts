/** Structural surface protocol: transport, confirmation policy and builders belong to the consumer. */
import type { SurfaceEmission, SurfaceEmitter } from "@jini-ai/core";
import type { DatabaseTransferPlan } from "./plan-store.js";
export type SurfaceMessage = { status: "received"; params: Record<string, unknown> } | { status: "expired" | "abandoned" };
export interface SurfaceExchange { readonly id: string; send(emission: SurfaceEmission): Promise<void>; receive(): Promise<SurfaceMessage>; close(): void; }
export interface TransferSurfacePorts {
  open(binding: { toolId: string; principalId: string }, emit: SurfaceEmitter): SurfaceExchange;
  /** Must close the exchange after receiving/classifying a decision, including errors. */
  resolveDecision(exchange: SurfaceExchange, emission: SurfaceEmission): Promise<{ confirmed: true } | { confirmed: false; reason: "declined" | "expired" | "abandoned" }>;
  /** Must close in finally; outcome-delivery failures cannot replace a settled result. */
  askThenReport<T>(exchange: SurfaceExchange, emission: SurfaceEmission, handle: (answer: SurfaceMessage) => Promise<{ result: T; outcome?: SurfaceEmission }>): Promise<T>;
  confirmation(plan: DatabaseTransferPlan, exchangeId: string): SurfaceEmission;
  destinationForm(exchangeId: string): SurfaceEmission;
  destinationOutcome(input: { exchangeId: string; state: "failure" | "success"; message: string }): SurfaceEmission;
  readonly dismissedParam: string;
  readonly addressField: string;
}
