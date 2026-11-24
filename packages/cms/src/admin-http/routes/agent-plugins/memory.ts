import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import type { AdminAgentPluginMemoryEnvelope } from "@jini-ai/core/contracts/site/cms-agent-plugins";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { pluginIdParam, type AgentPluginRoutePrincipal } from "./shared.js";

/** One plugin's memory store, as the host opens it (contained to the plugin's state directory). */
export interface AgentPluginMemoryStore {
  writeNote(required: { entryPath: string; text: string }): Promise<unknown>;
  list(required: { kind: "learned" | "notes" }): Promise<readonly unknown[]>;
}

/** The deps the memory read reads: the workspace, the installed check, the store and its caps. */
export interface AgentPluginMemoryGetRouteDeps {
  workspaceId: string;
  isInstalled: (required: { pluginId: string }) => Promise<boolean>;
  openMemory: (required: { pluginId: string }) => AgentPluginMemoryStore;
  memoryLimits: unknown;
}

/** The note write adds the host's system-error classification (its own 500, never a 422). */
export interface AgentPluginMemoryPutRouteDeps extends AgentPluginMemoryGetRouteDeps {
  isSystemError: (required: { error: unknown }) => boolean;
}

const MEMORY_PATH = "/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/memory";

/** A note write: exactly `entryPath` and `text`, both strings. */
interface NoteWrite { readonly entryPath: string; readonly text: string }

/**
 * The note write when the body is an object whose keys are exactly `entryPath` and `text`, both
 * strings; otherwise `undefined`.
 * @complexity O(k) in the body's key count.
 */
function noteWriteOf({ body }: { body: unknown }, _optional: Record<string, never> = {}): NoteWrite | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  if (Object.keys(body).some(key => key !== "entryPath" && key !== "text")) return undefined;
  if (!("entryPath" in body) || typeof body.entryPath !== "string") return undefined;
  return "text" in body && typeof body.text === "string" ? { entryPath: body.entryPath, text: body.text } : undefined;
}

/**
 * Validates and writes one user note. A system error (the host's predicate) is rethrown unchanged
 * so the host answers it with its own note-write 500; any other write failure is the 422.
 * @complexity O(k) validation plus one note write.
 */
async function writeNoteOrRefuse(
  { body, memory, isSystemError }: { body: unknown; memory: AgentPluginMemoryStore; isSystemError: AgentPluginMemoryPutRouteDeps["isSystemError"] },
  _optional: Record<string, never> = {},
): Promise<void> {
  const note = noteWriteOf({ body });
  if (!note) rejectRoute({ status: 400, error: "entryPath and text are required", code: "VALIDATION_ERROR" });
  try { await memory.writeNote(note); }
  catch (error) {
    if (isSystemError({ error })) throw error;
    rejectRoute({ status: 422, error: "note path, text or size is invalid", code: "PLUGIN_MEMORY_INVALID" });
  }
}

/**
 * The shared read/write answer: authorize (no entity type or id — the hand-written check named
 * neither), the installed 404, the optional note write, then both lists.
 * @complexity O(p) in installed plugins plus the store's two list reads.
 */
async function answerMemory(
  { pluginId, deps, authorize, permission }: { pluginId: string; deps: AgentPluginMemoryGetRouteDeps; authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: { write?: (memory: AgentPluginMemoryStore) => Promise<void> } = {},
): Promise<AdminAgentPluginMemoryEnvelope> {
  if (!authorize) throw new Error("agent-plugins admin route has no authorizer");
  await authorize({ permission });
  if (!(await deps.isInstalled({ pluginId }))) rejectRoute({ status: 404, error: "agent plugin was not found", code: "AGENT_PLUGIN_NOT_FOUND" });
  const memory = deps.openMemory({ pluginId });
  if (optional.write) await optional.write(memory);
  const [learned, notes] = await Promise.all([memory.list({ kind: "learned" }), memory.list({ kind: "notes" })]);
  return { pluginId, learned, notes, limits: deps.memoryLimits };
}

/** `GET …/memory`: learned knowledge and user notes, read-only. */
export const agentPluginMemoryGetRoute = defineJsonRoute<{ pluginId: string }, AdminAgentPluginMemoryEnvelope, AgentPluginMemoryGetRouteDeps, AgentPluginRoutePrincipal>({
  method: "get",
  path: MEMORY_PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => ok({ value: await answerMemory({ pluginId: input.pluginId, deps, authorize, permission: "admin.plugins.read" }) }),
});

/**
 * `PUT …/memory`: the user's notes editor writes notes only; learned knowledge stays separately
 * readable. The body is checked after authorization and the installed 404 (the hand-written order),
 * so `parse` only carries it.
 */
export const agentPluginMemoryPutRoute = defineJsonRoute<{ pluginId: string; body: unknown }, AdminAgentPluginMemoryEnvelope, AgentPluginMemoryPutRouteDeps, AgentPluginRoutePrincipal>({
  method: "put",
  path: MEMORY_PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }), body: raw.body } }),
  handle: async ({ input, deps, authorize }) => ok({ value: await answerMemory(
    { pluginId: input.pluginId, deps, authorize, permission: "admin.plugins.enable" },
    { write: (memory) => writeNoteOrRefuse({ body: input.body, memory, isSystemError: deps.isSystemError }) },
  ) }),
});
