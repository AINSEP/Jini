import type { McpBridgeDelivery } from '../contracts.js';
import type { McpDeliveryBuildInput } from '../mcp-delivery-types.js';

export function buildCodexMcpDelivery({ serverEntry }: McpDeliveryBuildInput): McpBridgeDelivery {
  return { kind: 'codex-toml', serverEntry };
}
