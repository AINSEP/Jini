import type { AgentToolDefinition } from '@jini-ai/core';
import type { PluginHostCopy } from "./plugin-host-copy.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state" as const;

const ENABLE_PLUGIN_PERMISSION = "admin.plugins.enable" as const;


const WORKFLOW = ' Site-local workflow: plugin_source_create (scaffold) or plugin_source_open (latest installed working copy) → list/read/write/edit draft files → plugin_source_seal → plugins_set_enabled (family site-runtime). Drafts never run. Site plugins support content filters, declarative content types and fields. Use sdk.routes.add with capability http.route.register and contributes.routes (e.g. GET /items); routes mount at /api/p/<plugin-id><path> and declare public/member/admin access. Use sdk.tools.add with tools.register and contributes.tools; assistant ids are p_<plugin-id with hyphens replaced by underscores>__<name>. Use sdk.widgets.add with render.contribute and contributes.widgets for public SSR partials. Every registration must match its manifest declaration. Tier-3 runs with full server access; sandboxing is deferred by owner decision.';

const id = { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 50, description: 'Site plugin id; not an Agent Plugin id.' };

const file = { type: 'string', minLength: 1, description: 'Path relative to this plugin draft, e.g. server/index.mjs. Absolute paths, .. and links are refused.' };

const text = { type: 'string' };

function schema({ properties, required }: { properties: Record<string, unknown>; required: string[] }, _optional = {}): Readonly<Record<string, unknown>> {
  return { type: 'object', additionalProperties: false, properties: { id, ...properties }, required: ['id', ...required] };
}

/** Static contract consumed by the model and the domain registration contract suite. */
export function createPluginSourceAgentToolCatalog({ copy }: { copy: PluginHostCopy }, _optional = {}): AgentToolDefinition[] {
  return [
  { name: 'plugin_source_create', description: 'Creates a minimal valid site-local tier-3 draft with a manifest, server entry and README. Existing drafts are retained; existing installs are opened without overwrite.' + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: { name: text, description: text }, required: ['name', 'description'] }) },
  { name: 'plugin_source_open', description: 'Creates a working draft from this site plugin’s latest installed version. Reopening retains all unsealed edits.' + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: {}, required: [] }) },
  { name: 'plugin_source_list', description: 'Lists paths and byte sizes in an opened plugin draft. Use before guessing filenames.' + WORKFLOW,
    sideEffects: 'none', authorization: { permission: 'admin.plugins.read' }, inputSchema: schema({ properties: {}, required: [] }) },
  { name: 'plugin_source_read', description: 'Reads one draft file as text, up to 1 MiB. Read first before an exact edit.' + WORKFLOW,
    sideEffects: 'none', authorization: { permission: 'admin.plugins.read' }, inputSchema: schema({ properties: { path: file }, required: ['path'] }) },
  { name: 'plugin_source_write', description: 'Creates or overwrites one draft file as text (1 MiB per file; 8 MiB / 512 entries per draft). Use edit for a small change. Live installed bytes remain immutable.' + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: { path: file, content: text }, required: ['path', 'content'] }) },
  { name: 'plugin_source_edit', description: 'Replaces one exact occurrence of oldString with newString. Refuses zero or multiple matches without writing; use more context or replaceAll:true. Replacement text is literal.' + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: { path: file, oldString: { type: 'string', minLength: 1 }, newString: text, replaceAll: { type: 'boolean' } }, required: ['path', 'oldString', 'newString'] }) },
  { name: 'plugin_source_delete', description: 'Permanently deletes one draft file after confirmation. Does not remove installed versions; plugins_uninstall owns that. A changed file refuses the approved deletion.' + WORKFLOW,
    sideEffects: 'deletes-durable-state', authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: { path: file }, required: ['path'] }) },
  { name: 'plugin_source_seal', description: `Validates the draft manifest, computes integrity for every package file, uses a higher manifest version or bumps the latest patch on updates, and installs through the existing installer. Keeps active versions plus the newest three for rollback after a successful reload and reloads enabled code through the controlled loader; initially disabled plugins stay OFF. Validation errors explain what to fix. Check installed/reloaded/reloadError. Runs directly on desktop/dev; hosted installs require ${copy.localInstallEnv}=1.` + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: {}, required: [] }) },
  { name: 'plugin_source_rollback', description: 'Reinstalls the previous package’s bytes as a new patch version through the same seal/installer/reload path. Preserves active versions, the newest three releases and your unsealed draft. Fails plainly when no previous version exists. If reload quarantined the plugin, enable it after rollback.' + WORKFLOW,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: ENABLE_PLUGIN_PERMISSION }, inputSchema: schema({ properties: {}, required: [] }) },
  ];
}
