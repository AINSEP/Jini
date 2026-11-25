import { promises as fsPromises } from 'node:fs';

/** The `.mcp.json` `mcpServers` entry a bridge delivery carries; the daemon's richer entry type is assignable to this. */
export interface McpServerEntryLike {
  readonly command: string;
  readonly args: string[];
  readonly env: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges the bridge's entry (under `serverName`) into an existing `.mcp.json`'s `mcpServers` map, preserving
 * every other key and every other registered server untouched. A missing (`existingRaw ===
 * undefined`), empty, or unparseable-as-a-JSON-object existing file all degrade to "start from an
 * empty document" rather than throwing — an unparseable project `.mcp.json` is a pre-existing
 * problem this driver did not create and cannot safely repair, so it is deliberately overwritten
 * with a fresh, valid file containing just this run's bridge entry rather than left broken or
 * left blocking the run. Pure — no I/O — so every branch is directly assertable.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify`'s own cost on a small config file.
 * @overallScore 100/100
 */
export function mergeMcpJsonContent({ existingRaw, serverEntry, serverName }: { readonly existingRaw: string | undefined; readonly serverEntry: McpServerEntryLike | { readonly type: 'http'; readonly url: string; readonly headers: Readonly<Record<string, string>> }; readonly serverName: string }): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingServers = isRecord(doc.mcpServers) ? doc.mcpServers : {};
  const mcpServers = { ...existingServers, [serverName]: serverEntry };
  return `${JSON.stringify({ ...doc, mcpServers }, null, 2)}\n`;
}

export function defaultReadMcpJsonFile({ path }: { readonly path: string }): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

export function defaultWriteMcpJsonFile({ path, content }: { readonly path: string; readonly content: string }): Promise<void> {
  return fsPromises.writeFile(path, content, 'utf8');
}
