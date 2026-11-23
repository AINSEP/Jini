import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { resolveTestAgentOutcome, type TestAgentOutcome } from "./resolve-test-agent-outcome.js";
import { ASSISTANT_ROUTE_PREFIX, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's local-CLI detection (the host picks its inventory or runtime default). */
export interface TestAgentRouteDeps extends AssistantPermissionDeps {
  /** Detects the named CLIs on the server host; called with `{ force: true }` so a re-check is never cached. */
  detectAgents: (required: { agentIds: string[] }, optional: { force: boolean }) => Promise<DetectedAgent[]>;
}

/** This route's two body fields, trimmed, read off an untyped body in one place. */
export interface TestAgentInput { agentId: string; model: string }

/** Select the requested CLI, retaining the route's missing-PATH verdict before readiness checks.
 * @complexity O(agents).
 */
function detectedTestAgentOutcome(
  { agents, agentId, model }: { agents: DetectedAgent[]; agentId: string; model: string },
  _options: Record<string, never> = {},
): TestAgentOutcome {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent || !agent.available) {
    return { ok: false, message: `'${agentId}' was not found on this server's PATH.` };
  }
  // Branch logic (installed/authenticated/model-mismatch/success) lives in
  // `resolveTestAgentOutcome` — a pure function so it can be unit-tested against fabricated
  // `DetectedAgent` objects instead of depending on which CLIs happen to be installed and
  // authenticated on the host running the suite. See that file's doc for why.
  return resolveTestAgentOutcome({ agent, model });
}

/**
 * POST a per-agent check: is the named local CLI installed, authenticated, and does it still offer
 * the operator's chosen model? Authorization runs before the `agentId` check (400 `BAD_REQUEST`).
 * Answers `{ ok, message }` — a failed check is a 200 with `ok: false`, not an HTTP error.
 */
export const testAgentRoute = defineJsonRoute<TestAgentInput, TestAgentOutcome, TestAgentRouteDeps, AssistantRoutePrincipal>({
  method: "post",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution/test-agent`,
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    return ok({ value: { agentId: String(body.agentId ?? "").trim(), model: String(body.model ?? "").trim() } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-execution" });
    const { agentId, model } = input;
    if (!agentId) throw new RouteRefusalError({ status: 400, body: { error: "'agentId' is required", code: "BAD_REQUEST" } });
    const agents = await deps.detectAgents({ agentIds: [agentId] }, { force: true });
    return ok({ value: detectedTestAgentOutcome({ agents, agentId, model }) });
  },
});
