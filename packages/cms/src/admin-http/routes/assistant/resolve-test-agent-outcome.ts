import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";

export type TestAgentOutcome = { ok: boolean; message: string };

/** Formats "<name> <version>" (version omitted when unknown), trimmed. @complexity O(1). */
function describeAgent(agent: DetectedAgent): string {
  return `${agent.name} ${agent.version ?? ""}`.trim();
}

/**
 * True when the operator's saved model pick no longer appears in the agent's current model list.
 * See the caller's own comment for why this is checked separately from auth status.
 *
 * @complexity O(models on the agent).
 */
function modelNoLongerOffered({ agent, model }: { agent: DetectedAgent; model: string }, _optional = {}): boolean {
  return Boolean(model && agent.models?.length && !agent.models.some((option) => option.id === model));
}

/**
 * Pure decision logic behind `test-agent.ts`'s POST route — split out of that route handler so the
 * installed/authenticated/model-mismatch/success branches (everything AFTER "the CLI was found on
 * PATH") can be unit-tested directly against fabricated `DetectedAgent` objects.
 *
 * Why this had to move: `test-agent.ts` calls `detectAgents()` (a real, no-network local PATH scan
 * + auth probe) as a direct static import, not through an injectable dep, so those branches used to
 * be reachable only by whichever CLIs happen to be installed and authenticated on the machine
 * running the suite — see the host's execution-route test header, which documents this
 * as an "accepted coverage gap." Faking `detectAgents()` itself would need Node's `mock.module()`,
 * gated behind `--experimental-test-module-mocks`, a flag this repo's test scripts do not pass.
 * `resolveTestAgentOutcome` needs no PATH scan, no subprocess, and no module mock — just an object
 * literal — so all four branches below are now deterministic regardless of host.
 *
 * Only called once `agent` is already known non-null and `agent.available` — the route's own
 * "not found on this server's PATH" branch is unaffected and stays covered at the HTTP level in
 * the host's execution-route tests.
 */
export function resolveTestAgentOutcome({ agent, model }: { agent: DetectedAgent; model: string }, _optional = {}): TestAgentOutcome {
  if (agent.authStatus === "missing") {
    return {
      ok: false,
      message: agent.authMessage ?? `${agent.name} is installed but not authenticated.`,
    };
  }

  if (agent.authStatus === "unknown") {
    // Not a failure: the adapter declares no auth probe, or its probe could not be classified.
    // Saying "ready" would overstate what was checked, so the message says exactly what was and
    // was not verified.
    return {
      ok: true,
      message: describeAgent(agent) + " responded, but its sign-in status could not be verified.",
    };
  }

  // The caller sends the operator's current per-agent model pick, so check it. A saved selection
  // survives a model list changing under it (the card deliberately keeps a stale pick selectable
  // rather than silently snapping to another model), which means "the CLI is authenticated" and
  // "the model you chose still exists" are different questions. Answering only the first with a
  // green result would tell the operator a run will work when it cannot.
  if (modelNoLongerOffered({ agent, model })) {
    return {
      ok: false,
      message:
        `${agent.name} is installed and authenticated, but it no longer offers the model '${model}'. ` +
        "Pick a different model, or Rescan to refresh the list.",
    };
  }

  return {
    ok: true,
    message: describeAgent(agent) + (model ? ` is installed and authenticated, and offers '${model}'.` : " is installed and authenticated."),
  };
}
