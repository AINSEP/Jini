/**
 * @module @jini-ai/mcp/agent-install/install
 * Plans and applies registration of a stdio MCP server into external coding
 * agents' own configs (`<cli> mcp install <agent>`): the agent-slug registry,
 * the CLI/JSON/manual install-plan shapes, and the JSON apply/remove primitives.
 * Pure planning logic; imports no sibling MCP subdirectory.
 */
// Per-agent MCP registration planner.
//
// `<cli> mcp install <agent>` (and any hosted bootstrap that calls it) wires
// a stdio MCP server into a coding agent's own configuration. Each agent
// stores MCP servers differently, so this module maps a single resolved
// launch spec (command/args/env — the same shape buildMcpInstallPayload
// produces and the settings UI pastes) onto one of three registration
// strategies:
//
//   - 'cli'    : the agent ships its own `<bin> mcp add/remove/get`. We
//                shell out to it so we inherit the agent's merge/validation
//                rules instead of editing its config by hand. Used for
//                claude / codex / kimi.
//   - 'json'   : the agent reads a JSON config file with a known schema.
//                We deep-merge one server entry, never clobbering the
//                rest of the file. Used for cursor / copilot / cline /
//                opencode / openclaw / antigravity / trae.
//   - 'manual' : we could not verify the agent's config path/format
//                authoritatively (pi / hermes / vibe). We refuse to write
//                a guessed path and instead print a ready-to-paste
//                snippet plus the best-known location. Writing a wrong
//                path risks corrupting a user-owned config, so this stays
//                a print-only path until the format is confirmed.
//
// The planning functions are pure (no fs / spawn) so they unit-test
// against fixed launch specs + a fake home dir; the executor performs the IO.

import path from 'node:path';

/**
 * Exhaustive tuple of all agent slugs recognized by `mcp install`.
 * Used as the source of truth for the `AgentSlug` union type and the `isAgentSlug` guard.
 */
export const AGENT_SLUGS = [
  'claude',
  'codex',
  'cursor',
  'copilot',
  'openclaw',
  'antigravity',
  'pi',
  'vibe',
  'hermes',
  'cline',
  'kimi',
  'trae',
  'opencode',
] as const;

/** Union of all valid agent slugs accepted by `mcp install`. */
export type AgentSlug = (typeof AGENT_SLUGS)[number];

/**
 * Type guard: returns `true` when `value` is a recognized `AgentSlug`.
 * Used by the CLI argument parser to surface a clear error for unknown slugs.
 * @param value The string to test.
 * @returns `true` if `value` is a valid `AgentSlug`, `false` otherwise.
 */
export function isAgentSlug(args: { value: string }): args is { value: AgentSlug } {
  return (AGENT_SLUGS as readonly string[]).includes(args.value);
}

/** The resolved stdio launch spec — mirrors the relevant fields of
 *  McpInstallPayload (command/args/env). */
export interface McpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Environment context injected into `planAgentInstall`.
 * Kept as a plain-data interface so unit tests can supply a fake home dir
 * and platform without touching the real filesystem.
 */
export interface PlanContext {
  /** Absolute home directory (os.homedir()). Injected for testability. */
  home: string;
  /** Node platform — selects per-OS config paths (cline / trae). */
  platform: NodeJS.Platform;
  /** MCP server name as it appears in the agent config. */
  serverName: string;
}

/** Agent owns a `<bin> mcp add/remove/get`; we drive it. */
export interface CliInstallPlan {
  kind: 'cli';
  slug: AgentSlug;
  bin: string;
  addArgv: string[];
  removeArgv: string[];
  /** Argv that exits 0 iff the server is already registered. */
  getArgv: string[];
}

/** Agent reads a JSON config file with a known schema. */
export interface JsonInstallPlan {
  kind: 'json';
  slug: AgentSlug;
  /** Absolute path to the config file we merge into. */
  configPath: string;
  /** Nested object path to the server map, e.g. ['mcpServers'] or
   *  ['mcp', 'servers'] or ['mcp']. */
  keyPath: string[];
  serverKey: string;
  /** Value stored under keyPath → serverKey. */
  entry: unknown;
}

/** Unverified format — print a snippet, never write. */
export interface ManualInstallPlan {
  kind: 'manual';
  slug: AgentSlug;
  format: 'json' | 'yaml' | 'toml';
  /** Best-known config location, or null when even that is unknown. */
  configPath: string | null;
  snippet: string;
  reason: string;
}

/** Discriminated union of all installation plan shapes returned by `planAgentInstall`. */
export type InstallPlan = CliInstallPlan | JsonInstallPlan | ManualInstallPlan;

// RESIDUAL RISK (CR-006 / SEC-RB-002): `-e`/`--env KEY=VALUE` is claude's,
// codex's, and kimi's own documented `mcp add` CLI contract for passing
// server env vars — a fixed, external interface this package does not
// control and cannot change unilaterally. Because these values land in
// `addArgv` (argv), they are visible to any other local process that can
// list this process's command line (e.g. `ps -ww`) for the — typically very
// brief — window while the daemon's executor shells out to `claude`/`codex`/
// `kimi mcp add`. This package only builds the plan (`planAgentInstall`
// itself performs no fs/spawn, per this file's header comment); there is no
// executor here yet to redact `addArgv` before logging it, so there is
// nothing left in this package's own code to redact. Whichever executor
// eventually drives these plans MUST NOT log/echo `addArgv` verbatim
// (redact anything that looks like an env value from `-e`/`--env` pairs
// before writing it to any log/error surface), and should prefer a
// less-exposed handoff (e.g. piping `env` via stdin, or setting it directly
// in the spawned child's environment) for any future agent whose CLI
// supports that instead of argv-only `KEY=VALUE`.
function envFlags(env: Record<string, string>, flag: string): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    out.push(flag, `${k}=${v}`);
  }
  return out;
}

// Attaches the env map under `key` only when non-empty, so configs stay clean.
function withEnv(entry: Record<string, unknown>, env: Record<string, string>, key: 'env' | 'environment'): Record<string, unknown> {
  if (Object.keys(env).length > 0) entry[key] = env;
  return entry;
}

/** JSON server entry shared by the `env`-style agents (cursor / copilot /
 *  cline / openclaw / antigravity / trae). `extra` carries per-agent
 *  fields; env is only attached when non-empty so configs stay clean. */
function jsonEntry(spec: McpLaunchSpec, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return withEnv({ command: spec.command, args: spec.args, ...extra }, spec.env, 'env');
}

/**
 * Home-relative path of the MCP registry the `agy` CLI actually reads:
 * `~/.gemini/config/mcp_config.json` (verified live; see the
 * `externalMcpInjection` comment in `@jini-ai/agent-runtime`'s
 * `defs/antigravity.ts`). NOT `~/.gemini/antigravity/mcp_config.json`: that
 * file only works on machines where the Antigravity IDE happened to symlink it
 * to this one, and on a machine without that symlink the bridge entry would
 * never reach `agy`. Planning only this path also means a regular-file
 * `antigravity/mcp_config.json` (the IDE's own) is never touched.
 */
export const ANTIGRAVITY_MCP_CONFIG_SEGMENTS = ['.gemini', 'config', 'mcp_config.json'] as const;

/** Inputs every per-agent planner receives; `appData` is the resolved `APPDATA` (win32 only). */
interface PlannerArgs {
  spec: McpLaunchSpec;
  ctx: PlanContext;
  appData: string | undefined;
}

function cliPlan(slug: AgentSlug, bin: string, argv: Pick<CliInstallPlan, 'addArgv' | 'removeArgv'>, serverName: string): CliInstallPlan {
  return { kind: 'cli', slug, bin, ...argv, getArgv: ['mcp', 'get', serverName] };
}

function jsonPlan(slug: AgentSlug, configPath: string, keyPath: string[], serverKey: string, entry: unknown): JsonInstallPlan {
  return { kind: 'json', slug, configPath, keyPath, serverKey, entry };
}

// One planner per slug. Typed as a total map over `AgentSlug`, so adding a slug
// without a planner is a compile error (the role the old switch's `never` default played).
const AGENT_PLANNERS: { readonly [K in AgentSlug]: (args: PlannerArgs) => InstallPlan } = {
  // ----- CLI-driven agents (idempotent via the agent's own tool) -----
  claude: ({ spec, ctx: { serverName } }) => cliPlan('claude', 'claude', {
    addArgv: [
      'mcp', 'add', '--scope', 'user',
      serverName,
      ...envFlags(spec.env, '-e'),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', '--scope', 'user', serverName],
  }, serverName),
  codex: ({ spec, ctx: { serverName } }) => cliPlan('codex', 'codex', {
    addArgv: [
      'mcp', 'add', serverName,
      ...envFlags(spec.env, '--env'),
      '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName),
  kimi: ({ spec, ctx: { serverName } }) => cliPlan('kimi', 'kimi', {
    addArgv: [
      'mcp', 'add', '--transport', 'stdio',
      ...envFlags(spec.env, '--env'),
      serverName, '--', spec.command, ...spec.args,
    ],
    removeArgv: ['mcp', 'remove', serverName],
  }, serverName),

  // ----- JSON config-file agents (safe deep-merge) -----
  cursor: ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('cursor', path.join(home, '.cursor', 'mcp.json'), ['mcpServers'], serverName, jsonEntry(spec, { type: 'stdio' })),
  // GitHub Copilot CLI: ~/.copilot/mcp-config.json, type "local".
  // (VS Code Copilot uses a different `servers` key in
  // .vscode/mcp.json; the terminal installer targets the CLI.)
  copilot: ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('copilot', path.join(home, '.copilot', 'mcp-config.json'), ['mcpServers'], serverName, jsonEntry(spec, { type: 'local', tools: ['*'] })),
  cline: ({ spec, ctx: { home, platform, serverName }, appData }) =>
    jsonPlan('cline', clineConfigPath(home, platform, appData), ['mcpServers'], serverName, jsonEntry(spec, { disabled: false, autoApprove: [] })),
  // OpenCode nests under `mcp`, folds command+args into one array,
  // and gates the server with `enabled`.
  opencode: ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('opencode', path.join(home, '.config', 'opencode', 'opencode.json'), ['mcp'], serverName,
      withEnv({ type: 'local', command: [spec.command, ...spec.args], enabled: true }, spec.env, 'environment')),
  openclaw: ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('openclaw', path.join(home, '.openclaw', 'openclaw.json'), ['mcp', 'servers'], serverName, jsonEntry(spec)),
  antigravity: ({ spec, ctx: { home, serverName } }) =>
    jsonPlan('antigravity', path.join(home, ...ANTIGRAVITY_MCP_CONFIG_SEGMENTS), ['mcpServers'], serverName, jsonEntry(spec)),
  trae: ({ spec, ctx: { home, platform, serverName }, appData }) =>
    jsonPlan('trae', traeConfigPath(home, platform, appData), ['mcpServers'], serverName, jsonEntry(spec)),

  // ----- Unverified formats: print-only, never write -----
  vibe: ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'vibe',
    format: 'toml',
    configPath: path.join(home, '.vibe', 'config.toml'),
    snippet: vibeTomlSnippet({ spec, name: serverName }),
    reason:
      'Vibe uses a TOML array-of-tables ([[mcp_servers]]); ' +
      'its exact schema is unverified, so append this block by hand ' +
      'to avoid corrupting an existing config.',
  }),
  pi: ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'pi',
    format: 'json',
    configPath: path.join(home, '.pi', 'agent', 'mcp.json'),
    snippet: JSON.stringify({ mcpServers: { [serverName]: jsonEntry(spec) } }, null, 2),
    reason:
      'The pi coding agent exposes MCP, but its config path/schema is ' +
      'not authoritatively documented. Paste this into pi’s MCP ' +
      'config (check `pi --help` for the exact location).',
  }),
  hermes: ({ spec, ctx: { home, serverName } }) => ({
    kind: 'manual',
    slug: 'hermes',
    format: 'yaml',
    configPath: path.join(home, '.hermes', 'config.yaml'),
    snippet: hermesYamlSnippet(spec, serverName),
    reason:
      'Hermes config format is unverified. Add this under your Hermes ' +
      'MCP server configuration by hand.',
  }),
};

/**
 * Build the registration plan for one agent. Pure — all IO happens in the
 * executor. Throws on an unknown slug so callers surface a clear error.
 */
export function planAgentInstall(
  { slug, spec, ctx }: { slug: AgentSlug; spec: McpLaunchSpec; ctx: PlanContext },
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {},
): InstallPlan {
  // Own-property lookup only: a slug such as `constructor` or `__proto__` must not
  // resolve to an inherited Object.prototype member and be called as a planner.
  if (!Object.prototype.hasOwnProperty.call(AGENT_PLANNERS, slug)) {
    throw new Error(`unknown agent slug: ${String(slug)}`);
  }
  return AGENT_PLANNERS[slug]({ spec, ctx, appData: env.APPDATA });
}

// VS Code-family editors keep per-user state under one platform-specific root.
function editorUserDir(app: string, home: string, platform: NodeJS.Platform, suppliedAppData: string | undefined): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', app, 'User');
  if (platform === 'win32') return path.join(suppliedAppData ?? path.join(home, 'AppData', 'Roaming'), app, 'User');
  return path.join(home, '.config', app, 'User');
}

function clineConfigPath(home: string, platform: NodeJS.Platform, suppliedAppData: string | undefined): string {
  return path.join(
    editorUserDir('Code', home, platform, suppliedAppData),
    'globalStorage',
    'saoudrizwan.claude-dev',
    'settings',
    'cline_mcp_settings.json',
  );
}

function traeConfigPath(home: string, platform: NodeJS.Platform, suppliedAppData: string | undefined): string {
  return path.join(editorUserDir('Trae', home, platform, suppliedAppData), 'mcp.json');
}

// --- Pure JSON merge / removal (the heart of the 'json' strategy) -------

// CR-007: `JsonInstallPlan` is a public shape and `applyJsonInstall` /
// `removeJsonInstall` are public functions — a caller-supplied `keyPath`/
// `serverKey` containing `__proto__`, `prototype`, or `constructor` would
// otherwise let bracket-notation traversal (`cursor[key]`) walk onto (and
// then assign directly onto) `Object.prototype` or a constructor function,
// polluting every plain object in the process rather than merely the target
// config file. Every segment is validated before any traversal/assignment
// happens, so a dangerous plan is rejected outright instead of partially
// applied.
const DANGEROUS_OBJECT_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function assertSafeObjectPathSegment(segment: string, context: string): void {
  if (DANGEROUS_OBJECT_PATH_SEGMENTS.has(segment)) {
    throw new Error(
      `refusing to apply MCP install plan: "${segment}" is not a safe ${context} segment (prototype-pollution guard)`,
    );
  }
}

function assertSafeJsonInstallPlan(plan: JsonInstallPlan): void {
  for (const key of plan.keyPath) {
    assertSafeObjectPathSegment(key, 'keyPath');
  }
  assertSafeObjectPathSegment(plan.serverKey, 'serverKey');
}

/**
 * Merge one server entry into existing config text without disturbing the
 * rest. Missing intermediate objects are created. Returns pretty JSON with
 * a trailing newline. Throws if existing text is non-empty but unparseable
 * (caller decides whether to bail or back up), or if `plan.keyPath` /
 * `plan.serverKey` contains a dangerous object-path segment (CR-007).
 */
export function applyJsonInstall({ existingText, plan }: { existingText: string | null; plan: JsonInstallPlan }): string {
  assertSafeJsonInstallPlan(plan);
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor: Record<string, unknown> = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[plan.serverKey] = plan.entry;
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Remove the server entry. Returns the new text, or null when the file did
 * not exist / had nothing to remove (caller treats null as a no-op). Throws
 * if `plan.keyPath` / `plan.serverKey` contains a dangerous object-path
 * segment (CR-007).
 */
export function removeJsonInstall({ existingText, plan }: { existingText: string | null; plan: JsonInstallPlan }): string | null {
  assertSafeJsonInstallPlan(plan);
  if (existingText == null || existingText.trim() === '') return null;
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor: Record<string, unknown> = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      return null;
    }
    cursor = next as Record<string, unknown>;
  }
  if (!(plan.serverKey in cursor)) return null;
  delete cursor[plan.serverKey];
  return `${JSON.stringify(root, null, 2)}\n`;
}

function parseJsonObject(text: string | null, where: string): Record<string, unknown> {
  if (text == null || text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // JSON.parse only ever throws a SyntaxError, so `err` is always an Error.
    throw new Error(`existing config at ${where} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`existing config at ${where} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Check the installed JSON entry using the installer’s own path and launch contract.
 * Read failures and stale/disabled entries name the repair without exposing configuration values.
 * This does not mutate global config or persist a run credential. O(config bytes).
 */
export async function verifyJsonAgentInstall(
  { agentId, spec, ctx, readFile }: { agentId: string; spec: McpLaunchSpec; ctx: PlanContext;
    readFile: (required: { path: string }) => Promise<string> },
  _optional: Record<string, never> = {},
): Promise<void> {
  const slug = { value: agentId };
  if (!isAgentSlug(slug)) throw new Error('Unknown MCP agent installation');
  const plan = planAgentInstall({ slug: slug.value, spec, ctx });
  if (plan.kind !== 'json') throw new Error('MCP installation does not use a JSON registry');
  try {
    assertSafeJsonInstallPlan(plan);
    const root = parseJsonObject(await readFile({ path: plan.configPath }), plan.configPath);
    const entry = installedJsonEntry({ root, plan });
    if (!installedLaunchMatches({ entry, expected: plan.entry })) throw new Error('Invalid bridge entry');
  } catch {
    throw new Error(`The assistant's tools are not set up in ${agentId}. Run "mcp install ${agentId}" to repair the bridge entry in ${plan.configPath}, then try again.`);
  }
}

function installedJsonEntry({ root, plan }: { root: Record<string, unknown>; plan: JsonInstallPlan }): unknown {
  let value: unknown = root;
  for (const key of [...plan.keyPath, plan.serverKey]) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function installedLaunchMatches({ entry, expected }: { entry: unknown; expected: unknown }): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const actual = entry as Record<string, unknown>;
  const wanted = expected as Record<string, unknown>;
  if (actual.disabled === true || actual.command !== wanted.command) return false;
  if (JSON.stringify(actual.args ?? []) !== JSON.stringify(wanted.args ?? [])) return false;
  return JSON.stringify(actual.env ?? {}) === JSON.stringify(wanted.env ?? {});
}

// --- Snippets for the manual (print-only) strategy ----------------------

function hermesYamlSnippet(spec: McpLaunchSpec, name: string): string {
  const lines = [
    'mcp_servers:',
    `  ${name}:`,
    `    command: ${JSON.stringify(spec.command)}`,
    `    args: ${JSON.stringify(spec.args)}`,
  ];
  if (Object.keys(spec.env).length > 0) {
    lines.push('    env:');
    for (const [k, v] of Object.entries(spec.env)) {
      lines.push(`      ${k}: ${JSON.stringify(v)}`);
    }
  }
  return lines.join('\n');
}

/** Render the launch command and environment as a Vibe TOML snippet without I/O.
 * @complexity O(n) time and space in the serialized launch spec length.
 */
function vibeTomlSnippet({ spec, name }: { spec: McpLaunchSpec; name: string }, _options = {}): string {
  const argsToml = `[${spec.args.map((a) => JSON.stringify(a)).join(', ')}]`;
  const lines = [
    '[[mcp_servers]]',
    `name = ${JSON.stringify(name)}`,
    'transport = "stdio"',
    `command = ${JSON.stringify(spec.command)}`,
    `args = ${argsToml}`,
  ];
  if (Object.keys(spec.env).length > 0) {
    const envToml = Object.entries(spec.env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(', ');
    lines.push(`env = { ${envToml} }`);
  }
  return lines.join('\n');
}
