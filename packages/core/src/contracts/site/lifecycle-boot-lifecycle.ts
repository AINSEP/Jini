/**
 * @file Per-module boot lifecycle outcome vocabulary. Types only.
 *
 * A host's boot orchestrator runs each module's `prepare`/`start` stages and records one
 * `BootModuleResult` per module it attempted; health and readiness surfaces read those results.
 * Only CRITICAL modules can fail the boot as a whole — optional-module failures never flip it. The
 * orchestrator, its module shape and its rollback loop stay with the host.
 */

export type ModuleLifecycleStatus =
  | { status: "ready" }
  | { status: "disabled"; reasonCode: string; remediationHint: string }
  | { status: "failed"; reasonCode: string; remediationHint: string };

export type BootCriticality = "critical" | "optional";

export interface BootModuleResult {
  name: string;
  owner: string;
  criticality: BootCriticality;
  lifecycle: ModuleLifecycleStatus;
}
