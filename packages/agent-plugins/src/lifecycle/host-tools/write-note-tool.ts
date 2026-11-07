import { DEFAULT_PLUGIN_MEMORY_LIMITS } from "../../../core/persistent-state.js";
import { requireInputRecord, requireString, type AgentToolDefinition, type AgentToolSideEffect, type ToolHandler } from "@jini-ai/core";
import type { AgentPluginHostToolPorts, RequireHostToolPermission } from "./ports.js";

export const WRITE_PLUGIN_NOTE = "agent_plugin_write_note";
/** The note tool's catalog entry; the host names the permission a note write needs.
 * @complexity O(1). */
export function pluginNoteToolCatalog(required: { readonly permission: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [{ name: WRITE_PLUGIN_NOTE,
  description: "Save the user's explicitly requested project note for an installed Agent Plugin. Writes the note directly; never call to store plugin-discovered facts (use that plugin's learned memory tool).",
  sideEffects: "mutates-durable-state", authorization: { permission: required.permission },
  inputSchema: { type: "object", additionalProperties: false, required: ["pluginId", "entryPath", "text"],
    properties: { pluginId: { type: "string" }, entryPath: { type: "string" }, text: { type: "string", maxLength: 16384 } } },
  }];
}
export const pluginNoteRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([[WRITE_PLUGIN_NOTE, "mutates-durable-state"]]);
/**
 * The note-saving handler. Notes are context, never a permission grant.
 * @param required.workspaceId The workspace whose plugin state receives the note.
 * @param required.requirePermission Throws unless the principal holds `ports.permissions.enable`.
 * @param required.ports Installed-plugin lifecycle, layout and memory store.
 * @complexity O(p) for p installed plugins.
 */
export function pluginNoteHandler(
  required: { workspaceId: string; requirePermission: RequireHostToolPermission; ports: Pick<AgentPluginHostToolPorts, "lifecycle" | "layout" | "memory" | "permissions"> },
  _optional: Record<string, never> = {},
): ToolHandler {
  const { lifecycle } = required.ports;
  return async (ctx) => {
    ctx = { ...ctx, input: structuredClone(ctx.input), principal: { ...ctx.principal }, run: { ...ctx.run } };
    const input = requireInputRecord({ input: ctx.input });
    if (Object.keys(input).some(key => !["pluginId", "entryPath", "text"].includes(key))) throw new Error("Unexpected note field");
    const pluginId = requireString({ input, key: "pluginId" });
    const entryPath = requireString({ input, key: "entryPath" });
    const text = requireString({ input, key: "text" });
    lifecycle.normalizePackageEntryPath({ rawEntryPath: entryPath });
    if (Buffer.byteLength(text, "utf8") > DEFAULT_PLUGIN_MEMORY_LIMITS.notes || text.includes("\0")) throw new Error("Note is not valid bounded UTF-8 text");
    const workspaceId = required.workspaceId;
    await required.requirePermission({ workspaceId,
      principalId: ctx.principal.id, permission: required.ports.permissions.enable }, { entityType: "agent-plugin", entityId: pluginId });
    const layout = required.ports.layout;
    const installed = async () => (await lifecycle.listInstalledPlugins({ workspaceRoot: layout.forWorkspace({ workspaceId }).root })).some(plugin => plugin.pluginId === pluginId);
    if (!(await installed())) throw new Error("Agent Plugin is not installed");
    if (ctx.signal.aborted) return { saved: false, reason: "abandoned" };
    return { saved: true, ...await required.ports.memory.pluginMemory({ workspaceId, pluginId }).writeNote({ entryPath, text }) };
  };
}
