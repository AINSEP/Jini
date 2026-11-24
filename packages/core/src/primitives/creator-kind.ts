/**
 * Who created a durable, side-effecting record (a webhook, a scheduled send, an API key): a
 * person acting directly, or an agent acting through its tools. Hosts use it to pause only the
 * agent-made ones when their agent switch is off, without touching anything a person made.
 */
export type CreatorKind = "person" | "agent";

/** Every recognised creator kind, in a stable order (storage checks, menus, tests). */
export const CREATOR_KINDS: readonly CreatorKind[] = ["person", "agent"];

/**
 * Read a stored creator kind. Anything other than exactly `"agent"` (a missing value on a row
 * written before attribution existed, or an unknown string) is `"person"`, so an owner-made
 * record is never paused by mistake.
 * @example resolveCreatorKind({ value: undefined }) // "person"
 */
export function resolveCreatorKind(required: { value: unknown }, _optional: Record<string, never> = {}): CreatorKind {
  return required.value === "agent" ? "agent" : "person";
}

/**
 * Whether a record is paused by the agent switch: only agent-created records, and only while the
 * agent is off. Person-created records are never paused by it.
 * @example isPausedByAgentSwitch({ creatorKind: "agent", agentEnabled: false }) // true
 */
export function isPausedByAgentSwitch(
  required: { creatorKind: unknown; agentEnabled: boolean },
  _optional: Record<string, never> = {},
): boolean {
  return !required.agentEnabled && resolveCreatorKind({ value: required.creatorKind }) === "agent";
}
