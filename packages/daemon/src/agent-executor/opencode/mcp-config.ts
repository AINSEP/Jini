import type { McpHttpEndpoint } from '../contracts.js';
import { mergeEnvContentMcpConfig } from '../mcp-bridge.js';

/** Keep OpenCode's run-local inline carrier and its existing settings/instruction merge owner.
 * @returns Remote entry replacing stale stdio fields; only the endpoint token is delivered.
 * @complexity O(config bytes) time/space, without I/O.
 */
export function mergeOpenCodeHttpMcpConfig({ existingRaw, endpoint }: {
  existingRaw: string | undefined; endpoint: Pick<McpHttpEndpoint, 'url' | 'token'>;
}, _options = {}): string {
  return mergeEnvContentMcpConfig({ existingRaw, entry: {
    type: 'remote', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` },
  } });
}
