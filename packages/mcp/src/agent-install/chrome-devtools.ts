import type { McpLaunchSpec } from './install.js';

/** Explicit on-demand launch preset; importing it never registers or launches a browser. */
export const CHROME_DEVTOOLS_MCP_PRESET: McpLaunchSpec = {
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp@1.10.1', '--no-usage-statistics', '--no-performance-crux'],
  env: {},
};
