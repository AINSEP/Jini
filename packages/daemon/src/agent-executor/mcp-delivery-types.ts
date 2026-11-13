import type { McpJsonServerEntry } from './contracts.js';

export interface McpDeliveryBuildInput { cwd: string; runId: string; serverEntry: McpJsonServerEntry }
