import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError, type AgentToolDefinition, type ToolExecutionContext, type DerivedRiskByToolId, type ToolHandler, type ToolExecutionOptions, type ToolMetadataById, type ToolRegistration , type AgentToolSideEffect } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { DevRestartPort } from "@jini-ai/core/contracts/site/dev-supervisor-dev-restart";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { SurfaceDetail } from "@jini-ai/core/contracts/cards";
import type { ProjectKeysPort } from "./service.js";

export function createProjectKeysCatalog({ readPermission, restartPermission, descriptions }: {
  readPermission: string; restartPermission: string; descriptions: { list: string; use: string; restart: string };
}, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [
  { name: "project_keys_list", description: descriptions.list, sideEffects: "none", authorization: { permission: readPermission }, inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "project_key_use", description: descriptions.use, sideEffects: "mutates-durable-state", authorization: { permission: "resolved-per-kind" }, inputSchema: { type: "object", additionalProperties: false, required: ["keyId", "use"], properties: { keyId: { type: "string", minLength: 1 }, use: { type: "boolean", const: false } } } },
  { name: "site_restart", description: descriptions.restart, sideEffects: "mutates-durable-state", authorization: { permission: restartPermission }, inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  ];
}
export const projectKeysRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([["project_keys_list", "none"], ["project_key_use", "mutates-durable-state"], ["site_restart", "mutates-durable-state"]]);

export function buildProjectKeyRegistrations({ keys, authorize, loadCards, surfaces, restart, host }: {
  keys?: ProjectKeysPort; authorize: (input: { ctx: ToolExecutionContext; permission: string }) => Promise<void>;
  loadCards: () => Promise<readonly PluginCredentialCard[]>; surfaces: AssistantSurfaceDeps; restart: DevRestartPort | null;
  host: {
    metadata: ToolMetadataById; catalog: readonly AgentToolDefinition[]; catalogModule: string;
    readPermission: string; restartPermission: string; restartReason: "provider-settings-live-apply";
    copy: { unavailable: string; noArguments: string; revokeInput: string; ungranted: string;
      restartTitle: string; restartWarning: string; restartLabel: string; restartUnavailable: string;
      restartUnconfirmed: string; restartAccepted: string };
    approvalToolHandler: (required: {
      surfaces: AssistantSurfaceDeps;
      prepare: (required: { ctx: ToolExecutionContext }) => Promise<{ restart: DevRestartPort | null }>;
      describe: (required: { ctx: ToolExecutionContext; prepared: { restart: DevRestartPort | null } }) => {
        toolId: string; errorCode: string; title: string; warning: string; details: readonly SurfaceDetail[]; confirmLabel: string;
      };
      run: (required: { ctx: ToolExecutionContext; prepared: { restart: DevRestartPort | null }; executionOptions: ToolExecutionOptions }) => Promise<unknown>;
    }, optional: {
      ask: (required: { prepared: { restart: DevRestartPort | null } }) => boolean;
      declined: (required: { reason: string }) => unknown;
    }) => ToolHandler;
  };
}, _optional: Record<string, never> = {}): ToolRegistration[] {
  const available = () => {
    if (!keys) throw new ToolInputError({ message: host.copy.unavailable });
    return keys;
  };
  const empty = ({ input }: { input: unknown }, _optional = {}) => {
    const value = input === undefined ? {} : requireInputRecord({ input });
    if (Object.keys(value).length) throw new ToolInputError({ message: host.copy.noArguments });
  };
  return buildDomainRegistrations({ metadata: host.metadata, domain: "project-keys", catalogModule: host.catalogModule,
    catalog: indexCatalogById({ catalog: host.catalog }), derivedRisk: projectKeysRisk, handlers: {
      project_keys_list: async ctx => {
        empty({ input: ctx.input });
        await authorize({ ctx, permission: host.readPermission });
        return { keys: await available().listGranted({ cards: await loadCards() }) };
      },
      project_key_use: async ctx => {
        const input = requireInputRecord({ input: ctx.input });
        if (Object.keys(input).some(key => key !== "keyId" && key !== "use") || typeof input.keyId !== "string" || !input.keyId || input.use !== false) throw new ToolInputError({ message: host.copy.revokeInput });
        await authorize({ ctx, permission: host.readPermission });
        const row = (await available().listGranted({})).find(row => row.keyId === input.keyId);
        if (!row) throw new ToolInputError({ message: host.copy.ungranted });
        await authorize({ ctx, permission: await available().permissionFor({ keyId: row.keyId }) });
        ctx.signal.throwIfAborted();
        return { ...await available().use({ keyId: row.keyId, use: false }), usedBy: [] };
      },
      // The shared Jini approval lifecycle freezes the call and binds the actor; no supervisor = no card.
      site_restart: host.approvalToolHandler({ surfaces,
        prepare: async ({ ctx }) => {
          empty({ input: ctx.input });
          await authorize({ ctx, permission: host.restartPermission });
          return { restart };
        },
        describe: () => ({ toolId: "site_restart", errorCode: "SITE_RESTART", title: host.copy.restartTitle, warning: host.copy.restartWarning, details: [], confirmLabel: host.copy.restartLabel }),
        run: async ({ ctx, prepared }) => {
          if (!prepared.restart) return { restarted: false, message: host.copy.restartUnavailable };
          ctx.signal.throwIfAborted();
          await authorize({ ctx, permission: host.restartPermission });
          const decision = await prepared.restart.requestRestart({ reason: host.restartReason }, { awaitAcceptance: true });
          if (!decision) return { restarted: false, reason: host.copy.restartUnconfirmed };
          if (!decision.accepted) return { restarted: false, reason: decision.reason };
          return { restartRequested: true, message: host.copy.restartAccepted };
        },
      }, { ask: ({ prepared }) => prepared.restart !== null, declined: ({ reason }) => ({ restarted: false, reason }) }),
    } });
}
