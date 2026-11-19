import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { envFlags, cliPlan } from '../planner-shared.js';

export const planClaudeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { serverName } }) => cliPlan({ slug: 'claude', bin: 'claude', argv: {
    addArgv: [
      'mcp', 'add', '--scope', 'user',
      serverName,
      ...envFlags({ env: spec.env, flag: '-e' }),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', '--scope', 'user', serverName],
  }, serverName });
