import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { RuntimeModelOption } from "@jini-ai/core/contracts/agents";
import type {
  AssistantDetectAgentsResponseDto, AssistantExecutionTabAgentDto, AssistantIdLabelDto,
} from "@jini-ai/core/contracts/site/cms-assistant";

import {
  authorizeAssistantExecution, type AssistantExecutionRoutePrincipal, type ExecutionDetectedAgent,
} from "./execution-shared.js";

/** The detection snapshot the host answers: the current inventory plus whether a background scan is still running. */
export interface ExecutionDetectionSnapshot {
  agents: readonly ExecutionDetectedAgent[];
  discoveryPending: boolean;
}

/** The host's detection boundary: reads its inventory (a strict `force` is an explicit Rescan). */
export type DetectAgentsFn = (required: { force: boolean }, optional?: Record<string, never>) => Promise<ExecutionDetectionSnapshot>;

/** The deps this route reads: the host's assistant-management permission and its detection boundary. */
export interface AssistantDetectAgentsRouteDeps {
  workspaceId: string;
  manageAssistantPermission: string;
  detectAgents: DetectAgentsFn;
}

/**
 * Narrows one model's OWN `reasoning` (`RuntimeModelOption.reasoning` — Codex's per-model effort
 * levels, populated by `parseCodexDebugModels`) to the `{id,label}` shape, or omits the field when
 * the runtime reported none.
 *
 * `undefined` here means "this runtime doesn't report per-model levels" (see that field's own doc
 * in `@jini-ai/agent-runtime`'s `types.ts`), never "this model supports zero" — so an absent value
 * must stay absent. Defaulting it to `[]` would turn "unknown" into "none", which is exactly the
 * kind of narrowing this projection has already dropped data to twice before (see
 * `toExecutionTabAgent`'s doc on `reasoningOptions`/`reasoningInModelId`).
 */
function projectModelReasoning({ model }: { model: RuntimeModelOption }, _optional: Record<string, never> = {}): { reasoning?: AssistantIdLabelDto[] } {
  return model.reasoning?.length
    ? { reasoning: model.reasoning.map((option) => ({ id: option.id, label: option.label })) }
    : {};
}

/** Narrows `agent.models` to the `{id,label,reasoning?}` shape the UI needs, or `{}` when the
 *  runtime found none. Per-model `reasoning` is carried alongside `id`/`label` via
 *  `projectModelReasoning` rather than defaulted — see that function's doc for why. */
function projectModels({ agent }: { agent: ExecutionDetectedAgent }, _optional: Record<string, never> = {}): Pick<AssistantExecutionTabAgentDto, "models"> {
  return agent.models?.length
    ? { models: agent.models.map((model) => ({ id: model.id, label: model.label, ...projectModelReasoning({ model }) })) }
    : {};
}

/** Narrows `agent.reasoningOptions` to the `{id,label}` shape the UI needs, or `{}` when the runtime declared none. */
function projectReasoningOptions({ agent }: { agent: ExecutionDetectedAgent }, _optional: Record<string, never> = {}): Pick<AssistantExecutionTabAgentDto, "reasoningOptions"> {
  return agent.reasoningOptions?.length
    ? { reasoningOptions: agent.reasoningOptions.map((option) => ({ id: option.id, label: option.label })) }
    : {};
}

/** Narrows `agent.reasoningInModelId` to the `{id,label}` shape the UI needs, or `{}` when the runtime rides no effort suffix. */
function projectReasoningInModelId({ agent }: { agent: ExecutionDetectedAgent }, _optional: Record<string, never> = {}): Pick<AssistantExecutionTabAgentDto, "reasoningInModelId"> {
  return agent.reasoningInModelId?.levels.length
    ? { reasoningInModelId: { levels: agent.reasoningInModelId.levels.map((level) => ({ id: level.id, label: level.label })) } }
    : {};
}

/**
 * Maps the agent runtime's `DetectedAgent` onto the `@jini-ai/ui` `ExecutionTab`'s own `DetectedAgent`.
 *
 * This used to narrow the payload to `{id,label,installed,version?,path?}` on the theory that the
 * picker rendered nothing else. It does: the tab's agent cards show the model list and its
 * provenance, the auth status, and the binary path, and every one of those fields already exists on
 * the runtime shape. Dropping them here left the UI unable to render what detection had already
 * paid to discover.
 *
 * `diagnostics` is still not forwarded — the tab has no affordance for the fix-actions they
 * describe, so it would be dead weight on the wire rather than data the client can use.
 *
 * Both reasoning-effort fields were the same omission a second time, found 2026-09-02 and fixed
 * here. `LocalCliAgentCard` has rendered a "Reasoning effort" control for any agent reporting
 * `reasoningOptions` since it was ported, and `claude`/`codex` have declared those options for just
 * as long — but this projection dropped them, so the control was unreachable for every runtime, with
 * nothing failing anywhere to say so. `reasoningInModelId` is the second shape (a runtime whose
 * effort rides as a suffix on the model id, antigravity being the only declarer); the card derives
 * its per-base-model levels from `models`, which this projection already carries, so the vocabulary
 * is all it additionally needs.
 *
 * The three collection-shaped fields (`models`, `reasoningOptions`, `reasoningInModelId`) are each
 * narrowed by a small helper above — every one of them is an independent `presence check + map`
 * branch, and inlined here they pushed this function's cyclomatic complexity to 12 against the
 * ceiling of 9. Extracting them (rather than the five scalar fields below, which are single ternaries
 * with no nested branching) is what brings this back under the gate without changing a single
 * returned value.
 *
 * Exported so a test pins every field and the next narrowing fails there rather than silently in the UI.
 *
 * A third omission of the same shape, found 2026-09-05: `projectModels` dropped each model's OWN
 * `reasoning` (Codex's per-model effort levels), leaving no way for a future picker to narrow the
 * effort control to what the SELECTED model actually supports instead of the agent-wide union
 * `reasoningOptions` carries. Fixed by `projectModelReasoning` above. No `@jini-ai/ui` picker reads
 * it yet — this only gets the data to the browser; the picker-side narrowing is a separate change.
 */
export function toExecutionTabAgent({ agent }: { agent: ExecutionDetectedAgent }, _optional: Record<string, never> = {}): AssistantExecutionTabAgentDto {
  return {
    id: agent.id,
    label: agent.name,
    installed: agent.available,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.path ? { path: agent.path } : {}),
    ...projectModels({ agent }),
    ...(agent.modelsSource ? { modelsSource: agent.modelsSource } : {}),
    ...projectReasoningOptions({ agent }),
    ...projectReasoningInModelId({ agent }),
    ...(agent.authStatus ? { authStatus: agent.authStatus } : {}),
    // Auth guidance is operator-facing text from the adapter ("run `x login`"),
    // not provider output, so it carries no credential material.
    ...(agent.authMessage ? { authMessage: agent.authMessage } : {}),
  };
}

/**
 * POST detects code-agent CLIs installed on the server host — the execution tab's Local CLI probe.
 * A strict `force:true` body is explicit Rescan; ordinary reads return the previous inventory
 * immediately while the host refreshes it. Every agent carries the snapshot's `discoveryPending`.
 */
export const assistantDetectAgentsRoute = defineJsonRoute<
  { force: boolean }, AssistantDetectAgentsResponseDto, AssistantDetectAgentsRouteDeps, AssistantExecutionRoutePrincipal
>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution/detect-agents",
  parse: (raw) => ok({ value: { force: (raw.body as { force?: unknown } | undefined)?.force === true } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistantExecution({ authorize, permission: deps.manageAssistantPermission });
    const { agents, discoveryPending } = await deps.detectAgents({ force: input.force });
    return ok({ value: { data: agents.map((agent) => ({ ...toExecutionTabAgent({ agent }), discoveryPending })) } });
  },
});
