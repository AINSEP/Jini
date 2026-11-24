import type { AgentFailureHint } from "./agent-failure.js";

/** Only compatibility vendor data; other declarations arrive with the Jini runtime release. */
export const GEMINI_INELIGIBLE_HINT: AgentFailureHint = {
  category: "unsupported-client",
  patterns: ["IneligibleTierError", "no longer supported for Gemini Code Assist"],
  hint: "Google ended free sign-in for Gemini CLI. Switch to Antigravity, or set Gemini CLI to use an API key.",
  suggestedAgentId: "antigravity",
};

export function localFailureHints({ agentId }: { agentId: string | undefined }, _optional = {}): readonly AgentFailureHint[] {
  return agentId === "gemini" ? [GEMINI_INELIGIBLE_HINT] : [];
}
