import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString,
  type AgentToolDefinition, type AgentToolSideEffect, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import type { PluginMemory } from "../../../core/persistent-state.js";
import type { AgentPluginHostToolPorts, ApplyHostToolApprovalPolicy } from "./ports.js";

/** List this plugin's learned entries, or read one; only an absent file becomes exists:false.
 * Containment, permission and other filesystem errors still propagate from the storage owner.
 * @complexity One bounded Jini list or one file read; storage owns byte/file caps.
 */
async function readMemory({ memory, pluginId, input }: { memory: PluginMemory; pluginId: string; input: Record<string, unknown> }, _options = {}) {
  if (input.entryPath === undefined) return { pluginId, entries: await memory.list({ kind: "learned" }) };
  const entryPath = requireString({ input, key: "entryPath" });
  try {
    return { pluginId, entryPath, text: await memory.learned.read({ entryPath }) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { pluginId, entryPath, exists: false };
    throw error;
  }
}

interface Identity { readonly id: string; readonly pluginId: string; readonly archiveDigest: string; }
/** Every capability closes over its owning plugin. Caller-controlled ids/kinds are rejected. */
export function buildPluginMemoryRegistrations(required: {
  withExtensionApprovalPolicy: ApplyHostToolApprovalPolicy;
  sources: readonly Identity[]; workspaceId: string; ports: Pick<AgentPluginHostToolPorts, "memory" | "permissions" | "metadata">;
  gate: { isCallable(plugin: { pluginId: string; archiveDigest: string }): Promise<boolean> };
}, _optional: {} = {}): ToolRegistration[] {
  const { withExtensionApprovalPolicy } = required;
  const catalog: AgentToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const risk = new Map<string, AgentToolSideEffect>();
  const owners = new Map<string, Identity>();
  const approvalFamilies = new Map<string, 'plugin-memory-read' | 'plugin-memory-write'>();
  for (const source of required.sources) {
    for (const operation of ["read", "write"] as const) {
      const id = `${source.id}__memory_${operation}`;
      const sideEffects = operation === "read" ? "none" : "mutates-durable-state";
      catalog.push(memoryToolDefinition({ id, source, operation, sideEffects, permission: required.ports.permissions.use }));
      owners.set(id, source); risk.set(id, sideEffects);
      approvalFamilies.set(id, operation === "read" ? 'plugin-memory-read' : 'plugin-memory-write');
      handlers[id] = async ctx => {
        const input = requireInputRecord({ input: ctx.input });
        const allowed = operation === "read" ? ["entryPath"] : ["entryPath", "text"];
        if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Memory tool accepts no plugin id, kind, or other fields");
        const memory = required.ports.memory.pluginMemory({ workspaceId: required.workspaceId, pluginId: source.pluginId });
        if (operation === "read") return readMemory({ memory, pluginId: source.pluginId, input });
        return memory.learned.write({ entryPath: requireString({ input, key: "entryPath" }), text: requireString({ input, key: "text" }) });
      };
    }
  }
  return buildDomainRegistrations({ ...(required.ports.metadata ? { metadata: required.ports.metadata } : {}), domain: "agent-plugin-memory", catalogModule: "lifecycle/host-tools/memory-tools.ts",
    catalog: indexCatalogById({ catalog }), handlers, derivedRisk: risk,
  }).map(registration => {
    const owner = owners.get(registration.descriptor.id)!;
    const policy = registration.policy;
    return withExtensionApprovalPolicy({ registration: { ...registration, policy: { authorize: async ctx =>
      (await required.gate.isCallable(owner)) ? policy.authorize(ctx) : "deny" } },
      family: approvalFamilies.get(registration.descriptor.id)! });
  });
}

function memoryToolDefinition(
  { id, source, operation, sideEffects, permission }: { id: string; source: Identity; operation: "read" | "write"; sideEffects: AgentToolSideEffect; permission: string },
  _optional: Record<string, never> = {},
): AgentToolDefinition {
  return { name: id, description: `${operation === "read" ? "Read" : "Refresh"} ${source.pluginId}'s learned account knowledge. UTF-8 text only. Never credentials or permissions.${operation === "read" ? " Omit entryPath to list learned entries. A missing entry returns exists:false." : ""}`,
    sideEffects, authorization: { permission },
    inputSchema: { type: "object", additionalProperties: false, required: operation === "read" ? [] : ["entryPath", "text"],
      properties: { entryPath: { type: "string" }, ...(operation === "write" ? { text: { type: "string" } } : {}) } },
  };
}
