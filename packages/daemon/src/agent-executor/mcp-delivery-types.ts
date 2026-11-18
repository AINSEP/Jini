import type { McpJsonServerEntry } from './mcp-json-file.js';

export interface McpDeliveryBuildInput { cwd: string; runId: string; serverEntry: McpJsonServerEntry }
