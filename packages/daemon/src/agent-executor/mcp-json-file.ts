import { promises as fsPromises } from 'node:fs';

/** The `mcpServers` key this driver registers its bridge under, in every config shape it writes. */
export const JINI_MCP_SERVER_KEY = 'jini';

/** One `.mcp.json` `mcpServers` entry — the shape Claude Code's own config schema expects. */
export interface McpJsonServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: Readonly<Record<string, string>> & {
    readonly JINI_RUN_ID: string;
    readonly JINI_DAEMON_URL: string;
    /** Present only when the host supplied a `credential` resolver — see {@link McpJsonInjectionOptions.credential}. */
    readonly JINI_DAEMON_TOKEN?: string;
  };
}

export function defaultReadMcpJsonFile({ path }: { readonly path: string }): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

export function defaultWriteMcpJsonFile({ path, content }: { readonly path: string; readonly content: string }): Promise<void> {
  return fsPromises.writeFile(path, content, 'utf8');
}

export function defaultRemoveMcpJsonFile({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { force: true });
}
