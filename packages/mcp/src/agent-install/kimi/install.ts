import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planKimiInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan({ slug: 'kimi', bin: 'kimi', argv: {
    addArgv: [
      'mcp', 'add', '--transport', 'stdio',
      ...envFlags({ env: spec.env, flag: '--env' }),
      serverName, '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName });
