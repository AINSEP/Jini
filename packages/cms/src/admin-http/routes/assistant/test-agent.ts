import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeAssistantExecution, resolveTestAgentOutcome,
  type AssistantExecutionRoutePrincipal, type ExecutionDetectedAgent, type TestAgentOutcome,
} from "./execution-shared.js";

/** The host's per-agent probe: a fresh, uncached detection scoped to the one requested id. */
export type TestAgentFn = (required: { agentId: string }, optional?: Record<string, never>) => Promise<readonly ExecutionDetectedAgent[]>;

/** The deps this route reads: the host's assistant-management permission and its scoped detector. */
export interface AssistantTestAgentRouteDeps {
  workspaceId: string;
  manageAssistantPermission: string;
  testAgent: TestAgentFn;
}

/** This route's two body fields, trimmed, read off an untyped body in one place.
 *  @complexity O(1). */
function parseTestAgentBody({ rawBody }: { rawBody: unknown }, _optional = {}): { agentId: string; model: string } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    agentId: String(body.agentId ?? "").trim(),
    model: String(body.model ?? "").trim(),
  };
}

/** Select the requested CLI, retaining the route's missing-PATH verdict before readiness checks.
 * @complexity O(n) time for n detected agents, O(1) additional space; no I/O.
 */
function detectedTestAgentOutcome(
  { agents, agentId, model }: { agents: readonly ExecutionDetectedAgent[]; agentId: string; model: string },
  _options: Record<string, never> = {},
): TestAgentOutcome {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent || !agent.available) {
    return { ok: false, message: `'${agentId}' was not found on this server's PATH.` };
  }

  // Branch logic (installed/authenticated/model-mismatch/success) lives in
  // `resolveTestAgentOutcome` — a pure function so it can be unit-tested against fabricated
  // detected-agent objects instead of depending on which CLIs happen to be installed and
  // authenticated on the host running the suite. See that function's doc for why.
  return resolveTestAgentOutcome({ agent, model });
}

/**
 * POST re-probes ONE detected code-agent CLI and reports whether it is usable — the per-agent Test
 * button. It deliberately does NOT dispatch a real prompt: a settings screen that silently bills the
 * operator for a model call is a different promise than "check this is set up".
 *
 * Outcome split: **200 `{ok:false}`** — the probe RAN and the CLI is not usable (missing, or needs
 * authentication); that verdict is the answer, so it is a value. **5xx** — the probe itself could
 * not run (rethrown for the host's 500); there is no verdict to report.
 */
export const assistantTestAgentRoute = defineJsonRoute<{ agentId: string; model: string }, TestAgentOutcome, AssistantTestAgentRouteDeps, AssistantExecutionRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution/test-agent",
  parse: (raw) => ok({ value: parseTestAgentBody({ rawBody: raw.body }) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistantExecution({ authorize, permission: deps.manageAssistantPermission });
    // After authorization, as the hand-written route checked it: an unauthorized caller gets the 403.
    if (!input.agentId) rejectRoute({ status: 400, error: "'agentId' is required", code: "BAD_REQUEST" });
    const agents = await deps.testAgent({ agentId: input.agentId });
    return ok({ value: detectedTestAgentOutcome({ agents, agentId: input.agentId, model: input.model }) });
  },
});
