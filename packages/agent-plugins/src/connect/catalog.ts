import type { AgentToolSideEffect, DerivedRiskByToolId, AgentToolDefinition } from '@jini-ai/core';
import type { AgentPluginMcpRecord, AgentPluginMcpProjections } from './ports.js';

/** This tool's one-entry catalog, built from host copy (tool id, permission, description and the
 *  pluginId schema text are product vocabulary).
 * @agent-note Second host: pass your own tool id/permission/description bytes; the schema shape is fixed. */
export function agentPluginConnectAgentToolCatalogFor(required: { toolId: string; permission: string; description: string; pluginIdDescription: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [
    {
      name: required.toolId,
      description: required.description,
      sideEffects: "mutates-durable-state",
      authorization: { permission: required.permission },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pluginId"],
        properties: {
          pluginId: {
            type: "string",
            minLength: 1,
            description: required.pluginIdDescription,
          },
        },
      },
    },
  ];
}

/** @agent-note Second host: key by your own tool id. */
export function agentPluginConnectDerivedRiskFor(required: { toolId: string }, _optional: Record<string, never> = {}): DerivedRiskByToolId {
  return new Map<string, AgentToolSideEffect>([
    [required.toolId, "mutates-durable-state"],
  ]);
}

/** Whether a plugin's row already holds a credential: a finished sign-in, or a saved access token
 *  (`static_env` with the token sealed in `sealedOAuth` — what `agent_plugin_set_access_token`, the
 *  old env var's boot import, and create-site onboarding all write; `sealedEnv` is a stdio row's env
 *  block and never holds it). Such a row needs no sign-in, and a token import must never overwrite it.
 * @agent-note Pass the canonical store's SAME pure projection pair; this check performs no I/O,
 * opens no sealed material and must not replace an existing credential with a fresh grant. */
export function hasStoredAgentPluginCredential(required: { row: Pick<AgentPluginMcpRecord, "authMode" | "sealedOAuth" | "oauthStatus">; projections: AgentPluginMcpProjections }, _optional: Record<string, never> = {}): boolean {
  const { row, projections } = required;
  return projections.oauthStatus(row) === "connected" || projections.hasStaticAccessToken(row);
}

