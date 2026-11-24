import type { GatedConfirmResult, GatedPlanResult } from "@jini-ai/core/contracts/site/gated-results";
import type { MigrateForwardResult as MigrateForwardExecuteResult } from "../../../core/index.js";

/**
 * @file What `use-migrate-forward-section.hooks.ts` needs from the outside world, as an interface
 * rather than a direct import of the host's HTTP client. Follows the `useX(dependencies)` /
 * `useWiredX()` pair the host keeps beside its port implementations.
 */
export interface MigrateForwardSectionPort {
  planMigrateForward(): Promise<GatedPlanResult>;
  confirmMigrateForward(input: { planId: string; planHash: string }, optional?: {}): Promise<GatedConfirmResult>;
  executeMigrateForward(required: { confirmationToken: string }, optional?: {}): Promise<MigrateForwardExecuteResult>;
}
