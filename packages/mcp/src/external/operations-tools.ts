import { toolMetadata } from '@jini-ai/core/tool-metadata/external-mcp';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type AgentToolSideEffect, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";
import type { ToolContributor } from "@jini-ai/core";
import type { RateLimiter } from "@jini-ai/core/contracts/server";
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { type AgentToolDefinition } from "@jini-ai/core";
import { EXTERNAL_MCP_MANAGE_PERMISSION } from "./agent-tools.js";
import type { ExternalMcpHostCopy } from "./external-mcp-host-copy.js";

/** The slice of the host's tool deps these diagnostics read; the host's full deps bag satisfies it structurally. */
export interface ExternalMcpOperationsDeps {
  workspaceId: UUID;
  authorize: AuthorizeFn;
  clock: ClockPort;
}

/** Composition injects the same services the External MCP admin routes call. Secrets stay in those services.
 * The host also binds its model-facing copy and the probe budget's limiter (its outbound-call profile) here. */
export interface ExternalMcpOperations<TDeps extends ExternalMcpOperationsDeps = ExternalMcpOperationsDeps> {
  readonly copy: ExternalMcpHostCopy;
  createProbeLimiter(required: { clock: ClockPort }): Pick<RateLimiter, "check">;
  probe({ deps, serverId }: { deps: TDeps; serverId: string }, optional?: Record<string, never>): Promise<
    { readonly ok: true; readonly body: { readonly tools: readonly unknown[]; readonly probedAt: string } }
    | { readonly ok: false; readonly status: number; readonly body: Readonly<Record<string, unknown>> }
  >;
  admissions(): Promise<
    { readonly ok: true; readonly connections: unknown; readonly configFailures?: unknown }
    | { readonly ok: false; readonly body: { readonly error: string; readonly code: "AGENT_DAEMON_UNAVAILABLE" } }
  >;
}

export function createExternalMcpOperationsToolCatalog({ copy }: { copy: ExternalMcpHostCopy }, _optional = {}): readonly AgentToolDefinition[] {
  return [
  {
    name: "external_mcp_probe_connection",
    description: "Tests a saved, enabled hosted external MCP connection (needs the full gateway: it can store data) by connecting once, listing advertised tools and closing, just like the admin External MCP page's probe. Call to check live reachability and see which remote tools would be allowed or refused. Returns { tools, probedAt }; does not invoke remote tools or change the assistant's live roster. May refresh and persist an OAuth grant. Refuses unknown, disabled or local-command servers, expired authorization, unreachable endpoints and excessive attempts. Use external_mcp_test_connection for a configuration-only check without a remote connection; use external_mcp_get_admissions for the actual live roster.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 64, description: `A saved hosted server id from ${copy.listToolName}.` } } },
  },
  {
    name: "external_mcp_get_admissions",
    description: `Shows the server's current external MCP tool admissions (needs the full gateway: it can store data): the tools actually admitted, refused, missing from allowlists, and configuration failures. Call when saved tool selections differ from what the assistant can use. Returns { connections, configFailures? }, preserving the live server report. Starts server federation if needed and may refresh saved OAuth grants; does not change tool grants or server settings. An unavailable report produces an actionable error, never an empty roster. Use ${copy.listToolName} for saved server configuration and status, external_mcp_probe_connection to test a hosted endpoint, or external_mcp_save to open the human setup form.`,
    sideEffects: "mutates-durable-state",
    authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];
}

export const externalMcpOperationsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // probeExternalMcpServer -> readEnabledExternalMcpConfigs -> OAuth token resolution may persist a refreshed grant.
  ["external_mcp_probe_connection", "mutates-durable-state"],
  // Server admission startup resolves OAuth tokens and may persist a refreshed grant.
  ["external_mcp_get_admissions", "mutates-durable-state"],
]);

/** Rejects secret-bearing or unsupported arguments before any I/O, including direct delegated calls.
 * @param required.input - Model arguments; omitted arguments mean an empty object.
 * @param required.toolId - Tool name used in the recovery message.
 * @param required.allowedKeys - The complete non-secret field allowlist.
 * @returns The validated argument record.
 * @throws {ToolInputError} For non-object input or fields outside the allowlist.
 * @complexity O(k) time and space for input keys (allowlists contain at most one key).
 */
function readOperationInput({ input, toolId, allowedKeys }: { input: unknown; toolId: string; allowedKeys: readonly string[] }, _optional = {}): Record<string, unknown> {
  const record = requireInputRecord({ input: input ?? {} });
  if (Object.keys(record).some(key => !allowedKeys.includes(key))) throw new ToolInputError({ message: `${toolId}: unsupported input fields. Never pass credentials through tool arguments.` });
  return record;
}

/** Builds two diagnostics handlers. Permission runs before I/O; live probes share a workspace budget.
 * @param deps - Workspace, permission checker and clock shared with the setup tools.
 * @param operations - Shared admin probe and server admissions services, the host copy and probe limiter, injected by composition.
 * @returns Registrations for the hosted probe and live admissions tools.
 * @throws {ToolInputError} Handlers refuse invalid arguments, rate limits or unavailable services.
 * @complexity O(1) wiring; services bound their own I/O and collection costs.
 */
export function buildExternalMcpOperationsRegistrations<TDeps extends ExternalMcpOperationsDeps>({ deps, operations }: { deps: TDeps; operations: ExternalMcpOperations<TDeps> }, _optional: Record<string, never> = {}): ToolRegistration[] {
  const limiter = operations.createProbeLimiter({ clock: deps.clock });
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "external-mcp-operations",
    catalogModule: "external/operations-tools.ts",
    catalog: indexCatalogById({ catalog: createExternalMcpOperationsToolCatalog({ copy: operations.copy }) }),
    derivedRisk: externalMcpOperationsDerivedRisk,
    handlers: {
      external_mcp_probe_connection: async ctx => {
        const input = readOperationInput({ input: ctx.input, toolId: "external_mcp_probe_connection", allowedKeys: ["id"] });
        if (typeof input.id !== "string" || !input.id.trim() || input.id.length > 64) throw new ToolInputError({ message: `external_mcp_probe_connection: pass a non-empty saved server id. Use ${operations.copy.listToolName} to find it.` });
        const id = input.id.trim();
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
        workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: "integration", entityId: id });
        const budget = await limiter.check({ key: deps.workspaceId });
        if (!budget.allowed) throw new ToolInputError({ message: `external_mcp_probe_connection: too many probe attempts. Try again in ${budget.retryAfterSeconds} seconds.` });
        const result = await operations.probe({ deps, serverId: id });
        if (!result.ok) throw new ToolInputError({ message: `external_mcp_probe_connection: ${result.body.error}. Review the server in ${operations.copy.settingsLocation}; use external_mcp_test_connection for a configuration-only check.` });
        return result.body;
      },
      external_mcp_get_admissions: async ctx => {
        readOperationInput({ input: ctx.input, toolId: "external_mcp_get_admissions", allowedKeys: [] });
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }),
        workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: "integration" });
        const result = await operations.admissions();
        if (!result.ok) throw new ToolInputError({ message: `external_mcp_get_admissions: ${result.body.error}. Try again shortly; no live admissions report is available.` });
        return result.configFailures === undefined ? { connections: result.connections } : { connections: result.connections, configFailures: result.configFailures };
      },
    },
  });
}

/** Adds diagnostics under a distinct domain so the existing setup/OAuth contributor remains installed.
 * @param operations - Shared admin services; no credentials are exposed through tool arguments.
 * @returns The contributor installed by the composition root.
 * @example contributeExternalMcpOperationsTools({ copy, createProbeLimiter, probe: probeExternalMcpServer, admissions: serverFederation.admissions })
 * @complexity O(1) time and space.
 */
export function contributeExternalMcpOperationsTools<TDeps extends ExternalMcpOperationsDeps>(operations: ExternalMcpOperations<TDeps>): ToolContributor<TDeps, unknown> {
  return { domain: "external-mcp-operations", build: deps => buildExternalMcpOperationsRegistrations({ deps, operations }), risk: externalMcpOperationsDerivedRisk };
}
