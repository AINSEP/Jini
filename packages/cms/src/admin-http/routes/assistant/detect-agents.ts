import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { RuntimeModelOption } from "@jini-ai/core/contracts/agents";
import type { DetectedAgent as RuntimeDetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import type { AdminExecutionDetectedAgent } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

import { ASSISTANT_ROUTE_PREFIX, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";

/**
 * Narrows one model's OWN `reasoning` (`RuntimeModelOption.reasoning` — Codex's per-model effort
 * levels, populated by `parseCodexDebugModels`) to the `{id,label}` shape, or omits the field when
 * the runtime reported none.
 *
 * `undefined` here means "this runtime doesn't report per-model levels" (see that field's own doc
 * in `@jini-ai/agent-runtime`'s `types.ts`), never "this model supports zero" — so an absent value
 * must stay absent. Defaulting it to `[]` would turn "unknown" into "none", which is exactly the
 * kind of narrowing this projection has already dropped data to twice before (see this file's own
 * header on `reasoningOptions`/`reasoningInModelId`).
 */
function projectModelReasoning(model: RuntimeModelOption): { reasoning?: Array<{ id: string; label: string }> } {
  return model.reasoning?.length
    ? { reasoning: model.reasoning.map((option) => ({ id: option.id, label: option.label })) }
    : {};
}

/** Narrows `agent.models` to the `{id,label,reasoning?}` shape the UI needs, or `{}` when the
 *  runtime found none. Per-model `reasoning` is carried alongside `id`/`label` via
 *  `projectModelReasoning` rather than defaulted — see that function's doc for why. */
function projectModels(
  agent: RuntimeDetectedAgent,
): { models?: Array<{ id: string; label: string; reasoning?: Array<{ id: string; label: string }> }> } {
  return agent.models?.length
    ? {
        models: agent.models.map((model) => ({
          id: model.id,
          label: model.label,
          ...projectModelReasoning(model),
        })),
      }
    : {};
}

/** Narrows `agent.reasoningOptions` to the `{id,label}` shape the UI needs, or `{}` when the runtime declared none. */
function projectReasoningOptions(agent: RuntimeDetectedAgent): { reasoningOptions?: Array<{ id: string; label: string }> } {
  return agent.reasoningOptions?.length
    ? { reasoningOptions: agent.reasoningOptions.map((option) => ({ id: option.id, label: option.label })) }
    : {};
}

/** Narrows `agent.reasoningInModelId` to the `{id,label}` shape the UI needs, or `{}` when the runtime rides no effort suffix. */
function projectReasoningInModelId(agent: RuntimeDetectedAgent): { reasoningInModelId?: { levels: Array<{ id: string; label: string }> } } {
  return agent.reasoningInModelId?.levels.length
    ? {
        reasoningInModelId: {
          levels: agent.reasoningInModelId.levels.map((level) => ({ id: level.id, label: level.label })),
        },
      }
    : {};
}

/**
 * Maps `@jini-ai/agent-runtime`'s `DetectedAgent` onto the `@jini-ai/ui`
 * `ExecutionTab`'s own `DetectedAgent`.
 *
 * This used to narrow the payload to `{id,label,installed,version?,path?}` on
 * the theory that the picker rendered nothing else. It does: the tab's agent
 * cards show the model list and its provenance, the auth status, and the
 * binary path, and every one of those fields already exists on the runtime
 * shape (`types.ts`, the `models` / `modelsSource` / `authStatus` /
 * `authMessage` intersection). Dropping them here left the UI unable to render
 * what detection had already paid to discover.
 *
 * `diagnostics` is still not forwarded — the tab has no affordance for the
 * fix-actions they describe, so it would be dead weight on the wire rather
 * than data the client can use.
 *
 * Both reasoning-effort fields were the same omission a second time, found
 * 2026-09-02 and fixed here. `LocalCliAgentCard` has rendered a "Reasoning
 * effort" control for any agent reporting `reasoningOptions` since it was
 * ported, and `claude`/`codex` have declared those options for just as long —
 * but this projection dropped them, so the control was unreachable in the host for
 * every runtime, with nothing failing anywhere to say so.
 * `reasoningInModelId` is the second shape (a runtime whose effort rides as a
 * suffix on the model id, antigravity being the only declarer); the card
 * derives its per-base-model levels from `models`, which this projection
 * already carries, so the vocabulary is all it additionally needs.
 *
 * The three collection-shaped fields (`models`, `reasoningOptions`,
 * `reasoningInModelId`) are each narrowed by a small helper above — every one
 * of them is an independent `presence check + map` branch, and inlined here
 * they pushed this function's cyclomatic complexity to 12 against the repo's
 * ceiling of 9. Extracting them (rather than the five scalar fields below,
 * which are single ternaries with no nested branching) is what brings this
 * back under the gate without changing a single returned value.
 *
 * Exported for `__tests__/detect-agents-projection.test.ts`, which pins both
 * fields so the next narrowing fails there rather than silently in the UI.
 *
 * A third omission of the same shape, found 2026-09-05: `projectModels` dropped each model's OWN
 * `reasoning` (`RuntimeModelOption.reasoning` — Codex's per-model effort levels), leaving no way
 * for a future picker to narrow the effort control to what the SELECTED model actually supports
 * instead of the agent-wide union `reasoningOptions` carries. Fixed by `projectModelReasoning`
 * above. No `@jini-ai/ui` picker reads it yet (`AgentModelOption` there has no `reasoning` field) —
 * this only gets the data to the browser; the picker-side narrowing is a separate, tracked change.
 */
export function toExecutionTabAgent(agent: RuntimeDetectedAgent): Omit<AdminExecutionDetectedAgent, "discoveryPending"> {
  return {
    id: agent.id,
    label: agent.name,
    installed: agent.available,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.path ? { path: agent.path } : {}),
    ...projectModels(agent),
    ...(agent.modelsSource ? { modelsSource: agent.modelsSource } : {}),
    ...projectReasoningOptions(agent),
    ...projectReasoningInModelId(agent),
    ...(agent.authStatus ? { authStatus: agent.authStatus } : {}),
    // Auth guidance is operator-facing text from the adapter ("run `x login`"),
    // not provider output, so it carries no credential material.
    ...(agent.authMessage ? { authMessage: agent.authMessage } : {}),
  };
}


/** What this route reads: the host's detection snapshot reader (its cache or inventory, chosen at
 * registration) and its discovery-pending sample. */
export interface DetectAgentsRouteDeps extends AssistantPermissionDeps {
  /** The current detected-agent snapshot; `force: true` is an explicit Rescan. Rejections propagate
   *  to the host's redacted 500. */
  readDetectedAgents: (required: { force: boolean }) => Promise<RuntimeDetectedAgent[]>;
  /** Whether a background discovery is still running; sampled AFTER the snapshot read. */
  isDiscoveryPending: (required: Record<string, never>) => boolean;
}

/** This route's answer: every detected agent, projected, with the discovery-pending flag. */
export interface DetectAgentsResponse { data: AdminExecutionDetectedAgent[] }

/**
 * POST detects code-agent CLIs installed on the server host — the "Execution
 * mode" tab's Local CLI probe (`ExecutionPort.detectLocalAgents` /
 * `.rescanLocalAgents`, both wired to this one route). Delegates entirely to the
 * host's detection (the same spawn-`--version`-and-classify probe traced from
 * Open Design's runtime detection — see the dispatch trace, Q4).
 *
 * A strict `force:true` body is explicit Rescan. Ordinary reads return the previous
 * inventory immediately while one background scan refreshes it; no per-caller configuration.
 * The snapshot is read before its pending state is sampled; discovery stays with the host cache.
 */
export const detectAgentsRoute = defineJsonRoute<unknown, DetectAgentsResponse, DetectAgentsRouteDeps, AssistantRoutePrincipal>({
  method: "post",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution/detect-agents`,
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-execution" });
    const agents = await deps.readDetectedAgents({ force: (input as { force?: unknown } | null | undefined)?.force === true });
    const discoveryPending = deps.isDiscoveryPending({});
    return ok({ value: { data: agents.map((agent) => ({ ...toExecutionTabAgent(agent), discoveryPending })) } });
  },
});
