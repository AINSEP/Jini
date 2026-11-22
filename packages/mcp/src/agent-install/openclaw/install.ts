import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan } from '../planner-shared.js';

export const planOpenclawInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan({ slug: 'openclaw', configPath: path.join(home, '.openclaw', 'openclaw.json'), keyPath: ['mcp', 'servers'], serverKey: serverName, entry: jsonEntry(spec) });
