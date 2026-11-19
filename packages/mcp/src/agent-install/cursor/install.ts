import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan } from '../planner-shared.js';

export const planCursorInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan({ slug: 'cursor', configPath: path.join(home, '.cursor', 'mcp.json'), keyPath: ['mcpServers'], serverKey: serverName, entry: jsonEntry(spec, { type: 'stdio' }) });
