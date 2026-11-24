import { ToolInputError } from "@jini-ai/core";
import { getEffective, resolveDefinitionRaw } from "@jini-ai/core/settings";
import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import type { ChatAgentInventoryPort, SettingsToolDeps, ValidateRuntimeSelectionPort } from "./tool-deps.js";

/** These coordinates already belong to the composer ledger; no parallel selection store. */
export const CHAT_EXECUTION_KEYS = ["localCli.agentId", "localCli.model", "localCli.reasoning"] as const;

/** Whether a canonical setting is one of the native composer's saved axes. O(1). */
export function isChatExecutionSetting({ namespace, key }: { namespace: string; key: string }, _options = {}): boolean {
  return namespace === "core.execution" && CHAT_EXECUTION_KEYS.some(candidate => candidate === key);
}

/** Bind one settings-card request to the caller's current picker and live catalog.
 * Returns the dependency snapshot for a post-card comparison; writes remain with Jini settings.
 * Refuses workspace writes so changing this person's picker cannot change another person's.
 * @throws ToolInputError for invalid selections/scopes; repository/discovery failures propagate.
 * @complexity O(agents + models + efforts), three effective reads, one inherited read on clear, and one shared inventory read.
 */
export async function prepareChatExecutionWrite({ deps, request, validateRuntimeSelection }: {
  deps: Pick<SettingsToolDeps, "settingsRepo" | "workspaceId" | "authorize"> & {
    assistantAgentInventory?: ChatAgentInventoryPort;
  };
  request: { namespace: string; key: string; scope: string; value?: unknown; ctx: { principal: { id: string } }; toolId: string };
  /** The agent runtime's selection validator, bound by the host (the same one its composer uses). */
  validateRuntimeSelection: ValidateRuntimeSelectionPort;
}, _options = {}): Promise<string | null> {
  // The settings owner follows aliases. Bind policy to that canonical coordinate as well.
  const definition = await resolveDefinitionRaw({ repo: deps.settingsRepo }, { namespace: request.namespace, key: request.key, workspaceId: deps.workspaceId });
  if (!definition || !isChatExecutionSetting(definition)) return null;
  const key = definition.key;
  if (request.scope !== "user") throw new ToolInputError({ message: "Chat agent/model/effort changes require scope='user' for the current person." });
  // Use the existing run entitlement, independently of the settings writer's scope permission.
  const access = await deps.authorize({ principalId: request.ctx.principal.id, workspaceId: deps.workspaceId, permission: "admin.assistant.use" });
  if (!access.allowed) throw new ToolInputError({ message: "Chat selection requires permission 'admin.assistant.use'." });
  const values = await Promise.all(CHAT_EXECUTION_KEYS.map(key => getEffective({ deps: { repo: deps.settingsRepo }, namespace: "core.execution", key, scopeContext: { workspaceId: deps.workspaceId, principalId: request.ctx.principal.id } })));
  const snapshot = values.map(value => value?.value ?? "");
  const axis = CHAT_EXECUTION_KEYS.indexOf(key as typeof CHAT_EXECUTION_KEYS[number]);
  // An explicit empty override repairs one axis without activating any stale sibling selection.
  // A clear is different: it can expose a nonempty inherited value and must validate that result.
  if (request.toolId === "settings_set_value" && request.value === "" && axis !== 0) {
    return JSON.stringify({ previous: snapshot[axis], selection: { [key]: "" } });
  }
  const resulting = await resultingSelection({ deps, request, key, snapshot, axis });
  return bindChatSelection({ deps, resulting, snapshot, validateRuntimeSelection });
}

/** Resolve a clear against inherited settings, rather than treating it as an empty override. */
async function resultingSelection({ deps, request, key, snapshot, axis }:
  Pick<Parameters<typeof prepareChatExecutionWrite>[0], "deps" | "request"> & { key: string; snapshot: unknown[]; axis: number }, _options = {}): Promise<unknown[]> {
  const inherited = request.toolId === "settings_clear_value" ? await getEffective({ deps: { repo: deps.settingsRepo }, namespace: "core.execution", key, scopeContext: { workspaceId: deps.workspaceId } }) : null;
  const resulting: unknown[] = [...snapshot];
  resulting[axis] = request.toolId === "settings_clear_value" ? inherited?.value ?? "" : request.value;
  return resulting;
}

/** Validate and bind the same live inventory that the composer uses. */
async function bindChatSelection({ deps, resulting, snapshot, validateRuntimeSelection }: {
  deps: Parameters<typeof prepareChatExecutionWrite>[0]["deps"]; resulting: unknown[]; snapshot: unknown[];
  validateRuntimeSelection: ValidateRuntimeSelectionPort;
}, _options = {}): Promise<string> {
  const [agentId, modelId, effort] = resulting;
  if (typeof agentId !== "string" || !agentId) throw new ToolInputError({ message: "Set core.execution localCli.agentId at scope='user' first, using an available agent from the chat picker." });
  // The composition root owns the live picker inventory; never fall back to another runtime.
  const inventory = deps.assistantAgentInventory;
  if (!inventory) throw new ToolInputError({ message: "Chat agent inventory is unavailable. Try again after the assistant starts." });
  // Await the shared scan rather than accepting an initial fallback while live discovery is pending.
  await inventory.listAssistantAgents({}, { waitForProbe: true });
  const agents = await inventory.listDetectedAssistantAgents();
  // Check the resulting selection together: a new model must also support the saved effort.
  const refusal = validateRuntimeSelection({ agents, agentId, modelId: modelId as string, effort: effort as string });
  if (refusal) throw new ToolInputError({ message: refusal });
  return JSON.stringify({ previous: snapshot, selection: { agentId, modelId, effort },
    resolvedDefaultModel: resolvedDefaultModel({ agents, agentId, modelId }) });
}

function resolvedDefaultModel({ agents, agentId, modelId }: {
  agents: readonly DetectedAgent[]; agentId: string; modelId: unknown;
}, _options = {}): string | null {
  const agent = agents.find(candidate => candidate.id === agentId);
  // Bind Default's concrete resolution too: a native config change must require a new card.
  const resolvedModel = !modelId || modelId === "default" ? agent?.defaultModelResolution : undefined;
  return resolvedModel?.status === "resolved" ? resolvedModel.id : null;
}
