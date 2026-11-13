import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planCodexInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan('codex', 'codex', {
    addArgv: [
      'mcp', 'add', serverName,
      ...envFlags(spec.env, '--env'),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName);
