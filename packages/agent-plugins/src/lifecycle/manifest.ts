export { validatePluginManifest, validateMcpManifest } from '../manifest.js';
export type { PluginManifest, McpManifest, McpServerEntry } from '../manifest.js';
import type { PluginManifestAuthor } from '../manifest.js';
export type { PluginManifestAuthor } from '../manifest.js';
/** Agent Plugins 1.0.0 parsing, with application metadata confined to an explicit namespace. */
export type AgentPluginServerMetadataReader = (required: { readonly serverId: string; readonly value: Readonly<Record<string, unknown>> }) => Readonly<Record<string, unknown>>;

const PLUGIN_SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const NAME_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;

export interface AgentPluginManifest {
  readonly name: string;
  readonly version?: (string) | undefined;
  readonly description?: (string) | undefined;
  readonly author?: string | PluginManifestAuthor | undefined;
  readonly license?: (string) | undefined;
  readonly keywords?: (readonly string[]) | undefined;
  readonly extensions?: (Readonly<Record<string, unknown>>) | undefined;
}

export type ParseAgentPluginManifestResult =
  | { readonly ok: true; readonly manifest: AgentPluginManifest; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const KNOWN_MANIFEST_KEYS = new Set(["$schema", "name", "version", "description", "author", "license", "keywords", "extensions"]);

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function coerceStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
}

function parseManifestAuthor(value: unknown): string | PluginManifestAuthor | undefined {
  if (typeof value === 'string') return value; // Existing installed manifests may carry a string.
  if (!isJsonObject(value)) return undefined;
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  };
}

function resolveManifestName(raw: Readonly<Record<string, unknown>>): { name: string; error?: undefined } | { name?: undefined; error: string } {
  const name = coerceOptionalString(raw.name);
  if (name === undefined) return { error: "plugin.json 'name' is required and must be a string" };
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return {
      error: `plugin.json 'name' ('${name}') must be 1-${MAX_NAME_LENGTH} lowercase alphanumeric/hyphen/period characters, start and end alphanumeric, with no consecutive delimiters`,
    };
  }
  return { name };
}

export function parseAgentPluginManifest({ value }: { readonly value: unknown }): ParseAgentPluginManifestResult {
  if (!isJsonObject(value)) return { ok: false, errors: ["plugin.json must be a JSON object"] };

  const raw = value;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw.$schema !== PLUGIN_SCHEMA_1_0_0) {
    errors.push(`plugin.json '$schema' must be '${PLUGIN_SCHEMA_1_0_0}', got '${String(raw.$schema)}'`);
  }

  if (raw.extensions !== undefined && !isJsonObject(raw.extensions)) errors.push("plugin.json extensions must be an object");

  const nameResult = resolveManifestName(raw);
  if (nameResult.error) errors.push(nameResult.error);

  for (const key of Object.keys(raw)) {
    if (!KNOWN_MANIFEST_KEYS.has(key)) warnings.push(`unrecognized plugin.json field '${key}' (ignored per spec)`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: AgentPluginManifest = {
    name: nameResult.name as string,
    version: coerceOptionalString(raw.version),
    description: coerceOptionalString(raw.description),
    author: parseManifestAuthor(raw.author),
    license: coerceOptionalString(raw.license),
    keywords: coerceStringArray(raw.keywords),
    ...(isJsonObject(raw.extensions) ? { extensions: raw.extensions } : {}),
  };
  return { ok: true, manifest, warnings };
}

export const MCP_SERVER_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;
export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number];

const RESERVED_STDIO_ENV_KEYS = ["PLUGIN_ROOT", "PLUGIN_DATA"];

export interface StdioMcpServerConfig {
  readonly type: "stdio";
  readonly command: string;
  readonly args?: (readonly string[]) | undefined;
  readonly env?: (Readonly<Record<string, string>>) | undefined;
  readonly cwd?: (string) | undefined;
}

export interface AgentPluginServerMetadata {
  readonly authMode?: ('oauth' | 'none') | undefined;
  readonly defaultTools?: (AgentPluginDefaultTools) | undefined;
  readonly tokenAuth?: (AgentPluginTokenAuth) | undefined;
  readonly renamedTools?: (Readonly<Record<string, string>>) | undefined;
}
export interface RemoteMcpServerConfig extends AgentPluginServerMetadata {
  readonly type: 'streamable-http' | 'sse';
  readonly url: string;
  readonly headers?: (Readonly<Record<string, string>>) | undefined;
}

export interface AgentPluginTokenAuth {
  readonly helpUrl: string;
  readonly probeUrl: string;
  readonly importFromEnv?: (string) | undefined;
  readonly retiredEnv?: (readonly string[]) | undefined;
}

export interface AgentPluginDefaultTools {

  readonly allow?: (readonly string[]) | undefined;
  readonly write: readonly string[];

  readonly read?: (readonly string[]) | undefined;
}

export type McpServerConfig = StdioMcpServerConfig | RemoteMcpServerConfig;

export interface AgentPluginMcpConfig {

  readonly serverIds: readonly string[];

  readonly servers: Readonly<Record<string, McpServerConfig>>;
}

export type ParseAgentPluginMcpConfigResult =
  | { readonly ok: true; readonly config: AgentPluginMcpConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isJsonObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function parseStdioServerConfig(raw: Readonly<Record<string, unknown>>): StdioMcpServerConfig | null {
  if (typeof raw.command !== "string" || raw.command.length === 0) return null;

  const { args, env, cwd } = raw;
  if (args !== undefined && !(Array.isArray(args) && args.every((entry): entry is string => typeof entry === "string"))) return null;
  if (env !== undefined && (!isStringRecord(env) || RESERVED_STDIO_ENV_KEYS.some((key) => Object.hasOwn(env, key)))) return null;
  if (cwd !== undefined && typeof cwd !== "string") return null;

  return {
    type: "stdio",
    command: raw.command,
    ...(args !== undefined ? { args: args as readonly string[] } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  };
}

const MAX_DEFAULT_TOOLS = 64;
const DEFAULT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function parseDefaultToolNames(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DEFAULT_TOOLS) return null;
  return value.every((name): name is string => typeof name === "string" && DEFAULT_TOOL_NAME_PATTERN.test(name)) ? value : null;
}

function parseDefaultTools(value: unknown): AgentPluginDefaultTools | null {
  if (!isJsonObject(value)) return null;
  const allow = value.allow === undefined ? undefined : parseDefaultToolNames(value.allow);
  const write = value.write === undefined ? [] : parseDefaultToolNames(value.write);
  const read = value.read === undefined ? [] : parseDefaultToolNames(value.read);
  if (allow === null || write === null || read === null) return null;
  if (allow === undefined) return value.read !== undefined && write.length === 0 ? { write, read } : null;
  const allowed = new Set(allow);
  return write.every((name) => allowed.has(name)) && read.every((name) => allowed.has(name)) ? { allow, write, read } : null;
}

const MAX_TOKEN_AUTH_URL_LENGTH = 2048;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_TOKEN_AUTH_URL_LENGTH) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_RETIRED_ENV = 32;

function isEnvVarName(value: unknown): value is string {
  return typeof value === "string" && ENV_VAR_NAME_PATTERN.test(value);
}

function parseRetiredEnv(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.length <= MAX_RETIRED_ENV && value.every(isEnvVarName) ? value : null;
}

function parseRenamedTools(value: unknown): Readonly<Record<string, string>> | null {
  if (!isStringRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_DEFAULT_TOOLS) return null;
  const valid = entries.every(
    ([from, to]) => DEFAULT_TOOL_NAME_PATTERN.test(from) && DEFAULT_TOOL_NAME_PATTERN.test(to) && from !== to && !Object.hasOwn(value, to),
  );
  return valid ? value : null;
}

function parseTokenAuth(value: unknown): AgentPluginTokenAuth | null {
  if (!isJsonObject(value) || !isHttpsUrl(value.helpUrl) || !isHttpsUrl(value.probeUrl)) return null;
  const { importFromEnv } = value;
  if (importFromEnv !== undefined && !isEnvVarName(importFromEnv)) return null;
  const retiredEnv = value.retiredEnv === undefined ? undefined : parseRetiredEnv(value.retiredEnv);
  if (retiredEnv === null) return null;
  return {
    helpUrl: value.helpUrl,
    probeUrl: value.probeUrl,
    ...(importFromEnv !== undefined ? { importFromEnv } : {}),
    ...(retiredEnv !== undefined ? { retiredEnv } : {}),
  };
}

function parseRemoteServerConfig(type: "streamable-http" | "sse", raw: Readonly<Record<string, unknown>>, extension?: Readonly<Record<string, unknown>>): RemoteMcpServerConfig | null {
  if (typeof raw.url !== "string" || raw.url.length === 0) return null;

  const { headers } = raw;
  const authMode = extension?.authMode;
  if (headers !== undefined && !isStringRecord(headers)) return null;
  if (authMode !== undefined && authMode !== "oauth" && authMode !== "none") return null;

  const defaults = extension?.defaultTools;
  const defaultTools = defaults === undefined ? undefined : parseDefaultTools(defaults);
  if (defaultTools === null) return null;
  const tokenAuth = extension?.tokenAuth === undefined ? undefined : parseTokenAuth(extension?.tokenAuth);
  if (tokenAuth === null) return null;
  const renamedTools = extension?.renamedTools === undefined ? undefined : parseRenamedTools(extension?.renamedTools);
  if (renamedTools === null) return null;

  return {
    type,
    url: raw.url,
    ...(headers !== undefined ? { headers } : {}),
    ...(authMode !== undefined ? { authMode } : {}),
    ...(defaultTools !== undefined ? { defaultTools } : {}),
    ...(tokenAuth !== undefined ? { tokenAuth } : {}),
    ...(renamedTools !== undefined ? { renamedTools } : {}),
  };
}

function parseMcpServerConfig(value: unknown, extension?: Readonly<Record<string, unknown>>): McpServerConfig | null {
  if (!isJsonObject(value)) return null;
  if (value.type === "stdio") return parseStdioServerConfig(value);
  if (value.type === "streamable-http" || value.type === "sse") return parseRemoteServerConfig(value.type, value, extension);
  return null;
}

export function parseAgentPluginMcpConfig({ value, extensionNamespace }: { readonly value: unknown; readonly extensionNamespace: string }, optional: { readonly pluginManifest?: unknown; readonly readServerMetadata?: AgentPluginServerMetadataReader | undefined } = {}): ParseAgentPluginMcpConfigResult {
  if (!extensionNamespace.trim()) throw new Error("An extension namespace is required");
  if (!isJsonObject(value)) return { ok: false, errors: ["mcp.json must be a JSON object"] };

  const raw = value;
  const errors: string[] = [];

  if (raw.$schema !== MCP_SCHEMA_1_0_0) {
    errors.push(`mcp.json '$schema' must be '${MCP_SCHEMA_1_0_0}', got '${String(raw.$schema)}'`);
  }

  const mcpServers = raw.mcpServers;
  if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
    errors.push("mcp.json 'mcpServers' is required and must be an object");
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest = parseAgentPluginManifest({ value: optional.pluginManifest });
  const extension = manifest.ok ? readAgentPluginExtension({ manifest: manifest.manifest, namespace: extensionNamespace, read: ({ value }) => isJsonObject(value.mcpServers) ? value.mcpServers : {} }) : undefined;
  const extensionServers = extension ?? {};
  const entries = Object.entries(mcpServers as Record<string, unknown>);
  const servers: Record<string, McpServerConfig> = Object.create(null);
  for (const [serverId, rawServer] of entries) {
    const extension = Object.hasOwn(extensionServers, serverId) ? extensionServers[serverId] : undefined;
    const parsed = extension !== undefined && !isJsonObject(extension) ? null : parseMcpServerConfig(rawServer, isJsonObject(extension) ? (optional.readServerMetadata?.({ serverId, value: extension }) ?? extension) : undefined);
    if (parsed) servers[serverId] = parsed;
  }

  return { ok: true, config: { serverIds: entries.map(([serverId]) => serverId), servers } };
}

/** Typed extension reader: unknown namespaces have no semantics until a host supplies a reader. */
export function readAgentPluginExtension<T>(required: {
  readonly manifest: Pick<AgentPluginManifest, 'extensions'>;
  readonly namespace: string;
  readonly read: (required: { readonly value: Readonly<Record<string, unknown>> }) => T;
}): T | undefined {
  if (!required.namespace.trim()) throw new Error('An extension namespace is required');
  const extensions = required.manifest.extensions;
  if (!extensions || !Object.hasOwn(extensions, required.namespace)) return undefined;
  const value = extensions[required.namespace];
  return isJsonObject(value) ? required.read({ value }) : undefined;
}
