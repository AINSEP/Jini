import path from 'node:path';
import type { InstallPlan } from '../install.js';
import type { PlannerArgs } from '../planner-shared.js';
import { jsonEntry, jsonPlan, editorUserDir } from '../planner-shared.js';

export const planTraeInstall: (args: PlannerArgs) => InstallPlan = ({ spec, ctx: { home, platform, serverName }, appData }) =>
    jsonPlan({ slug: 'trae', configPath: traeConfigPath(home, platform, appData), keyPath: ['mcpServers'], serverKey: serverName, entry: jsonEntry(spec) });
function traeConfigPath(home: string, platform: NodeJS.Platform, suppliedAppData: string | undefined): string {
  return path.join(editorUserDir({ app: 'Trae', home, platform, suppliedAppData }), 'mcp.json');
}

