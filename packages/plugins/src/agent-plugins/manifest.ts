/**
 * Types for the Agent Plugins 1.0.0 open standard (published by a Technical Steering Committee
 * with maintainers from Amazon, Cursor, Google, Microsoft, OpenAI, and Vercel). A plugin is a
 * directory: a `plugin.json` manifest, an optional `skills/<name>/` tree following the Agent
 * Skills spec, an optional `mcp.json` for MCP server declarations, and optional
 * reverse-domain-namespaced directories (e.g. `com.example.client/`) for client-specific
 * extensions that unrecognizing clients ignore.
 *
 * Field lists below are read from the published schemas (`AGENT_PLUGINS_SCHEMA_URL`,
 * `AGENT_PLUGINS_MCP_SCHEMA_URL`), not inferred — both still carry an index signature since
 * neither type asserts it has captured every future schema addition.
 */

export const AGENT_PLUGINS_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const AGENT_PLUGINS_MCP_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

export const PLUGIN_MANIFEST_FILENAME = 'plugin.json';
export const PLUGIN_SKILLS_DIRNAME = 'skills';
export const PLUGIN_MCP_MANIFEST_FILENAME = 'mcp.json';

export interface PluginManifestAuthor {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

export interface PluginManifest {
  readonly $schema?: string;
  /** 1-64 chars, lowercase alphanumeric/dots/hyphens, no leading/trailing/doubled separators. */
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: PluginManifestAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  /** Reverse-domain-namespaced client extensions (e.g. `com.example.client`) — the schema assigns
   *  no semantics to what's inside each namespace's object. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== 'object' || value === null) return false;
  const name = (value as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim().length > 0;
}

export type McpServerEntry =
  | {
      readonly type: 'stdio';
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly type: 'streamable-http';
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'sse';
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
    };

export interface McpManifest {
  readonly $schema?: string;
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>;
}

export function isMcpManifest(value: unknown): value is McpManifest {
  if (typeof value !== 'object' || value === null) return false;
  const servers = (value as Record<string, unknown>).mcpServers;
  return typeof servers === 'object' && servers !== null && !Array.isArray(servers);
}
