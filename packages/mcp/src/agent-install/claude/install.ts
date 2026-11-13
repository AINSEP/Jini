import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planClaudeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan('claude', 'claude', {
    addArgv: [
      'mcp', 'add', '--scope', 'user',
      serverName,
      ...envFlags(spec.env, '-e'),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', '--scope', 'user', serverName],
  }, serverName);
