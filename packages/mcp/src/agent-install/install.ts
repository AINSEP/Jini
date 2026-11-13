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
//                rest of the file. Used for cursor / cline /
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

import { isDeepStrictEqual } from 'node:util';

import type { PlannerArgs } from './planner-shared.js';
import { planClaudeInstall } from './claude/install.js';
import { planCodexInstall } from './codex/install.js';
import { planKimiInstall } from './kimi/install.js';
import { planCursorInstall } from './cursor/install.js';
import { planClineInstall } from './cline/install.js';
import { planOpencodeInstall } from './opencode/install.js';
import { planOpenclawInstall } from './openclaw/install.js';
import { planAntigravityInstall } from './antigravity/install.js';
import { planTraeInstall } from './trae/install.js';
import { planVibeInstall } from './vibe/install.js';
import { planPiInstall } from './pi/install.js';
import { planHermesInstall } from './hermes/install.js';
export { ANTIGRAVITY_MCP_CONFIG_SEGMENTS } from './antigravity/install.js';


/**
 * Exhaustive tuple of all agent slugs recognized by `mcp install`.
 * Used as the source of truth for the `AgentSlug` union type and the `isAgentSlug` guard.
 */
export const AGENT_SLUGS = [
  'claude',
  'codex',
  'cursor',
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

// One planner per slug. Typed as a total map over `AgentSlug`, so adding a slug
// without a planner is a compile error (the role the old switch's `never` default played).
const AGENT_PLANNERS: { readonly [K in AgentSlug]: (args: PlannerArgs) => InstallPlan } = {
  claude: planClaudeInstall,
  codex: planCodexInstall,
  kimi: planKimiInstall,
  cursor: planCursorInstall,
  cline: planClineInstall,
  opencode: planOpencodeInstall,
  openclaw: planOpenclawInstall,
  antigravity: planAntigravityInstall,
  trae: planTraeInstall,
  vibe: planVibeInstall,
  pi: planPiInstall,
  hermes: planHermesInstall,
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
 * rest. Missing intermediate objects are created; an entry under the same name that launches this
 * package's bridge (an earlier install) is replaced; any other named entry and non-object paths are refused. Returns pretty JSON with
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
    if (next !== undefined && (next === null || typeof next !== 'object' || Array.isArray(next))) {
      throw new Error('Existing MCP config path is not an object');
    }
    if (next === undefined) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  if (Object.hasOwn(cursor, plan.serverKey) && !isDeepStrictEqual(cursor[plan.serverKey], plan.entry)
    && !launchesJiniBridge({ entry: cursor[plan.serverKey] })) {
    throw new Error(`${plan.configPath} already has an MCP server named "${plan.serverKey}" that this app did not add, so it was left as it is. `
      + `Rename or remove that "${plan.serverKey}" entry, then try again, or choose another agent.`);
  }
  cursor[plan.serverKey] = plan.entry;
  return `${JSON.stringify(root, null, 2)}\n`;
}

/** The bridge script every install of this package launches: `<pkg>/dist/bin/serve.js`, published as
 * `@jini-ai/mcp` (or the earlier `@jini/mcp`) or linked from a `jini/packages/mcp` checkout. */
const JINI_BRIDGE_SCRIPT = /(?:^|\/)(?:@jini(?:-ai)?|jini\/packages)\/mcp\/dist\/bin\/serve\.js$/i;

/** True when an existing entry launches this package's own bridge, i.e. an earlier install wrote it
 * (another install path, Node binary, env or enabled flag). Covers both the `command`+`args` and the
 * folded OpenCode `command: [bin, ...args]` shapes. O(launch strings). */
function launchesJiniBridge({ entry }: { entry: unknown }): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const { command, args } = entry as Record<string, unknown>;
  const launch = [...(Array.isArray(command) ? command : [command]), ...(Array.isArray(args) ? args : [])];
  return launch.some(part => typeof part === 'string' && JINI_BRIDGE_SCRIPT.test(part.replaceAll('\\', '/')));
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
  } catch {
    // JSON.parse only throws SyntaxError; its message may quote private configuration bytes.
    throw new Error(`existing config at ${where} is not valid JSON`);
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
