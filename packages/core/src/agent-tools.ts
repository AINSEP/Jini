/**
 * Shared vocabulary for independently classified agent-tool catalogs.
 *
 * `deletes-durable-state` is a distinct member rather than a flavor of `mutates-durable-state`, and
 * the distinction is load-bearing rather than cosmetic. Wiring gates compare the two
 * classifications for EQUALITY, so the strength of the check is exactly the resolution of the
 * vocabulary: folding a delete into `mutates-durable-state` would let a tool that removes content
 * from every read path carry the same declared risk as one that edits a title, and
 * the wiring gate would have nothing to object to. A separate member means a delete tool
 * whose declaration drifts toward the milder classification fails the build.
 *
 * Narrower domain-owned unions remain assignable to this shared vocabulary. Domains may tighten
 * their own catalogs without loosening the classification required by the wiring gate.
 */
export type AgentToolSideEffect =
  | "none"
  | "mutates-durable-state"
  | "deletes-durable-state"
  | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

/** Structural catalog contract. Domains may require inputSchema or tighten their own metadata. */
export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string; orPermission?: string };
  actorClassRule?: AgentToolActorClassRule;
  inputSchema?: Readonly<Record<string, unknown>>;
}
