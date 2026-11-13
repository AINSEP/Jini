import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { withEnv, jsonPlan } from '../planner-shared.js';

// OpenCode nests under `mcp`, folds command+args into one array,
// and gates the server with `enabled`.
export const planOpencodeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('opencode', path.join(home, '.config', 'opencode', 'opencode.json'), ['mcp'], serverName,
      withEnv({ type: 'local', command: [spec.command, ...spec.args], enabled: true }, spec.env, 'environment'));
