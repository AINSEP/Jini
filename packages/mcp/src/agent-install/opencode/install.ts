import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { withEnv, jsonPlan } from '../planner-shared.js';

// OpenCode nests under `mcp`, folds command+args into one array,
// and gates the server with `enabled`.
export const planOpencodeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) =>
    jsonPlan({ slug: 'opencode', configPath: path.join(home, '.config', 'opencode', 'opencode.json'), keyPath: ['mcp'], serverKey: serverName,
      entry: withEnv({ entry: { type: 'local', command: [spec.command, ...spec.args], enabled: true }, env: spec.env, key: 'environment' }) });
