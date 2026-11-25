import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultReadMcpJsonFile, mergeMcpJsonContent } from './mcp-json.js';

/** Stage Claude's HTTP capability outside the project; only this private path enters argv.
 * @returns A private config path and removal of only its owned directory.
 * @throws Filesystem staging errors after removing partial output.
 * @complexity O(config bytes), one project read and one private config write.
 */
export async function prepareClaudeHttpMcpConfig({ cwd, endpoint, serverName }: {
  cwd: string; endpoint: { readonly url: string; readonly token: string }; serverName: string;
}, { inheritUserMcp = true, readFile = defaultReadMcpJsonFile }: {
  inheritUserMcp?: boolean; readFile?: (required: { readonly path: string }) => Promise<string>;
} = {}): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'jini-claude-mcp-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    let existingRaw: string | undefined;
    if (inheritUserMcp) existingRaw = await readFile({ path: join(cwd, '.mcp.json') }).catch(() => undefined);
    const content = mergeMcpJsonContent({ existingRaw, serverName, serverEntry: {
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
