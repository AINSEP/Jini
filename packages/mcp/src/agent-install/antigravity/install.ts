import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan } from '../planner-shared.js';

/**
 * Home-relative path of the MCP registry the `agy` CLI actually reads:
 * `~/.gemini/config/mcp_config.json` (verified live; see the
 * `externalMcpInjection` comment in `@jini-ai/agent-runtime`'s
 * `packages/agent-runtime/src/defs/antigravity/index.ts`). NOT `~/.gemini/antigravity/mcp_config.json`: that
 * file only works on machines where the Antigravity IDE happened to symlink it
 * to this one, and on a machine without that symlink the bridge entry would
 * never reach `agy`. Planning only this path also means a regular-file
 * `antigravity/mcp_config.json` (the IDE's own) is never touched.
 */
export const ANTIGRAVITY_MCP_CONFIG_SEGMENTS = ['.gemini', 'config', 'mcp_config.json'] as const;

export const planAntigravityInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('antigravity', path.join(home, ...ANTIGRAVITY_MCP_CONFIG_SEGMENTS), ['mcpServers'], serverName, jsonEntry(spec));
