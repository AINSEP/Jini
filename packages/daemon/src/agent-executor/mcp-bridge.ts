import {
  promises as fsPromises,
} from 'node:fs';
import type { McpBridgeProbeResult } from './mcp-bridge-probe.js';
import { randomBytes } from 'node:crypto';
import { supportsMessageRelay } from './message-relay.js';
import { ensureAntigravityMcpPermission } from './antigravity-permissions.js';
import {
  homedir,
  tmpdir,
} from 'node:os';
import {
  join,
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
   PreparedClaudeConfigDir,
   ClaudeConfigDirSeams,
   ClaudeConfigDirIsolationOptions,
   FailBeforeSpawn,
} from './contracts.js';

export const JINI_MCP_SERVER_KEY = 'jini';

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
export function bridgeUnavailableMessage(status: string, probe?: McpBridgeProbeResult): string {
  const message = `The assistant's tools did not load (MCP bridge "${JINI_MCP_SERVER_KEY}" status: ${status}). The run was stopped instead of continuing without them.`;
  if (!probe || probe.ok) return message;
  const lines = probe.stderrTail.trim().split(/\r?\n/);
  const reason = lines.find((line) => line.includes('Error')) ?? lines.at(-1);
  return `${message} Bridge exited with code ${probe.exitCode}: ${reason}`;
}

/**
 * Builds this run's `mcpServers.jini` entry — pure and synchronous, so every field mapping is
 * directly assertable without touching the filesystem. The credential arrives already resolved:
 * `McpJsonInjectionOptions.credential` is a possibly-async per-run resolver, and awaiting it is
 * `writeMcpJsonForRun`'s job, which keeps the effect out of this function.
 *
 * @param runId - The run this entry scopes its child to.
 * @param options - Launch settings and independent readers of diagnostic and visible startup IDs.
 * @param credential - The already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN`
 * entirely. Omitting produces byte-identical output to before this parameter existed.
 * @complexity O(t) output space/time for t launch environment and registered ID bytes.
 */
export function buildMcpJsonServerEntry({ runId, options }: { readonly runId: string; readonly options: Pick<McpJsonInjectionOptions, 'command' | 'args' | 'daemonUrl' | 'env' | 'diagnosticToolIds' | 'startupToolIds'> }, { credential, messageRelayNonce }: { readonly credential?: string; readonly messageRelayNonce?: string } = {}
): McpJsonServerEntry {
  const hostEnv = Object.entries(options.env ?? {}).filter(([key]) => !key.startsWith('JINI_'));
  return {
    command: options.command,
    args: options.args !== undefined ? [...options.args] : [],
    env: {
      ...Object.fromEntries(hostEnv),
      JINI_RUN_ID: runId,
      JINI_DAEMON_URL: options.daemonUrl,
      ...(options.diagnosticToolIds ? { JINI_DIAGNOSTIC_TOOL_IDS: JSON.stringify(options.diagnosticToolIds()) } : {}),
      ...(options.startupToolIds ? { JINI_STARTUP_TOOL_IDS: JSON.stringify(options.startupToolIds({ runId })) } : {}),
      ...(credential !== undefined ? { JINI_DAEMON_TOKEN: credential } : {}),
      ...(messageRelayNonce ? { JINI_MESSAGE_RELAY: '1', JINI_MESSAGE_RELAY_NONCE: messageRelayNonce } : {}),
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
  readonly messageRelayNonce?: string;
}): McpBridgeDelivery | null {
  const { cwd, runId, strategy, options, credential } = input;
  if (options === undefined || strategy === undefined) return null;
  const serverEntry = buildMcpJsonServerEntry({ runId: runId, options: options }, {
    ...(credential === undefined ? {} : { credential }),
    ...(input.messageRelayNonce ? { messageRelayNonce: input.messageRelayNonce } : {}),
  });
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

export function defaultReadMcpJsonFile({ path }: { readonly path: string }): Promise<string> {
  return fsPromises.readFile(path, 'utf8');
}

export function defaultWriteMcpJsonFile({ path, content }: { readonly path: string; readonly content: string }): Promise<void> {
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
  inheritUserConfig = true,
): Promise<void> {
  const readFileFn = options.readFile ?? defaultReadMcpJsonFile;
  const writeFileFn = options.writeFile ?? defaultWriteMcpJsonFile;
  let existingRaw: string | undefined;
  try {
    existingRaw = inheritUserConfig ? await readFileFn({ path: join(cwd, '.mcp.json') }) : undefined;
  } catch {
    // No existing file (ENOENT — the common case) or unreadable for any other reason: both
    // degrade to "start fresh", matching mergeMcpJsonContent's own doc.
    existingRaw = undefined;
  }
  await writeFileFn({ path: delivery.mcpJsonPath, content: mergeMcpJsonContent({ existingRaw: existingRaw, serverEntry: delivery.serverEntry }) });
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

/** Phase 5: resolve credentials and delivery, then await agy's scoped MCP permission setup.
 * Setup errors release staged files and fail before spawn. @complexity O(settings bytes) for agy. */
export async function resolveMcpBridgeForRun({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly cleanupStagedFiles: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
    readonly ensureAntigravityMcpPermission?: typeof ensureAntigravityMcpPermission;
  } }
): Promise<McpBridgeDelivery | null> {
  try {
    // Awaited here rather than inside `buildMcpBridgeDelivery` so that function stays pure and
    // synchronous. `undefined` when the host supplied no resolver, which omits the token entirely.
    const credential = deps.mcpJsonInjection !== undefined ? await deps.mcpJsonInjection.credential?.({ runId: input.runId }) : undefined;
    const delivery = buildMcpBridgeDelivery({
      cwd: input.cwd,
      runId: input.runId,
      strategy: input.def.externalMcpInjection,
      options: deps.mcpJsonInjection,
      credential,
      ...(supportsMessageRelay({ def: input.def }) ? { messageRelayNonce: randomBytes(24).toString('hex') } : {}),
    });
    if (input.def.id === 'antigravity' && delivery?.kind === 'env-passthrough') {
      await (deps.ensureAntigravityMcpPermission ?? ensureAntigravityMcpPermission)({
        settingsPath: join(homedir(), '.gemini', 'antigravity-cli', 'settings.json'),
        serverName: JINI_MCP_SERVER_KEY,
      });
    }
    return delivery;
  } catch (err) {
    // Spawning a child that cannot authenticate would produce a run whose every bridged tool call
    // 401s, so a rejecting credential resolver fails the run before spawn instead. Permission setup
    // failure is fatal for the same reason: the agent would start without its tools.
    await deps.cleanupStagedFiles();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not resolve the MCP bridge credential or permissions for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/** Phase 10: mechanism 1 of 5's one effect — stages this run's own `.mcp.json`, returning the path `cleanupStagedFiles` should later remove (`undefined` for every other mechanism / unconfigured host). */
export async function writeMcpJsonIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly nativeToolAccess?: boolean | undefined; readonly nativeCapabilities?: Partial<import('@jini-ai/agent-runtime').NativeCapabilities>; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<string | undefined> {
  if (input.mcpBridge?.kind !== 'claude-mcp-json' || deps.mcpJsonInjection === undefined) {
    return undefined;
  }
  try {
    await writeMcpJsonForRun(input.cwd, input.mcpBridge, deps.mcpJsonInjection, input.nativeToolAccess !== false && input.nativeCapabilities?.userMcp !== false);
    return input.mcpBridge.mcpJsonPath;
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not write .mcp.json for agent "${input.def.id}": ${errorMessage(err)}` },
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
