/**
 * @file `parseAgentPluginManifest()` / `parseAgentPluginMcpConfig()` — the Agent Plugins v1.0.0
 * `plugin.json` / `mcp.json` grammar (agent-plugins.org/specification), verified against the live
 * spec rather than inferred from an example manifest.
 *
 * Deliberately a SEPARATE, smaller validator from `src/features/plugin-runtime/manifest.ts`'s
 * `validateManifest()`. That file validates `.host-plugin`'s own tarball format — `integrity`
 * (per-file SHA-256), `sdkRange`, `tier`, an exactly-three-token capability vocabulary, a single
 * `content.entry.beforeSave` hook. This file validates the OPEN standard's `plugin.json`, which
 * shares none of those fields and defines no execution/trust/capability model at all — see this
 * feature's own header comment in `install.ts` for why the two formats cannot be unified.
 *
 * Pinned v1.0.0 rules from agent-plugins.org/specification:
 * - `plugin.json`'s `name`: 1-64 chars, lowercase alphanumeric/hyphen/period only, must start and
 *   end alphanumeric, no `--` or `..` consecutive delimiters (§5.5). Valid: `my-plugin`,
 *   `acme.tools`, `lint3r`, `a`. Invalid: `My-Plugin`, `-start`, `has--double`.
 * - `plugin.json`'s `$schema` MUST equal `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
 *   for this pinned version; `mcp.json`'s MUST equal
 *   `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`.
 * - Unknown top-level `plugin.json` fields produce warnings but do not block loading — this module
 *   returns them as `warnings`, never as a rejection reason.
 * - `mcp.json`'s top-level shape is `{ "$schema": ..., "mcpServers": { "<server-id>": {...} } }` —
 *   `mcpServers` MUST be an object whose member names identify servers.
 * - Each server entry MUST carry a `type` discriminator matching one of three CLOSED variants.
 *   Launching requires the actual transport config, not just a server id:
 *     - `stdio`: requires `command` (non-empty string); optional `args` (string[]), `env`
 *       (string-valued object — MUST NOT set `PLUGIN_ROOT`/`PLUGIN_DATA`, which the spec reserves),
 *       `cwd` (plugin-relative path).
 *     - `streamable-http` / `sse`: requires `url` (non-empty string); optional `headers`
 *       (string-valued object).
 * - **The spec defines NO auth-related field on a server entry at all.** Verbatim from
 *   `/specification`: "Agent Plugins v1 defines no OAuth configuration or portable
 *   credential-reference fields. Authorization discovery, user interaction, and credential storage
 *   are client-managed." A plugin therefore cannot declare "this server needs OAuth" using any
 *   spec-defined field — the host is the client the spec defers that decision to. This module accepts
 *   the host-specific metadata in `plugin.json`'s `extensions.<host-namespace>.mcpServers[serverId]`, keeping
 *   `mcp.json` transport entries closed per §7.2.1. Hosts may translate legacy auth and sign-in defaults in MCP
 *   entries through readServerMetadata for existing packages, but those cannot supply operator read trust.
 *   `authMode: "oauth" | "none"` selects client auth; absent defaults to "none".
 *   `defaultTools: { allow?, write?, read? }` names sign-in grants and reviewed read tools.
 *   `write` requires `allow` and must be its subset; `read` must be a subset when `allow` is
 *   present. A read-only declaration without `allow` leaves sign-in grants unchanged.
 *   Remote hints may veto a read declaration but never supply it. A third,
 *   `tokenAuth: { helpUrl, probeUrl }`, offers a pasted access token as the sign-in fallback
 *   (`access-token-tool.ts`). A fourth, `renamedTools: { oldName: newName }`, carries saved tool
 *   selections across a vendor's tool rename (`apply-tool-renames.ts`). A malformed per-server entry
 *   (wrong/missing `type`, missing required field) does not fail the whole file — see
 *   `ParseAgentPluginMcpConfigResult`'s own doc for the fail-open contract this preserves.
 *
 * Architectural role:
 * Pure, no-I/O parsing over an already-`JSON.parse`d value — mirrors `plugin-runtime/manifest.ts`'s
 * own "receives a JS value, never a file path or raw bytes" contract. `install.ts` is the only
 * caller that reads the file and hands the parsed value here.
 */
export { validatePluginManifest, validateMcpManifest } from '../manifest.js';
export type { PluginManifest, McpManifest, McpServerEntry } from '../manifest.js';
import type { PluginManifestAuthor } from '../manifest.js';
export type { PluginManifestAuthor } from '../manifest.js';
/** Agent Plugins 1.0.0 parsing, with application metadata confined to an explicit namespace. */
export type AgentPluginServerMetadataReader = (required: { readonly serverId: string; readonly value: Readonly<Record<string, unknown>>; readonly server: Readonly<Record<string, unknown>> }) => Readonly<Record<string, unknown>>;

/**
 * The one plugin.json schema version this loader understands. A manifest declaring any other
 * value is rejected outright rather than guessed at: pinning the grammar must survive spec churn.
 */
const PLUGIN_SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/**
 * §5.5's grammar as one regex: alnum runs separated by single `-`/`.` delimiters. This shape alone
 * guarantees start/end are alphanumeric (the regex can only start and end on `[a-z0-9]+`) AND that
 * no two delimiters are ever adjacent (a delimiter is always followed by at least one alnum char
 * before the next one can appear) — so "no leading/trailing hyphen" and "no consecutive delimiters"
 * fall out of one pattern rather than needing separate checks that could disagree.
 */
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

/**
 * True for a non-null, non-array plain object — the "is this actually a JSON object" gate both
 * `parseAgentPluginManifest` and `parseAgentPluginMcpConfig` need before touching any field.
 */
function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `value` narrowed to a `string`, or `undefined` — every optional string field below coerces
 * through this one check instead of repeating its own `typeof ... === "string" ? ... : undefined`
 * ternary.
 */
function coerceOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * `value` narrowed to a `string[]` (non-string entries dropped), or `undefined` when `value`
 * itself isn't an array — `keywords`'s own coercion.
 */
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

/**
 * Validates `plugin.json`'s `name` field per §5.5's grammar (see `NAME_PATTERN`'s own header for
 * what the one regex encodes). Returns the valid name, or the one error message to report — never
 * both, so the caller needs exactly one branch to consume this instead of the original's
 * required-then-format else-if chain.
 */
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

/**
 * Validates an already-`JSON.parse`d `plugin.json` value against the v1.0.0 grammar.
 *
 * @throws Nothing — every failure is reported via the returned `errors`, matching this codebase's
 * own convention for expected validation outcomes (`plugin-runtime/manifest.ts`,
 * `plugin-runtime/discovery.ts`).
 * @complexity O(k + n) time and space in the input keys and keyword entries.
 */
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

/**
 * The three closed transport variants `mcp.schema.json` v1.0.0 defines. See this file's header for
 * the verified field shape of each.
 */
export const MCP_SERVER_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;
export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number];

/**
 * Reserved by the spec — a `stdio` server's `env` MUST NOT set either, since the client (the host)
 * owns them. Checked defensively; nothing upstream of this parser fills them in yet, so this is a
 * spec-conformance check today rather than one guarding a real collision.
 */
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
/**
 * `streamable-http` and `sse` share an identical field shape (`url` + optional `headers`); only
 * their `type` differs, and both are handled by the one remote branch below.
 */
export interface RemoteMcpServerConfig extends AgentPluginServerMetadata {
  readonly type: 'streamable-http' | 'sse';
  readonly url: string;
  readonly headers?: (Readonly<Record<string, string>>) | undefined;
}

/**
 * the host-specific extension, not part of the spec — see this file's header for why it exists and
 * what a strictly spec-conformant client does with it (ignores it).
 *
 * the host-specific extension, not part of the spec: the tools this server's row is granted on the
 *  operator's FIRST successful sign-in (`apply-connect-defaults.ts`), so connecting is the only step.
 *  `write` is a subset of `allow`, the same rule the external-MCP store enforces on a save.
 *
 * the host-specific extension, not part of the spec: this server also takes a pasted access token, sent
 *  as `Authorization: Bearer` — the fallback when its sign-in cannot start (`access-token-tool.ts`).
 *
 * the host-specific extension, not part of the spec: `{ oldName: newName }` for tools the vendor
 *  renamed. A row this plugin provisioned has each old name in its saved lists replaced by the new
 *  one at boot (`apply-tool-renames.ts`), so a rename never strands an operator's selection.
 *
 * Where a human makes the token (`helpUrl`, linked from the form) and the URL a pasted token is
 *  checked against before it is saved (`probeUrl`: one GET, 401/403 means the token was rejected).
 *  Both https.
 *
 *  `importFromEnv` names an env var whose token is copied onto this server's row at boot when the row
 *  has no credential yet (`import-access-token.ts`); `retiredEnv` names old env vars that are no
 *  longer read, so boot can say so once. Both let a plugin take over an old env-configured
 *  integration without core naming the vendor.
 */
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

/**
 * Absent means no first-sign-in defaults, rather than an empty grant.
 *
 * Operator-reviewed remote names; absent on older programmatic configs means no read grants.
 */
export type McpServerConfig = StdioMcpServerConfig | RemoteMcpServerConfig;

export interface AgentPluginMcpConfig {

  readonly serverIds: readonly string[];

  readonly servers: Readonly<Record<string, McpServerConfig>>;
}

/**
 * `mcpServers`' own member names, in declaration order — the identity a future admission record
 * pins to (`serverId` in the debate's own admission shape). Includes every declared key
 * regardless of whether that entry's transport shape validated — see {@link servers} for the
 * validated subset — so a discovery caller that only ever needed ids (`search_agent_plugin_local`)
 * sees no behavior change from before this module parsed transports at all.
 *
 * Only the entries whose transport shape validated against one of the three closed variants.
 * A `serverId` present in {@link serverIds} but absent here declared an unrecognized `type` or was
 * missing a required field for the `type` it declared — fail-open per this file's header, not an
 * error for the whole `mcp.json`.
 */
export type ParseAgentPluginMcpConfigResult =
  | { readonly ok: true; readonly config: AgentPluginMcpConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * `value` narrowed to an object whose own values are all strings, or `undefined` for anything
 *  else — the shared shape `env`/`headers` both need.
 */
function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isJsonObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Validates one `type: "stdio"` server entry.
 *
 * @returns The parsed config, or `null` for any shape violation (missing/empty `command`, a
 * malformed `args`/`env`/`cwd`, or an `env` setting a reserved key) — the caller folds `null` into
 * "this one server is excluded from `servers`", never into a whole-file rejection.
 * @complexity O(k) in the entry's own field count.
 */
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

/**
 * Same bound and grammar as `external-mcp-store.ts`'s `MAX_ALLOWED_TOOLS`/`REMOTE_TOOL_NAME_PATTERN`,
 *  so a declared default can never be one the store would refuse on save.
 */
const MAX_DEFAULT_TOOLS = 64;
const DEFAULT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * A bounded array of valid tool names, or `null`.
 */
function parseDefaultToolNames(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DEFAULT_TOOLS) return null;
  return value.every((name): name is string => typeof name === "string" && DEFAULT_TOOL_NAME_PATTERN.test(name)) ? value : null;
}

/**
 * Validates bounded sign-in and read lists. `read` and `write` default to `[]`.
 * A provided `allow` bounds both lists; without it only a read declaration is meaningful,
 * and sign-in defaults stay absent. Any malformed list excludes the entire server.
 *
 * @returns Parsed defaults, or `null` for a malformed declaration.
 * @complexity O(n) time and space in the lists' total length (each capped at 64).
 */
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

/**
 * An env var name a manifest may point at: upper-case, digits and `_`.
 */
const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_RETIRED_ENV = 32;

function isEnvVarName(value: unknown): value is string {
  return typeof value === "string" && ENV_VAR_NAME_PATTERN.test(value);
}

function parseRetiredEnv(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.length <= MAX_RETIRED_ENV && value.every(isEnvVarName) ? value : null;
}

/**
 * Validates a remote entry's `renamedTools` extension: at most {@link MAX_DEFAULT_TOOLS} entries,
 * every key and value a valid tool name, no name renamed to itself, and no new name that is itself
 * renamed again (so one pass is the whole rewrite).
 *
 * @returns The parsed map, or `null` for any shape violation — the caller excludes the whole server.
 * @complexity O(n) in the entry count.
 */
function parseRenamedTools(value: unknown): Readonly<Record<string, string>> | null {
  if (!isStringRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_DEFAULT_TOOLS) return null;
  const valid = entries.every(
    ([from, to]) => DEFAULT_TOOL_NAME_PATTERN.test(from) && DEFAULT_TOOL_NAME_PATTERN.test(to) && from !== to && !Object.hasOwn(value, to),
  );
  return valid ? value : null;
}

/**
 * Validates a remote entry's `tokenAuth` extension, or `null` for any shape violation — the
 *  caller excludes the whole server, same as a malformed `defaultTools`.
 */
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

/**
 * Validates one `type: "streamable-http"` or `type: "sse"` server entry — the two remote transports
 * share this one implementation because they share every field (see {@link RemoteMcpServerConfig}).
 *
 * @returns The parsed config, or `null` for any shape violation. Same fold-into-exclusion contract
 * as {@link parseStdioServerConfig}.
 * @complexity O(k) in the entry's own field count.
 *
 * Read trust is accepted only from the plugin extension. Keep legacy sign-in grants.
 */
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

/**
 * Dispatches one raw `mcpServers` entry to its transport's validator by `type`, or `null` for a
 *  non-object entry or a `type` outside {@link MCP_SERVER_TRANSPORTS}.
 */
function parseMcpServerConfig(value: unknown, extension?: Readonly<Record<string, unknown>>): McpServerConfig | null {
  if (!isJsonObject(value)) return null;
  if (value.type === "stdio") return parseStdioServerConfig(value);
  if (value.type === "streamable-http" || value.type === "sse") return parseRemoteServerConfig(value.type, value, extension);
  return null;
}

/**
 * Validates an already-`JSON.parse`d `mcp.json` value against the v1.0.0 top-level shape:
 * `{ "$schema": ..., "mcpServers": { "<server-id>": {...} } }`, then validates each declared
 * server's own transport shape (see this file's header for the three variants).
 *
 * @throws Nothing — see {@link parseAgentPluginManifest}.
 * @complexity O(s) in the number of declared servers.
 */
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
    // A malformed declared extension excludes the server before the translator can hide it.
    const metadata = isJsonObject(rawServer) && (extension === undefined || isJsonObject(extension))
      ? optional.readServerMetadata?.({ serverId, value: extension ?? {}, server: rawServer }) ?? extension
      : undefined;
    const parsed = extension !== undefined && !isJsonObject(extension) ? null : parseMcpServerConfig(rawServer, metadata);
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
