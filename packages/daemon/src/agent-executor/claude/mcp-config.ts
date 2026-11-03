import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpHttpEndpoint, McpJsonInjectionOptions } from '../contracts.js';
import { defaultReadMcpJsonFile, mergeMcpJsonContent } from '../mcp-bridge.js';

/** Stage Claude's HTTP capability outside the project; only this private path enters argv.
 * @returns A private config path and removal of only its owned directory.
 * @throws Filesystem staging errors after removing partial output.
 * @complexity O(config bytes), one project read and one private config write.
 */
export async function prepareClaudeHttpMcpConfig({ cwd, endpoint }: {
  cwd: string; endpoint: Pick<McpHttpEndpoint, 'url' | 'token'>;
}, { inheritUserMcp = true, readFile = defaultReadMcpJsonFile }: {
  inheritUserMcp?: boolean; readFile?: McpJsonInjectionOptions['readFile'];
} = {}): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'jini-claude-mcp-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    let existingRaw: string | undefined;
    if (inheritUserMcp) existingRaw = await readFile({ path: join(cwd, '.mcp.json') }).catch(() => undefined);
    const content = mergeMcpJsonContent({ existingRaw, serverEntry: {
      type: 'http', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` },
    } });
    const path = join(dir, 'mcp.json');
    await fs.writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return { path, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
