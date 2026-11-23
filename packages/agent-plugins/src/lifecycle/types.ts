/** Lifecycle value contracts shared by host ports and implementations. */
/**
 * How a pinned ref's content reaches the agent.
 *
 * - `inject` — the whole eponymous SKILL.md (~15KB for `ui-ux-design`) plus its readable supporting-file inventory
 *   listed relative to the skill folder, in the run's prompt prefix. Today's shipped behaviour, and the default.
 * - `pointer` — ~400 bytes naming the exact tool call that returns that SAME SKILL.md, and nothing
 *   else. The content is identical; only the delivery differs, which is what makes the two a
 *   controlled comparison rather than two different experiments.
 *
 * Selected per-process by the host-supplied `deliveryMode` port. This is a MEASUREMENT AFFORDANCE, not a
 * migration flag: pointer and inject must coexist to compare delivery of identical content.
 * Selecting an unconditional mode requires the measurement result.
 */
export type AgentPluginDeliveryMode = "inject" | "pointer";

