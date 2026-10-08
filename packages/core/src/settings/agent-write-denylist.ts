/** One key or an entire namespace governed by a host's agent-write policy. */
export interface AgentSettingWriteRule {
  readonly namespace: string;
  readonly key?: string;
  readonly reason: string;
}

/** Owner decision 2026-10-01: these keys are writable with a HUMAN confirmation card.
 * Schema validation bounds the value, not which key. Keep that original concern explicit:
 * telemetry must record a human decision; custom instructions modify the assistant itself. */
export const AGENT_WRITE_CONFIRMATION_SETTINGS: readonly AgentSettingWriteRule[] = [
  { namespace: "core.privacy", reason: "Telemetry consent must record a human decision" },
  { namespace: "core.instructions", key: "custom", reason: "The assistant's own standing instructions are self-modification" },
];

/** No built-in permanent deny under the owner's updated rule. Hosts may add restrictions
 * through extraDeniedSettings; assistant self-configuration belongs in confirmation rules. */
export const AGENT_WRITE_DENIED_SETTINGS: readonly AgentSettingWriteRule[] = [];

/** Returns the first matching namespace/key rule, or undefined; pure, O(r) in fixed rules. */
export function findAgentWriteRule(rules: readonly AgentSettingWriteRule[], target: { namespace: string; key: string }): AgentSettingWriteRule | undefined {
  return rules.find((rule) => rule.namespace === target.namespace && (rule.key === undefined || rule.key === target.key));
}
