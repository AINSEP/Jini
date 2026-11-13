import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan } from '../planner-shared.js';

export const planCursorInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('cursor', path.join(home, '.cursor', 'mcp.json'), ['mcpServers'], serverName, jsonEntry(spec, { type: 'stdio' }));
