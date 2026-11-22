import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry } from '../planner-shared.js';

export const planPiInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'pi',
    format: 'json',
    configPath: path.join(home, '.pi', 'agent', 'mcp.json'),
    snippet: JSON.stringify({ mcpServers: { [serverName]: jsonEntry(spec) } }, null, 2),
    reason:
      'The pi coding agent exposes MCP, but its config path/schema is ' +
      'not authoritatively documented. Paste this into pi’s MCP ' +
      'config (check `pi --help` for the exact location).',
  });
