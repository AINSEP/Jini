import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";

/** Host-owned hash and fresh actor-identity policy, shared with every other gated ceremony. */
export interface RecoveryHookPolicy {
  planHashOf(required: { details: unknown }, optional?: Record<string, never>): string;
  resolveActorClassIdentity: GatedMutationHooks<unknown, unknown>["resolveActorClassIdentity"];
}
