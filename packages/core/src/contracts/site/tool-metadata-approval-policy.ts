import type { ToolApprovalMetadata } from "../../tool-metadata-types.js";

/** The approval classes a domain declares for an action; one shared union with {@link ToolApprovalMetadata}. */
export type ToolApprovalClass = ToolApprovalMetadata["class"];

/**
 * A host's reviewed approval declaration for one tool. `rule` is host-owned (see
 * {@link ToolApprovalMetadata.rule}): the host narrows `Rule` to its own named input-classification
 * rules, and keeps those names and their rationale beside its catalog and evaluator, not here.
 * Extending the core metadata keeps every specialization assignable to `ToolMetadata<A>`.
 */
export interface ToolApprovalPolicy<Rule extends string = string> extends ToolApprovalMetadata {
  readonly rule?: Rule;
}
