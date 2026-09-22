/**
 * @module claude-code-models
 *
 * Credential-free live model discovery for the `claude` runtime def — the `claude` analogue of
 * `codex debug models`.
 *
 * **Why this exists.** `claude` has no list-models subcommand, so without an `ANTHROPIC_API_KEY` the
 * picker used to render `defs/claude.ts`'s hand-written `CLAUDE_FALLBACK_MODELS` and nothing else. A
 * subscription-only install therefore never saw a new model (e.g. `claude-opus-5-5`) until someone
 * edited that array and republished.
 *
 * **The two sources, both needing no API key** (verified live against Claude Code 2.1.280):
 *
 *   1. The CLI's own `/model` picker list, via the stream-json control protocol. Writing ONE
 *      `{"type":"control_request","request":{"subtype":"initialize"}}` line to
 *      `claude -p --input-format stream-json --output-format stream-json --verbose` and closing stdin
 *      makes the CLI answer with a `control_response` whose `response.models` is exactly the rows its
 *      interactive `/model` picker renders — the binary's built-in models PLUS the server-fetched
 *      "additional" options — then exit 0. No user message is ever sent, so no model call is made
 *      and nothing is billed; it authenticates with whatever the CLI itself uses (subscription OAuth
 *      included). This is the same `initialize` handshake the Claude Agent SDK's `supportedModels()`
 *      rides on.
 *   2. `~/.claude.json`'s `additionalModelOptionsCache` — the server-fetched "additional" picker rows
 *      Claude Code persists on every session start's bootstrap fetch (headless `-p` runs included;
 *      it only rewrites the file when the payload changed). Only the server's extras, NOT the
 *      built-in rows, so it is strictly weaker than (1); it is read only when (1) yields nothing — an
 *      older CLI without the control protocol, a fork bin (`openclaude`), a timeout.
 *
 * **Enrichment, never a gate.** Every failure resolves to `null` ("nothing to add"), and a non-null
 * result is always `mergeLiveModels(fallback, live)` — the static list is fully present, in order.
 *
 * The cache-file parser ({@link parseClaudeCodePickerCache}) is shared with
 * `scripts/check-model-fallback-freshness.ts` so the freshness guard and the runtime can never
 * disagree about what that cache says.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

import { createCommandInvocation } from '@jini-ai/platform';

import { mergeLiveModels } from './anthropic-live-models.js';
import { sanitizeCustomModel } from './models.js';
import type { RuntimeEnv, RuntimeModelOption } from './types.js';

/** A spawn costs ~2.5s and the picker list only moves when Claude Code updates or the server's
 *  "additional" options change, so one answer is trusted for this long per process. Failures are
 *  cached for the same window so a broken CLI is not re-spawned on every detection pass. */
const CLAUDE_CODE_MODEL_CACHE_TTL_MS = 30 * 60_000;

/** Measured ~2.5s on a warm machine (the CLI performs its bootstrap fetch before answering). */
const CLAUDE_CODE_INIT_TIMEOUT_MS = 8_000;

/** The single stdin line that asks the CLI for its initialize payload (which carries `models`). */
export const CLAUDE_CODE_INITIALIZE_REQUEST =
  '{"type":"control_request","request_id":"jini-model-probe","request":{"subtype":"initialize"}}\n';

/**
 * argv for the initialize probe.
 *
 * `--no-session-persistence`: no transcript is written. `--strict-mcp-config` with no `--mcp-config`:
 * none of the operator's MCP servers are started. `disableAllHooks`: the operator's SessionStart
 * hooks do not fire for a metadata probe (verified: without it, two user hooks ran). User settings
 * are otherwise kept, because they can change what the picker offers (e.g. `availableModels`).
 */
export const CLAUDE_CODE_INITIALIZE_ARGS: readonly string[] = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--settings', '{"disableAllHooks":true}',
];

/** Strips the bracketed context-window variant marker (`claude-fable-5-1[1m]`) —
 *  `models.ts#sanitizeCustomModel` rejects brackets, and `--model` accepts the bare name. */
export function normalizeClaudePickerModelId(raw: string): string {
  return raw.replace(/\[[^\]]*\]$/, '').trim();
}

/** Outcome of parsing `~/.claude.json`. The failure reasons are distinct so the freshness guard can
 *  say WHY it skipped; the runtime treats every failure as "nothing to add". */
export type ClaudeCodePickerCacheParse =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly reason: 'invalid-json' | 'no-cache' | 'no-usable-values' };

/**
 * Parses the raw text of `~/.claude.json` down to the model ids in `additionalModelOptionsCache`.
 *
 * @returns Normalized ids (bracket suffix stripped), or a typed reason. Never throws.
 * @complexity O(n) over the cache entries (plus the JSON parse of the whole file).
 */
export function parseClaudeCodePickerCache(raw: string): ClaudeCodePickerCacheParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const cached = parsed && typeof parsed === 'object'
    ? (parsed as { additionalModelOptionsCache?: unknown }).additionalModelOptionsCache
    : undefined;
  if (!Array.isArray(cached) || cached.length === 0) return { ok: false, reason: 'no-cache' };
  const ids = cached
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { value?: unknown }).value : null))
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeClaudePickerModelId)
    .filter((id) => id.length > 0);
  return ids.length > 0 ? { ok: true, ids } : { ok: false, reason: 'no-usable-values' };
}

/** One `response.models` entry of the initialize payload, as far as this module reads it. */
type InitializeModelEntry = { value?: unknown; resolvedModel?: unknown; displayName?: unknown };

/** Pulls `response.response.models` out of the one `control_response` line, or `null`. */
function findInitializeModels(stdout: string): unknown[] | null {
  for (const line of stdout.split('\n')) {
    if (!line.includes('control_response')) continue;
    try {
      const msg = JSON.parse(line) as { type?: unknown; response?: { subtype?: unknown; response?: { models?: unknown } } };
      if (msg.type !== 'control_response' || msg.response?.subtype !== 'success') continue;
      const models = msg.response.response?.models;
      if (Array.isArray(models)) return models;
    } catch {
      // Not a JSON line (or a truncated one on timeout) — keep scanning.
    }
  }
  return null;
}

/** The picker rows one initialize entry contributes: its selection value (an alias like `sonnet`,
 *  or a full id) and the concrete model it resolves to. `default` is the sentinel the fallback list
 *  already carries; anything `sanitizeCustomModel` would refuse is dropped rather than rendered. */
function initializeEntryRows(entry: InitializeModelEntry): RuntimeModelOption[] {
  const rows: RuntimeModelOption[] = [];
  const displayName = typeof entry.displayName === 'string' ? entry.displayName : '';
  for (const raw of [entry.value, entry.resolvedModel]) {
    if (typeof raw !== 'string') continue;
    const id = normalizeClaudePickerModelId(raw);
    if (id === 'default' || sanitizeCustomModel(id) !== id) continue;
    const isAlias = !id.startsWith('claude-');
    rows.push({ id, label: isAlias && displayName ? `${displayName} (alias)` : id });
  }
  return rows;
}

/**
 * Parses the CLI's stream-json stdout for the initialize `control_response` and returns its model
 * rows (aliases and concrete ids, bracket suffixes stripped, deduped, `default` excluded).
 *
 * @returns The rows, or `null` when no well-formed response with at least one usable model exists.
 * @complexity O(s + n) over the stdout length and the n models listed.
 */
export function parseClaudeInitializeModels(stdout: string): RuntimeModelOption[] | null {
  const models = findInitializeModels(String(stdout || ''));
  if (!models) return null;
  const seen = new Set<string>();
  const out: RuntimeModelOption[] = [];
  for (const raw of models) {
    if (!raw || typeof raw !== 'object') continue;
    for (const row of initializeEntryRows(raw as InitializeModelEntry)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out.length > 0 ? out : null;
}

/** Where Claude Code keeps `.claude.json` for this env: `$CLAUDE_CONFIG_DIR` when set, else HOME. */
export function resolveClaudeConfigPath(env: RuntimeEnv): string {
  const configDir = typeof env.CLAUDE_CONFIG_DIR === 'string' ? env.CLAUDE_CONFIG_DIR.trim() : '';
  if (configDir) return join(configDir, '.claude.json');
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : os.homedir();
  return join(home, '.claude.json');
}

/** The two I/O edges, injectable so tests never spawn a real CLI or read the real home dir. */
export interface ClaudeCodeModelIo {
  /** Runs the initialize probe; resolves to whatever stdout was captured, or `null`. Never rejects. */
  runInitialize(bin: string, env: RuntimeEnv): Promise<string | null>;
  /** Reads a file as UTF-8, or `null` when missing/unreadable. Never rejects. */
  readConfigFile(path: string): Promise<string | null>;
}

function runInitializeProbe(bin: string, env: RuntimeEnv): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const invocation = createCommandInvocation({ command: bin, args: [...CLAUDE_CODE_INITIALIZE_ARGS], env });
      const child = execFile(
        invocation.command,
        invocation.args,
        {
          env: env as NodeJS.ProcessEnv,
          // Neutral cwd, same reason as `invocation.ts#execAgentFile`: a metadata probe must never
          // pick up (or write into) a project directory.
          cwd: os.tmpdir(),
          timeout: CLAUDE_CODE_INIT_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        },
        // A timeout or non-zero exit still hands back what was captured; the parser decides.
        (_err, stdout) => resolve(typeof stdout === 'string' ? stdout : String(stdout ?? '')),
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(CLAUDE_CODE_INITIALIZE_REQUEST);
    } catch {
      resolve(null);
    }
  });
}

const defaultIo: ClaudeCodeModelIo = {
  runInitialize: runInitializeProbe,
  readConfigFile: (path) => readFile(path, 'utf8').catch(() => null),
};

let activeIo: ClaudeCodeModelIo = defaultIo;

type CacheEntry = { expiresAt: number; value: Promise<readonly RuntimeModelOption[] | null> };
const cache = new Map<string, CacheEntry>();

/** Test-only: install fake I/O (or `null` to restore the real one) and clear the process cache. */
export function setClaudeCodeModelIoForTesting(io: ClaudeCodeModelIo | null): void {
  activeIo = io ?? defaultIo;
  cache.clear();
}

/** One cache slot per binary + config location + auth-affecting env, fingerprinted so no secret is
 *  retained as a `Map` key. Two accounts on one host must not share a picker list. */
function cacheKeyFor(bin: string, env: RuntimeEnv): string {
  const auth = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']
    .map((name) => (typeof env[name] === 'string' ? env[name] : ''))
    .join('\u0000');
  const fingerprint = createHash('sha256').update(auth).digest('hex').slice(0, 16);
  return `${bin}\u0000${resolveClaudeConfigPath(env)}\u0000${fingerprint}`;
}

/** Source (1), then source (2). Never rejects. */
async function discoverClaudeCodeModels(bin: string, env: RuntimeEnv): Promise<readonly RuntimeModelOption[] | null> {
  try {
    const stdout = await activeIo.runInitialize(bin, env);
    const fromCli = stdout ? parseClaudeInitializeModels(stdout) : null;
    if (fromCli) return fromCli;
    const raw = await activeIo.readConfigFile(resolveClaudeConfigPath(env));
    const cached = raw === null ? null : parseClaudeCodePickerCache(raw);
    if (!cached?.ok) return null;
    return cached.ids
      .filter((id) => sanitizeCustomModel(id) === id)
      .map((id) => ({ id, label: id }));
  } catch {
    return null;
  }
}

/**
 * Returns the `claude` model list with the CLI's own picker catalog merged in, or `null` when there
 * is nothing to merge. Needs no API key.
 *
 * @param bin - The resolved `claude` (or fork) binary detection found.
 * @param env - The composed environment for the agent — what a spawn would actually see.
 * @param fallbackModels - The def's static list; always fully present, in order, in a non-null result.
 * @param now - Injectable clock for TTL tests.
 * @complexity O(f + l) plus, at most once per {@link CLAUDE_CODE_MODEL_CACHE_TTL_MS} per cache key,
 * one CLI spawn bounded by {@link CLAUDE_CODE_INIT_TIMEOUT_MS} and one file read.
 */
export async function loadClaudeCodeModels(
  bin: string,
  env: RuntimeEnv,
  fallbackModels: readonly RuntimeModelOption[],
  now: () => number = Date.now,
): Promise<RuntimeModelOption[] | null> {
  const key = cacheKeyFor(bin, env);
  const cached = cache.get(key);
  const pending = cached && cached.expiresAt > now() ? cached.value : null;
  const value = pending ?? discoverClaudeCodeModels(bin, env);
  if (!pending) cache.set(key, { expiresAt: now() + CLAUDE_CODE_MODEL_CACHE_TTL_MS, value });
  const live = await value;
  return live && live.length > 0 ? mergeLiveModels(fallbackModels, live) : null;
}
