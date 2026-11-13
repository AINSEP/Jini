import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planKimiInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan('kimi', 'kimi', {
    addArgv: [
      'mcp', 'add', '--transport', 'stdio',
      ...envFlags(spec.env, '--env'),
      serverName, '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName);
