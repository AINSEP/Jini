import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan } from '../planner-shared.js';

export const planOpenclawInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('openclaw', path.join(home, '.openclaw', 'openclaw.json'), ['mcp', 'servers'], serverName, jsonEntry(spec));
