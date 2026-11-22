import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import type { McpLaunchSpec } from '../install.js';

export const planHermesInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'hermes',
    format: 'yaml',
    configPath: path.join(home, '.hermes', 'config.yaml'),
    snippet: hermesYamlSnippet(spec, serverName),
    reason:
      'Hermes config format is unverified. Add this under your Hermes ' +
      'MCP server configuration by hand.',
  });
function hermesYamlSnippet(spec: McpLaunchSpec, name: string): string {
  const lines = [
    'mcp_servers:',
    `  ${name}:`,
    `    command: ${JSON.stringify(spec.command)}`,
    `    args: ${JSON.stringify(spec.args)}`,
  ];
  if (Object.keys(spec.env).length > 0) {
    lines.push('    env:');
    for (const [k, v] of Object.entries(spec.env)) {
      lines.push(`      ${k}: ${JSON.stringify(v)}`);
    }
  }
  return lines.join('\n');
}

