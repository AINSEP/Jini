import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import type { McpLaunchSpec } from '../install.js';

export const planVibeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'vibe',
    format: 'toml',
    configPath: path.join(home, '.vibe', 'config.toml'),
    snippet: vibeTomlSnippet({ spec, name: serverName }),
    reason:
      'Vibe uses a TOML array-of-tables ([[mcp_servers]]); ' +
      'its exact schema is unverified, so append this block by hand ' +
      'to avoid corrupting an existing config.',
  });
/** Render the launch command and environment as a Vibe TOML snippet without I/O.
 * @complexity O(n) time and space in the serialized launch spec length.
 */
function vibeTomlSnippet({ spec, name }: { spec: McpLaunchSpec; name: string }, _options = {}): string {
  const argsToml = `[${spec.args.map((a) => JSON.stringify(a)).join(', ')}]`;
  const lines = [
    '[[mcp_servers]]',
    `name = ${JSON.stringify(name)}`,
    'transport = "stdio"',
    `command = ${JSON.stringify(spec.command)}`,
    `args = ${argsToml}`,
  ];
  if (Object.keys(spec.env).length > 0) {
    const envToml = Object.entries(spec.env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(', ');
    lines.push(`env = { ${envToml} }`);
  }
  return lines.join('\n');
}
