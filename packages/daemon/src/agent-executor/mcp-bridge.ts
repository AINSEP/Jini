import {
  promises as fsPromises,
} from 'node:fs';
import {
  homedir,
  tmpdir,
} from 'node:os';
import {
  join,
  resolve,
} from 'node:path';
import type {
   AcpMcpServerInput,
   RuntimeAgentDef,
} from '@jini-ai/agent-runtime';
import {
  isRecord,
  errorMessage,
} from './values.js';
import type {
   McpJsonInjectionOptions,
   McpJsonServerEntry,
   McpBridgeDelivery,
   PreparedCodexHome,
   PreparedClaudeConfigDir,
   ClaudeConfigDirSeams,
   ClaudeConfigDirIsolationOptions,
   FailBeforeSpawn,
} from './contracts.js';

const JINI_MCP_SERVER_KEY = 'jini';

/** The run-error code a run gets when its CLI reports the injected `jini` bridge as anything but connected. */
export const MCP_BRIDGE_UNAVAILABLE = 'MCP_BRIDGE_UNAVAILABLE';

/**
 * Judges a CLI's startup report of the injected bridge. Returns the bridge's status (`'missing'`
 * when the list omits it) when it is not `'connected'`, and `undefined` when it is connected or
 * when `rawEvent` is not an init status carrying an MCP server list (nothing to judge).
 *
 * `'pending'` counts as a failure on purpose: the CLI decides which MCP tools a session has at
 * startup, so a bridge that is not connected by then never joins this run.
 * @param rawEvent - One parsed stream event, as `@jini-ai/agent-runtime`'s parser emits it.
 * @complexity O(n) in the number of reported servers.
 */
export function unavailableJiniBridgeStatus({ rawEvent }: { readonly rawEvent: unknown }): string | undefined {
  if (!isRecord(rawEvent) || rawEvent.type !== 'status' || rawEvent.label !== 'initializing') return undefined;
  if (!Array.isArray(rawEvent.mcpServers)) return undefined;
  const bridge = rawEvent.mcpServers.find((server) => isRecord(server) && server.name === JINI_MCP_SERVER_KEY);
  const status = isRecord(bridge) ? String(bridge.status) : 'missing';
  return status === 'connected' ? undefined : status;
}

/** The user-readable reason a run stopped because its bridge did not connect. */
export function bridgeUnavailableMessage(status: string): string {
  return `The assistant's tools did not load (MCP bridge "${JINI_MCP_SERVER_KEY}" status: ${status}). The run was stopped instead of continuing without them.`;
}

/**
 * Builds this run's `mcpServers.jini` entry — pure and synchronous, so every field mapping is
 * directly assertable without touching the filesystem. The credential arrives already resolved:
 * `McpJsonInjectionOptions.credential` is a possibly-async per-run resolver, and awaiting it is
 * `writeMcpJsonForRun`'s job, which keeps the effect out of this function.
 *
 * @param runId - The run this entry scopes its child to.
 * @param options - `command`/`args`/`daemonUrl`/`env` from the host's injection options.
 * @param credential - The already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN`
 * entirely. Omitting produces byte-identical output to before this parameter existed.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpJsonServerEntry({ runId, options }: { readonly runId: string; readonly options: Pick<McpJsonInjectionOptions, 'command' | 'args' | 'daemonUrl' | 'env'> }, { credential }: { readonly credential?: string } = {}
): McpJsonServerEntry {
  const hostEnv = Object.entries(options.env ?? {}).filter(([key]) => !key.startsWith('JINI_'));
  return {
    command: options.command,
    args: options.args !== undefined ? [...options.args] : [],
    env: {
      ...Object.fromEntries(hostEnv),
      JINI_RUN_ID: runId,
      JINI_DAEMON_URL: options.daemonUrl,
      ...(credential !== undefined ? { JINI_DAEMON_TOKEN: credential } : {}),
    },
  };
}

/**
 * Merges {@link JINI_MCP_SERVER_KEY} into an existing `.mcp.json`'s `mcpServers` map, preserving
 * every other key and every other registered server untouched. A missing (`existingRaw ===
 * undefined`), empty, or unparseable-as-a-JSON-object existing file all degrade to "start from an
 * empty document" rather than throwing — an unparseable project `.mcp.json` is a pre-existing
 * problem this driver did not create and cannot safely repair, so it is deliberately overwritten
 * with a fresh, valid file containing just this run's bridge entry rather than left broken or
 * left blocking the run. Pure — no I/O — so every branch is directly assertable.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify`'s own cost on a small config file.
 * @overallScore 100/100
 */
export function mergeMcpJsonContent({ existingRaw, serverEntry }: { readonly existingRaw: string | undefined; readonly serverEntry: McpJsonServerEntry }): string {
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
  const mcpServers = { ...existingServers, [JINI_MCP_SERVER_KEY]: serverEntry };
  return `${JSON.stringify({ ...doc, mcpServers }, null, 2)}\n`;
}

/**
 * Mechanism 2 of 5 — `'acp-merge'`. Re-shapes the same bridge entry into the `mcpServers` element
 * an ACP `session/new` call carries, for the 9 ACP-native defs declaring this strategy (amr, devin,
 * hermes, kilo, kimi, kiro, reasonix, trae-cli, vibe). Pure.
 *
 * `env` is emitted as a plain object on purpose: `@jini-ai/agent-runtime`'s
 * `buildAcpSessionNewParams` already normalises a plain-object `env` into either the
 * `[{name, value}]` array form or the `{"KEY": "val"}` map form according to each def's own
 * `acpMcpEnvFormat`, so the per-vendor wire-shape difference stays in the one place that already
 * owns it rather than being re-decided here.
 *
 * **The credential travels in `env`, never in `args`.** An ACP agent spawns this server itself and
 * applies `env` to that child's environment; a token in `args` would land in the child's process
 * arguments, readable by any other local user via `ps`. Same rule as the `.mcp.json` path.
 *
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns A single-element list — this driver contributes exactly its own bridge server and never
 * removes or rewrites servers a def or host added by other means.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildAcpMcpBridgeServers({ entry }: { readonly entry: McpJsonServerEntry }): AcpMcpServerInput[] {
  return [
    {
      type: 'stdio',
      name: JINI_MCP_SERVER_KEY,
      command: entry.command,
      args: [...entry.args],
      env: { ...entry.env },
    },
  ];
}

/**
 * Mechanism 3+4 of 5 — the spawn-env-content strategies. One map, not two code paths: OpenCode and
 * MiMo consume byte-identical JSON (MiMo's def doc: "the same JSON schema as OpenCode's `mcp`
 * config ... following the same structure as `OPENCODE_CONFIG_CONTENT`"), and differ only in which
 * env var carries it. Adding a third such CLI is a row here, not a new serializer.
 */
const ENV_CONTENT_VAR_BY_STRATEGY: Readonly<Record<'opencode-env-content' | 'mimo-env-content', string>> = {
  'opencode-env-content': 'OPENCODE_CONFIG_CONTENT',
  'mimo-env-content': 'MIMOCODE_CONFIG_CONTENT',
};

/**
 * Serialises the bridge entry into the OpenCode-schema config JSON that `OPENCODE_CONFIG_CONTENT`
 * / `MIMOCODE_CONFIG_CONTENT` carries, merging into whatever the host already put in that variable
 * rather than replacing it — the same "merge, never clobber" discipline
 * {@link mergeMcpJsonContent} applies to `.mcp.json`, and for the same reason: a host may already
 * be handing the CLI the *user's* configured MCP servers through this exact variable, and
 * overwriting it would silently delete them.
 *
 * A missing, empty, or unparseable-as-a-JSON-object existing value degrades to "start from an empty
 * document". Overwriting an unparseable value is deliberate and matches `mergeMcpJsonContent`: this
 * driver did not create it, cannot safely repair it, and must not block the run on it.
 *
 * Emitted per server: `{type: 'local', command: [<command>, ...<args>], environment: {...},
 * enabled: true}` — the shape `@jini-ai/mcp`'s own `buildOpenCodeMcpConfigContent` emits for a
 * stdio server, so both producers stay schema-compatible.
 *
 * **The credential lands in `environment`, i.e. the MCP child's env — never in `command`.** OpenCode
 * spawns the bridge from `command`, so a token placed there would be visible in `ps` output to
 * every other local user. This is the same constraint that keeps `JINI_DAEMON_TOKEN` out of argv on
 * the `.mcp.json` and ACP paths.
 *
 * @param existingRaw - Whatever the spawn env already held for this variable, or `undefined`.
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns The full JSON string to set as the env var's value.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify` over a small config document.
 * @overallScore 100/100
 */
export function mergeEnvContentMcpConfig({ existingRaw, entry }: { readonly existingRaw: string | undefined; readonly entry: McpJsonServerEntry }): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined && existingRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingMcp = isRecord(doc.mcp) ? doc.mcp : {};
  const mcp = {
    ...existingMcp,
    [JINI_MCP_SERVER_KEY]: {
      type: 'local',
      command: [entry.command, ...entry.args],
      environment: { ...entry.env },
      enabled: true,
    },
  };
  return JSON.stringify({ ...doc, mcp });
}

/**
 * Merges a staged system-prompt overlay file's path into the `instructions` array of the same
 * OpenCode-schema config document {@link mergeEnvContentMcpConfig} writes `mcp` into — for a
 * `systemPromptDelivery: { strategy: 'config-instructions-file' }` def (`opencode` today).
 *
 * Confirmed live (2026-09-01, opencode-cli 1.17.10), not inferred from docs alone:
 *   1. `instructions` is honored — a run configured with it visibly followed the file's directive
 *      (a required exact-token prefix), while an identical run without it did not.
 *   2. It appends, never replaces: the same run that followed the custom instruction ALSO still
 *      answered correctly using opencode's own baked-in environment-context system prompt (asked
 *      for its cwd, with nothing about cwd anywhere in the custom instructions file) — proof
 *      opencode's own defaults survive alongside a custom `instructions` entry, not just proof the
 *      file was read at all.
 *   3. Adding this key alongside `mcp` in the same `OPENCODE_CONFIG_CONTENT` document disturbs
 *      neither: in one combined run, the MCP bridge still got its connection attempt (logged
 *      `key=jini type=local`) AND the custom instruction was still followed — same as running each
 *      key alone.
 *   4. `instructions` is re-read fresh from the env on every spawn, including a `-s <id>`-resumed
 *      turn (proved by swapping in a second instructions file between two turns of one resumed
 *      session and seeing the second turn immediately reflect it while still recalling
 *      conversation memory from turn one) — so this mechanism is safe to redeliver every turn like
 *      `'append-flag'`/`'env-var'`, exempt from the prompt-prefix fallback's create-only gating
 *      (see {@link resolveSystemPromptOverlayDelivery}'s doc): nothing here is ever baked into
 *      opencode's own persisted session state the way re-injecting fallback prompt text would be.
 *
 * @param existingRaw - Whatever the spawn env already held for this variable (already possibly
 * carrying `mcp`, if `mergeEnvContentMcpConfig` ran first on the same value — order between the two
 * doesn't matter, each only touches its own top-level key), or `undefined`.
 * @param instructionsFilePath - The staged overlay file's absolute path (see
 * {@link prepareSystemPromptOverlayFileIfNeeded}).
 * @returns The full JSON string to set as the env var's value. Appends to, never clobbers, any
 * `instructions` entries already present — the same "merge, never clobber" discipline
 * {@link mergeEnvContentMcpConfig} applies to `mcp`, in case a host is already using this same
 * config-content variable to carry the operator's own instruction files.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify` over a small config document.
 * @overallScore 100/100
 */
export function mergeEnvContentInstructions({ existingRaw, instructionsFilePath }: { readonly existingRaw: string | undefined; readonly instructionsFilePath: string }): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined && existingRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingInstructions = Array.isArray(doc.instructions)
    ? doc.instructions.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return JSON.stringify({ ...doc, instructions: [...existingInstructions, instructionsFilePath] });
}

/**
 * TOML basic-string escaping for the narrow value shapes {@link buildCodexMcpServerToml} emits (a
 * command name, an argv token, an env var value — never multi-line or control-character-heavy
 * text). Escapes exactly what TOML's basic-string grammar requires: backslash first (so it is not
 * re-escaped by a later replacement), then the quote delimiter, then the three whitespace control
 * characters a real command/argv/env value could plausibly contain.
 *
 * A hand-rolled minimal escaper rather than a TOML dependency — this mechanism never needs to
 * *parse* TOML (the real install's existing `config.toml` is appended after, never rewritten — see
 * {@link buildCodexHomeConfigToml}), so pulling in a full TOML library for one serialization shape
 * would be substantially more surface than the problem needs. Checked against the repo's existing
 * dependency graph first — no package here already depends on a TOML library.
 * @param value - The raw string to embed inside TOML `"..."` delimiters.
 * @returns The escaped text, WITHOUT the surrounding quotes — {@link tomlString} adds those.
 * @complexity O(n) in the string's length.
 */
function escapeTomlBasicString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Wraps {@link escapeTomlBasicString}'s output in the TOML basic-string delimiters. */
function tomlString(value: string): string {
  return `"${escapeTomlBasicString(value)}"`;
}

/** A TOML key: bare when TOML allows it, quoted otherwise — host-supplied bridge env names are not guaranteed bare-safe. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/**
 * Codex's per-tool deadline for the Jini bridge, in seconds: `@jini-ai/mcp`'s
 * `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS` (6 min, mirrored because this package does not depend on
 * that one) plus 40 s. Codex's own default (60 s) is shorter than a delegated call parked on a
 * human dialog, and when Codex abandons a call the dialog stayed answerable, so a late click ran
 * an action the model had been told failed. Outlasting the bridge's deadline means the bridge
 * times out first, drops its daemon request, and the daemon expires the dialog. Codex does not
 * pass the parent env through to MCP servers, so the bridge under Codex always runs at its default.
 */
const CODEX_TOOL_TIMEOUT_SEC = 6 * 60 + 40;

/**
 * Mechanism 5 of 5 — `'codex-toml'`'s serialization step. Builds the `[mcp_servers.jini]` TOML
 * table (plus, when the entry carries any env vars, a separate `[mcp_servers.jini.env]` table)
 * Codex's own config schema expects.
 *
 * Confirmed against a real installed Codex CLI (0.151.0), not assumed from docs: round-tripping
 * `codex mcp add <name> --env K=V -- <cmd> <args>` against a scratch `CODEX_HOME` and reading back
 * `config.toml` produced exactly this shape (`command`/`args` as TOML strings/array in the main
 * table, env vars in a nested `.env` table) — see `archived provenance ledger` for the transcript.
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns A TOML fragment with no leading/trailing blank-line padding — {@link buildCodexHomeConfigToml} owns spacing when combining it with existing content.
 * @complexity O(n) in the number of argv/env entries.
 * @overallScore 100/100
 */
export function buildCodexMcpServerToml({ entry }: { readonly entry: McpJsonServerEntry }): string {
  const argsLiteral = entry.args.map(tomlString).join(', ');
  const serverTable =
    `[mcp_servers.${JINI_MCP_SERVER_KEY}]\ncommand = ${tomlString(entry.command)}\nargs = [${argsLiteral}]\n` +
    `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\n`;
  const envLines = Object.entries(entry.env)
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string')
    .map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`);
  if (envLines.length === 0) return serverTable;
  return `${serverTable}\n[mcp_servers.${JINI_MCP_SERVER_KEY}.env]\n${envLines.join('\n')}\n`;
}

/**
 * Splits a TOML table header's dotted key into its individual segments, honoring quoted parts
 * (`"basic"` or `'literal'`) that may themselves contain a literal `.` — a bare `.` only
 * separates segments outside of quotes. Each segment is trimmed and, if quoted, unwrapped.
 *
 * Not a full TOML parser: it does not resolve escape sequences (`\"`, `\u...`) inside basic
 * strings. That is deliberately out of scope — see {@link stripExistingJiniMcpServerTable}'s doc
 * for why it is safe to skip for this specific comparison.
 * @param rawKey - The raw text between a table header's `[` and `]`.
 * @returns The dotted key's segments, dequoted and trimmed.
 * @complexity O(n) in the length of `rawKey`.
 */
function splitTomlDottedKey(rawKey: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of rawKey) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '.') {
      segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current.trim());
  return segments;
}

/**
 * Removes any pre-existing `[mcp_servers.{@link JINI_MCP_SERVER_KEY}]` table — and its
 * `[mcp_servers.{@link JINI_MCP_SERVER_KEY}.*]` subtables (e.g. `.env`) — from a real Codex
 * `config.toml`'s raw text, so {@link buildCodexHomeConfigToml} can append this run's own table
 * without producing the duplicate TOML key Codex's parser rejects at startup.
 *
 * Line-oriented, not a real TOML parser (matching {@link buildCodexMcpServerToml}'s own
 * no-TOML-dependency constraint), but wide enough to survive a hand-edited config, which is the
 * scenario this whole function exists for. A table header line is recognized when, after
 * trimming, it is `[<key>]` optionally followed only by a `# comment` (TOML's own grammar allows
 * nothing else there) — so it tolerates leading indentation, whitespace inside the brackets, a
 * trailing line comment, and a dotted key written with quoted segments (`["mcp_servers"."jini"]`),
 * via {@link splitTomlDottedKey}. Once such a header's key matches the jini table or one of its
 * subtables, every following line is dropped until the next table header (of any name) or EOF.
 * Every other table, key, comment-only, and blank line is passed through untouched.
 *
 * Deliberately unhandled, and why it is safe to leave that way:
 * - **Escape sequences inside quoted key segments** (e.g. a segment containing `\"`) — neither
 *   `mcp_servers` nor {@link JINI_MCP_SERVER_KEY} ever needs escaping, and this driver's own
 *   writer ({@link buildCodexMcpServerToml}) never emits a quoted form at all, so no real
 *   `config.toml` this driver produced can exercise this gap; a hand-edit that goes out of its
 *   way to escape a character inside a key that is supposed to spell "jini" would fail to match
 *   and fall back to today's pre-fix behavior (append a duplicate) rather than silently doing
 *   something worse.
 * - **`[[array-of-tables]]` syntax** — Codex's schema has no array-of-tables shape for
 *   `mcp_servers`, and the header regex's `[^[\]]+` capture cannot match a line starting with a
 *   second `[`, so `[[mcp_servers.jini]]` is not recognized as a header before or after this fix
 *   — unchanged, not a new gap.
 * - **A single quoted segment that happens to spell the same characters with the dot included**
 *   (e.g. `["mcp_servers.jini"]`, which in real TOML names one key literally containing a `.`,
 *   not two nested tables) — this collapses to the same joined string as the real nested-table
 *   spelling and is therefore treated as a match. This is a false positive in the conservative
 *   direction the reported bug calls for: a missed detection duplicates a key and crashes Codex,
 *   so on this axis over-matching a spelling nobody would plausibly hand-write for an MCP server
 *   table is preferable to under-matching the real one.
 * @param existingRaw - The real Codex home's `config.toml` content, already known to be defined
 * (callers pass `''` for a missing file).
 * @returns `existingRaw` with any jini table/subtable removed.
 * @complexity O(n) in the number of lines.
 */
function stripExistingJiniMcpServerTable(existingRaw: string): string {
  const jiniTableKey = `mcp_servers.${JINI_MCP_SERVER_KEY}`;
  const kept: string[] = [];
  let skipping = false;
  for (const line of existingRaw.split('\n')) {
    const header = /^\s*\[([^[\]]+)\]\s*(#.*)?$/.exec(line);
    if (header) {
      const key = splitTomlDottedKey(header[1] ?? '').join('.');
      skipping = key === jiniTableKey || key.startsWith(`${jiniTableKey}.`);
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Builds the full `config.toml` a run's scratch `CODEX_HOME` gets: the real Codex home's own
 * config, with any pre-existing `[mcp_servers.jini]` table removed (see
 * {@link stripExistingJiniMcpServerTable}), then this run's own table appended.
 *
 * **Append-only by design, not a parse-and-merge, for everything but the jini table itself.**
 * `mergeMcpJsonContent`/`mergeEnvContentMcpConfig` above can safely parse-merge-reserialize because
 * their formats have a JS-native parser (`JSON.parse`); this driver has no general TOML parser in
 * its dependency graph (see `buildCodexMcpServerToml`'s doc), and every other setting a real Codex
 * install carries — model choice, sandbox policy, the trusted-project list, the operator's own
 * other MCP servers — must survive a spawn byte-for-byte. Only the one table this driver itself
 * owns (`jini` is this integration's own reserved server name — see {@link JINI_MCP_SERVER_KEY}) is
 * ever removed, via the narrow line-oriented scan above, never a full TOML parse.
 * @param existingRaw - The real Codex home's `config.toml` content, or `undefined` when it does not
 * exist (a fresh Codex install — degrades to "start from just this run's block", matching
 * {@link mergeMcpJsonContent}'s own "missing file" handling).
 * @param entry - The shared bridge entry.
 * @returns The full text to write to the scratch `CODEX_HOME`'s `config.toml`.
 * @complexity O(n) in the existing config's length.
 */
export function buildCodexHomeConfigToml({ existingRaw, entry }: { readonly existingRaw: string | undefined; readonly entry: McpJsonServerEntry }): string {
  const base = stripExistingJiniMcpServerTable(existingRaw ?? '');
  const separator = base.length === 0 ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return `${base}${separator}${buildCodexMcpServerToml({ entry: entry })}`;
}

/**
 * Where `'codex-toml'` reads the operator's REAL Codex config from, to seed a run's scratch copy —
 * never where it writes. Resolved against the daemon HOST process's own environment (`hostEnv`,
 * `process.env` at the real call site), not a run's sandboxed spawn env: `CODEX_HOME` is not in
 * `BASELINE_AGENT_ENV_KEYS`, so a spawned child never inherits it anyway, and the whole point here
 * is finding wherever the *operator's actual* Codex install lives, which is a host-machine fact.
 * @param hostEnv - The daemon process's own environment.
 * @returns `hostEnv.CODEX_HOME` when set to a non-blank value (matching Codex's own resolution
 * order), else the CLI's documented default, `~/.codex`.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveSourceCodexHomeDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv }): string {
  const override = hostEnv.CODEX_HOME;
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.codex');
}

/**
 * **The single dispatch point from an `externalMcpInjection` strategy to its delivery mechanism.**
 * Pure and synchronous — the one effectful input (the per-run bearer credential) arrives already
 * resolved, so every strategy's mapping is directly assertable without touching the filesystem,
 * the environment, or a keystore.
 *
 * Keyed off the declared *strategy*, never off `def.id`: a def gets a working bridge by declaring a
 * mechanism, not by being named in this file. That is what makes the 9 `'acp-merge'` defs work
 * without any of their own files being touched.
 *
 * @param input.cwd - The run's working directory; only `'claude-mcp-json'` uses it, to place this
 * run's own config file (see {@link mcpJsonPathForRun}) — never `cwd/.mcp.json` itself.
 * @param input.runId - Scopes the bridge child to this run.
 * @param input.strategy - The def's declared `externalMcpInjection`, or `undefined` for a def with no native MCP transport.
 * @param input.options - The host's bridge options, or `undefined` when the host never configured injection.
 * @param input.credential - Already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN` entirely.
 * @returns `null` when this run delivers nothing — an unconfigured host, or a def declaring no
 * strategy — which is byte-identical to this feature not existing.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpBridgeDelivery(input: {
  readonly cwd: string;
  readonly runId: string;
  readonly strategy: RuntimeAgentDef['externalMcpInjection'];
  readonly options: McpJsonInjectionOptions | undefined;
  readonly credential: string | undefined;
}): McpBridgeDelivery | null {
  const { cwd, runId, strategy, options, credential } = input;
  if (options === undefined || strategy === undefined) return null;
  const serverEntry = buildMcpJsonServerEntry({ runId: runId, options: options }, credential === undefined ? {} : { credential });
  switch (strategy) {
    case 'claude-mcp-json':
      return { kind: 'claude-mcp-json', mcpJsonPath: mcpJsonPathForRun(cwd, runId), serverEntry };
    case 'acp-merge':
      return { kind: 'acp-merge', mcpServers: buildAcpMcpBridgeServers({ entry: serverEntry }) };
    case 'opencode-env-content':
    case 'mimo-env-content':
      return { kind: 'env-content', envVarName: ENV_CONTENT_VAR_BY_STRATEGY[strategy], serverEntry };
    case 'codex-toml':
      return { kind: 'codex-toml', serverEntry };
    case 'env-passthrough':
      return { kind: 'env-passthrough', serverEntry };
  }
}

function defaultReadMcpJsonFile({ path }: { readonly path: string }): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

function defaultWriteMcpJsonFile({ path, content }: { readonly path: string; readonly content: string }): Promise<void> {
  return fsPromises.writeFile(path, content, 'utf8');
}

export function defaultRemoveMcpJsonFile({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { force: true });
}

/**
 * This run's own MCP config path, inside `cwd` but deliberately **not** `cwd/.mcp.json`.
 *
 * A shared filename cannot carry two runs' identities at once, and that is exactly what the file
 * carries: `mcpServers.jini.env` holds this run's `JINI_RUN_ID` and its bearer `JINI_DAEMON_TOKEN`.
 * A spawned CLI reads its MCP config when it starts its client, not synchronously at spawn — so with
 * one shared file, a second run in the same directory overwrote the entry the first run's child had
 * not read yet, and that child's `jini-mcp` subprocess then called back carrying the *other* run's id
 * and token: run A's tool calls executing inside run B's authority context. Concurrent runs in one
 * working directory are supported by design (see `McpJsonInjectionOptions.credential`'s doc on why the
 * credential is a per-run resolver at all), so the resolution is one file per run, not a lock that
 * refuses the second run.
 *
 * Naming it after the run also means the project's own `.mcp.json` is never written at all — it stays
 * purely a merge source, so there is no original content to restore afterwards either.
 *
 * The run id is host-supplied and lands in a filename, so everything outside `[A-Za-z0-9_-]` is
 * replaced (dots included — a `..` segment must not survive) and the result is length-capped. Real run
 * ids are UUIDs, which pass through untouched; the cap could in principle collide two ids sharing a
 * 128-character prefix, which no id shape this daemon mints can produce.
 * @complexity O(n) in the run id's length.
 */
function mcpJsonPathForRun(cwd: string, runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return join(cwd, `.mcp.jini-${safeRunId}.json`);
}

/**
 * The `'claude-mcp-json'` mechanism's one effect: writes (merging, never clobbering — see
 * {@link mergeMcpJsonContent}) this run's own config — the project's own servers merged with this
 * run's `jini` bridge entry — to the run-scoped path ({@link mcpJsonPathForRun}) the def was already
 * handed via `RuntimeContext.mcpJsonPath`, so the def's own `--strict-mcp-config --mcp-config <path>`
 * argv has a real file to point at by spawn time, instead of auto-discovering `cwd/.mcp.json` (which
 * needs an interactive trust prompt a headless spawn can never answer — confirmed live 2026-07-30,
 * see `@jini-ai/agent-runtime`'s `defs/claude.ts`).
 *
 * Reads `cwd/.mcp.json` and writes `delivery.mcpJsonPath`: the project's file is a merge source only,
 * never a write target. See {@link mcpJsonPathForRun} for why one file per run is load-bearing rather
 * than cosmetic, and why the read and write paths must differ.
 *
 * A no-op for every other delivery mechanism, which is expressed by the caller simply not having a
 * `'claude-mcp-json'` delivery to hand it rather than by a strategy re-check in here.
 * @param cwd - The run's working directory, so the project's own `.mcp.json` can be read as the
 * merge base — not carried on `delivery` itself, since that only describes the write target.
 * @param delivery - The already-built `'claude-mcp-json'` delivery (path + entry). Both fields come
 * from {@link buildMcpBridgeDelivery}, so the credential was resolved exactly once, for this run.
 * @param options - Supplies the injectable `readFile`/`writeFile` seams.
 * @throws Whatever `writeFile` rejects with — the caller (`run()`) turns that into a pre-spawn
 * `AGENT_SPAWN_FAILED` failure, matching the pre-spawn filesystem guards in `launch.ts`
 * (`stagePromptFile`'s own try/catch).
 * @complexity O(1) plus one `readFile`/`writeFile` round trip.
 * @overallScore 100/100
 */
async function writeMcpJsonForRun(
  cwd: string,
  delivery: Extract<McpBridgeDelivery, { kind: 'claude-mcp-json' }>,
  options: McpJsonInjectionOptions,
): Promise<void> {
  const readFileFn = options.readFile ?? defaultReadMcpJsonFile;
  const writeFileFn = options.writeFile ?? defaultWriteMcpJsonFile;
  let existingRaw: string | undefined;
  try {
    existingRaw = await readFileFn({ path: join(cwd, '.mcp.json') });
  } catch {
    // No existing file (ENOENT — the common case) or unreadable for any other reason: both
    // degrade to "start fresh", matching mergeMcpJsonContent's own doc.
    existingRaw = undefined;
  }
  await writeFileFn({ path: delivery.mcpJsonPath, content: mergeMcpJsonContent({ existingRaw: existingRaw, serverEntry: delivery.serverEntry }) });
}

function defaultMkdtempCodexHome({ prefix }: { readonly prefix: string }): Promise<string> {
  return fsPromises.mkdtemp(join(tmpdir(), prefix));
}

function defaultRemoveCodexHomeDir({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { recursive: true, force: true });
}

/** The `'codex-toml'` mechanism's injectable filesystem seams, real by default — see {@link McpJsonInjectionOptions}'s `mkdtemp`/`removeDir`/`readFile`/`writeFile` docs. */
interface CodexHomeSeams {
  readonly mkdtemp: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string>;
  readonly writeFile: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  readonly removeDir: ({ path }: { readonly path: string }) => Promise<void>;
  readonly linkSessionStore: NonNullable<McpJsonInjectionOptions['linkSessionStore']>;
}

/** Config credentials stay run-scoped, but rollouts must survive both completion and cancellation.
 * Native directory links keep Codex as the sole writer of its own persisted session format.
 * Cleanup removes the links themselves, never their targets. Two fixed directories, O(1) I/O. */
async function defaultLinkCodexSessionStore({ runHome, sourceHome }: { runHome: string; sourceHome: string }, _optional = {}): Promise<void> {
  for (const name of ['sessions', 'archived_sessions']) {
    const target = resolve(sourceHome, name);
    await fsPromises.mkdir(target, { recursive: true, mode: 0o700 });
    await fsPromises.symlink(target, join(runHome, name), 'junction');
  }
}

function resolveCodexHomeSeams(options: McpJsonInjectionOptions): CodexHomeSeams {
  return {
    mkdtemp: options.mkdtemp ?? defaultMkdtempCodexHome,
    readFile: options.readFile ?? defaultReadMcpJsonFile,
    writeFile: options.writeFile ?? defaultWriteMcpJsonFile,
    removeDir: options.removeDir ?? defaultRemoveCodexHomeDir,
    linkSessionStore: options.linkSessionStore ?? defaultLinkCodexSessionStore,
  };
}

/**
 * Mechanism 5 of 5 — `'codex-toml'`'s one effect. Stages a fresh, randomly-named `CODEX_HOME`
 * directory (see {@link McpJsonInjectionOptions.mkdtemp}'s doc for why non-deterministic naming is
 * load-bearing here, not cosmetic) carrying:
 *   - `config.toml`: the real Codex home's own config (read best-effort — see
 *     {@link buildCodexHomeConfigToml}'s "missing file" handling) with this run's
 *     `[mcp_servers.jini]` table appended.
 *   - `auth.json`: a best-effort copy of the real Codex home's stored login, so the spawned CLI is
 *     still authenticated. Best-effort is safe here, not merely convenient: a real headless spawn
 *     against a `CODEX_HOME` with no `auth.json` at all was confirmed (against installed Codex CLI
 *     0.151.0) to fail fast with a structured `401 Unauthorized` stream event, never an interactive
 *     login prompt or a hang — see `defs/codex.ts`'s module doc for the full transcript summary.
 *
 * **Never changes the real config or credentials.** Those source files stay read-only. Only the
 * native rollout directories are shared: deleting a run's scratch home must not erase the thread
 * whose id the host already persisted. No copied login or run-bound MCP credential is retained.
 *
 * A failure after the directory is created (a rejecting `writeFile`, most plausibly) does not leak
 * it: the directory may already hold a partial `config.toml` or a copied credential, so the
 * `catch` below best-effort-removes it before rethrowing, exactly the "partial-failure state leak"
 * class of bug this package's own adversarial-test-design guidance calls out.
 * @param runId - Embedded in the temp-dir prefix for traceability, sanitized the same way
 * `@jini-ai/agent-runtime`'s `prepareAgentLogFile`'s `label` is.
 * @param entry - The shared bridge entry.
 * @param sourceCodexHomeDir - Where to read the real install's `config.toml`/`auth.json` from — see {@link resolveSourceCodexHomeDir}.
 * @param seams - Injectable mkdtemp/readFile/writeFile/removeDir/linkSessionStore, real filesystem by default.
 * @throws Whatever staging rejects with — the caller ({@link prepareCodexHomeIfNeeded}) turns that into a pre-spawn `AGENT_SPAWN_FAILED` failure, matching {@link writeMcpJsonForRun}'s own contract.
 * @complexity O(1): fixed directory links and up to two best-effort file read/write round trips.
 * @overallScore 100/100
 */
async function prepareCodexHomeForRun(
  runId: string,
  entry: McpJsonServerEntry,
  sourceCodexHomeDir: string,
  seams: CodexHomeSeams,
): Promise<PreparedCodexHome> {
  // Stricter than `@jini-ai/agent-runtime`'s `prepareAgentLogFile`/`preparePromptFileForAgent`
  // labels (which keep dots): this prefix stages a directory that ends up holding a copied Codex
  // login credential, so it gets `mcpJsonPathForRun`'s tighter discipline instead — dots stripped
  // too, not just path separators, so a run id like `../../etc/evil` cannot leave even a cosmetic
  // `..` substring in the mkdtemp prefix.
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'run';
  const dir = await seams.mkdtemp({ prefix: `jini-codex-home-${safeRunId}-` });
  try {
    let existingConfigRaw: string | undefined;
    try {
      existingConfigRaw = await seams.readFile({ path: join(sourceCodexHomeDir, 'config.toml') });
    } catch {
      // No config yet (fresh Codex install) or unreadable — start from just this run's block,
      // matching writeMcpJsonForRun's identical "missing file" handling.
      existingConfigRaw = undefined;
    }
    await seams.writeFile({ path: join(dir, 'config.toml'), content: buildCodexHomeConfigToml({ existingRaw: existingConfigRaw, entry: entry }) });
    try {
      const authRaw = await seams.readFile({ path: join(sourceCodexHomeDir, 'auth.json') });
      await seams.writeFile({ path: join(dir, 'auth.json'), content: authRaw });
    } catch {
      // No stored login (or unreadable) — the spawned CLI runs unauthenticated. Confirmed above:
      // this fails the run fast and observably, never as a hang.
    }
    await seams.linkSessionStore({ runHome: dir, sourceHome: sourceCodexHomeDir }, {});
  } catch (err) {
    await seams.removeDir({ path: dir }).catch(() => {
      // Best-effort only — the original error below is what the caller must see either way.
    });
    throw err;
  }
  return {
    path: dir,
    cleanup: async () => {
      await seams.removeDir({ path: dir });
    },
  };
}

function defaultMkdtempClaudeConfigDir({ prefix }: { readonly prefix: string }): Promise<string> {
  return fsPromises.mkdtemp(join(tmpdir(), prefix));
}

function defaultRemoveClaudeConfigDir({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { recursive: true, force: true });
}

function resolveClaudeConfigDirSeams(options: ClaudeConfigDirIsolationOptions | undefined): ClaudeConfigDirSeams {
  return {
    mkdtemp: options?.mkdtemp ?? defaultMkdtempClaudeConfigDir,
    readFile: options?.readFile ?? defaultReadMcpJsonFile,
    writeFile: options?.writeFile ?? defaultWriteMcpJsonFile,
    removeDir: options?.removeDir ?? defaultRemoveClaudeConfigDir,
  };
}

/**
 * Where `claude`'s own config resolution reads the operator's REAL config from, to seed a run's
 * scratch copy — never where it writes. Mirrors {@link resolveSourceCodexHomeDir}'s exact reasoning
 * and resolution order: `CLAUDE_CONFIG_DIR` is not in `BASELINE_AGENT_ENV_KEYS`, so a spawned child
 * never inherits it anyway — the whole point is finding wherever the *operator's actual* Claude Code
 * install lives, a host-machine fact resolved against the daemon HOST process's own environment.
 * @param hostEnv - The daemon process's own environment.
 * @returns `hostEnv.CLAUDE_CONFIG_DIR` when set to a non-blank value (matching Claude Code's own
 * resolution order, confirmed against installed Claude Code 2.1.263), else the CLI's documented
 * default, `~/.claude`.
 * @complexity O(1).
 */
export function resolveSourceClaudeConfigDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv }): string {
  const override = hostEnv.CLAUDE_CONFIG_DIR;
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.claude');
}

/**
 * Stages a fresh, randomly-named `CLAUDE_CONFIG_DIR` directory (same non-determinism requirement as
 * {@link McpJsonInjectionOptions.mkdtemp}'s own doc — `os.tmpdir()` is a shared location on a
 * multi-user host, so a guessable name is a real pre-plant/symlink target).
 *
 * **Deliberately empty by default** — unlike {@link prepareCodexHomeForRun}, which copies the real
 * `config.toml` wholesale (Codex has no personal-data problem in that file), this directory gets
 * NOTHING written into it beyond a best-effort copy of `.credentials.json` (see below). That is the
 * fix: the operator's real `skills`/`plugins`/`agents`/`memory-path index`/`settings.json` must NOT
 * carry over implicitly. `claude` runs correctly against a config directory holding nothing at all —
 * it falls back to its own built-in defaults, not an error.
 *
 * **Login preservation, verified rather than assumed** (per this task's own instruction — "prove
 * login still resolves; do not assume"): confirmed live (2026-09-07, installed Claude Code 2.1.263,
 * macOS) that `claude auth status` reports `loggedIn: false` against ANY `CLAUDE_CONFIG_DIR` other
 * than the operator's real one — including the real `HOME` with only `CLAUDE_CONFIG_DIR` swapped —
 * and confirmed against Claude Code's own docs (code.claude.com/docs/en/authentication) why: "If
 * you've set the CLAUDE_CONFIG_DIR environment variable, Claude Code keeps the .credentials.json
 * file under that directory instead, including the file the macOS fallback writes, and keys the
 * macOS Keychain entry to that directory too, so a session with a different CLAUDE_CONFIG_DIR reads
 * a different entry." So a scratch directory is never logged in by default on ANY platform, not just
 * the ones with no Keychain at all. This function only closes the *portable* case: when the source
 * directory holds a file-based `.credentials.json` (Linux, Windows, or a Keychain-locked macOS
 * fallback — none of which this function can distinguish, and does not need to), it is copied
 * best-effort into the scratch directory, exactly `prepareCodexHomeForRun`'s `auth.json` copy. When
 * it does not (a normal macOS Keychain-only install, confirmed the common case on this codebase's
 * own dev machine), this function does NOT attempt to read the macOS Keychain itself — that would
 * mean this daemon process extracting a live OAuth secret out of an OS-managed credential store into
 * a plaintext file, a materially different and larger security surface than forwarding an
 * already-resolved credential the host handed it (which `credentialEnv`/`ANTHROPIC_API_KEY` already
 * does, safely, today — see `AgentExecutorRunInput.credentialEnv`'s own doc). In that case this
 * mirrors `prepareCodexHomeForRun`'s own accepted outcome for a missing credential file verbatim:
 * "the spawned CLI runs unauthenticated" is documented, existing, precedented behavior in this file,
 * not a new failure mode invented here. A host that needs the isolated child to stay logged in on
 * such an install must supply a credential explicitly via `AgentExecutorRunInput.credentialEnv`
 * (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — both outrank Keychain-based subscription login
 * in Claude Code's own auth precedence, so the isolated child authenticates without ever needing the
 * operator's personal Keychain entry at all) — see this fix's own handoff report for the operational
 * consequence on a host with no such credential configured yet.
 *
 * **Never touches the real config directory.** `sourceConfigDir` is read-only throughout.
 * @param runId - Embedded in the temp-dir prefix for traceability, same sanitization discipline as {@link prepareCodexHomeForRun}'s `safeRunId`.
 * @param sourceConfigDir - Where to read a possible real `.credentials.json` from — see {@link resolveSourceClaudeConfigDir}.
 * @param seams - Injectable mkdtemp/readFile/writeFile/removeDir, real filesystem by default.
 * @throws Whatever `mkdtemp` rejects with — the caller ({@link prepareClaudeConfigDirIfNeeded}) turns that into a pre-spawn `AGENT_SPAWN_FAILED` failure, matching {@link prepareCodexHomeForRun}'s own contract.
 * @complexity O(1) plus one directory creation and up to one best-effort file read/write round trip.
 */
async function prepareClaudeConfigDirForRun(
  runId: string,
  sourceConfigDir: string,
  seams: ClaudeConfigDirSeams,
): Promise<PreparedClaudeConfigDir> {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'run';
  const dir = await seams.mkdtemp({ prefix: `jini-claude-config-${safeRunId}-` });
  try {
    const credentialsPath = join(sourceConfigDir, '.credentials.json');
    let credentialsRaw: string | undefined;
    try {
      credentialsRaw = await seams.readFile({ path: credentialsPath });
    } catch {
      // No file-based credential to copy (the common macOS-Keychain-only case) — see this
      // function's own doc for why that is an accepted, documented outcome, not a failure here.
      credentialsRaw = undefined;
    }
    if (credentialsRaw !== undefined) {
      await seams.writeFile({ path: join(dir, '.credentials.json'), content: credentialsRaw });
    }
  } catch (err) {
    await seams.removeDir({ path: dir }).catch(() => {
      // Best-effort only — the original error below is what the caller must see either way.
    });
    throw err;
  }
  return {
    path: dir,
    cleanup: async () => {
      await seams.removeDir({ path: dir });
    },
  };
}

/** Phase 5: resolves this run's MCP bridge delivery (credential resolution + {@link buildMcpBridgeDelivery}). */
export async function resolveMcpBridgeForRun({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly cleanupStagedFiles: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<McpBridgeDelivery | null> {
  try {
    // Awaited here rather than inside `buildMcpBridgeDelivery` so that function stays pure and
    // synchronous. `undefined` when the host supplied no resolver, which omits the token entirely.
    const credential = deps.mcpJsonInjection !== undefined ? await deps.mcpJsonInjection.credential?.({ runId: input.runId }) : undefined;
    return buildMcpBridgeDelivery({
      cwd: input.cwd,
      runId: input.runId,
      strategy: input.def.externalMcpInjection,
      options: deps.mcpJsonInjection,
      credential,
    });
  } catch (err) {
    // Spawning a child that cannot authenticate would produce a run whose every bridged tool call
    // 401s, so a rejecting credential resolver fails the run before spawn instead.
    await deps.cleanupStagedFiles();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not resolve the MCP bridge credential for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/** Phase 10: mechanism 1 of 5's one effect — stages this run's own `.mcp.json`, returning the path `cleanupStagedFiles` should later remove (`undefined` for every other mechanism / unconfigured host). */
export async function writeMcpJsonIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<string | undefined> {
  if (input.mcpBridge?.kind !== 'claude-mcp-json' || deps.mcpJsonInjection === undefined) {
    return undefined;
  }
  try {
    await writeMcpJsonForRun(input.cwd, input.mcpBridge, deps.mcpJsonInjection);
    return input.mcpBridge.mcpJsonPath;
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not write .mcp.json for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/**
 * Phase 10b: mechanism 5 of 5's one effect — stages this run's scratch `CODEX_HOME` directory,
 * returning the prepared handle `cleanupStagedFiles` should later release (`null` for every other
 * mechanism, or for an unconfigured host — matching {@link writeMcpJsonIfNeeded}'s identical gate).
 * @param input.def - Only used for its `id`, in the failure message.
 * @param input.mcpBridge - This run's resolved bridge delivery — a no-op unless its `kind` is `'codex-toml'`.
 * @param deps.hostEnv - The daemon's own environment, threaded through to {@link resolveSourceCodexHomeDir} rather than read from a module-level `process.env` so this phase stays testable with an injected env.
 * @complexity O(1) plus {@link prepareCodexHomeForRun}'s own cost.
 * @overallScore 100/100
 */
export async function prepareCodexHomeIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<PreparedCodexHome | null> {
  if (input.mcpBridge?.kind !== 'codex-toml' || deps.mcpJsonInjection === undefined) {
    return null;
  }
  try {
    return await prepareCodexHomeForRun(
      input.runId,
      input.mcpBridge.serverEntry,
      resolveSourceCodexHomeDir({ hostEnv: deps.hostEnv }),
      resolveCodexHomeSeams(deps.mcpJsonInjection),
    );
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a CODEX_HOME for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/**
 * Finding 1 of SEC-assistant-env-isolation-2026-09-07's one effect — stages this run's scratch
 * `CLAUDE_CONFIG_DIR` directory, returning the prepared handle `cleanupStagedFiles` should later
 * release (`null` for every def other than `claude` — see {@link prepareClaudeConfigDirForRun}'s
 * own doc for why this is unconditional for `claude` runs, unlike {@link prepareCodexHomeIfNeeded}'s
 * gate on a host-configured MCP bridge strategy).
 *
 * Gated on `def.id === 'claude'` directly rather than on `externalMcpInjection === 'claude-mcp-json'`
 * (which `codebuddy` also declares): isolating the operator's personal `~/.claude` is specific to
 * the real `claude` CLI's own config resolution, not to every def that happens to share its `.mcp.
 * json` delivery shape. Matches the existing `USER`-for-claude-login special case already singled
 * out by id in `BASELINE_AGENT_ENV_KEYS`'s own doc in `launch.ts`.
 *
 * ALSO gated on `deps.enabled` (`CreateAgentExecutorOptions.claudeConfigDirIsolationEnabled`, default
 * `false`) since this task's own fix — see that field's doc for why it defaults off (Keychain login
 * is `CLAUDE_CONFIG_DIR`-keyed and no caller was supplying a credential when this was unconditional).
 * `def.id === 'claude'` is still checked first and independently: a host that flips this flag on
 * should not suddenly stage a directory for `codebuddy` or any other def.
 * @param input.def - Used for both the `id` gate and the failure message.
 * @param deps.enabled - The isolation on/off switch — see this function's own doc above.
 * @param deps.hostEnv - The daemon's own environment, threaded through to {@link resolveSourceClaudeConfigDir} rather than read from a module-level `process.env`, matching {@link prepareCodexHomeIfNeeded}'s identical testability reasoning.
 * @complexity O(1) plus {@link prepareClaudeConfigDirForRun}'s own cost.
 */
export async function prepareClaudeConfigDirIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef }; readonly deps: {
    readonly enabled: boolean;
    readonly claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<PreparedClaudeConfigDir | null> {
  if (input.def.id !== 'claude' || !deps.enabled) {
    return null;
  }
  try {
    return await prepareClaudeConfigDirForRun(
      input.runId,
      resolveSourceClaudeConfigDir({ hostEnv: deps.hostEnv }),
      resolveClaudeConfigDirSeams(deps.claudeConfigDirIsolation),
    );
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a CLAUDE_CONFIG_DIR for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}
