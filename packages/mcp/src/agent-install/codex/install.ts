import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planCodexInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan({ slug: 'codex', bin: 'codex', argv: {
    addArgv: [
      'mcp', 'add', serverName,
      ...envFlags({ env: spec.env, flag: '--env' }),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName });
