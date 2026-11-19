import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan, editorUserDir } from '../planner-shared.js';

export const planClineInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, platform, serverName }, appData }) =>
    jsonPlan({ slug: 'cline', configPath: clineConfigPath(home, platform, appData), keyPath: ['mcpServers'], serverKey: serverName, entry: jsonEntry(spec, { disabled: false, autoApprove: [] }) });
function clineConfigPath(home: string, platform: NodeJS.Platform, suppliedAppData: string | undefined): string {
  return path.join(
    editorUserDir({ app: 'Code', home, platform, suppliedAppData }),
    'globalStorage',
    'saoudrizwan.claude-dev',
    'settings',
    'cline_mcp_settings.json',
  );
}

