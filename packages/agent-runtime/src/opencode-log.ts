/**
 * @module opencode-log
 *
 * OpenCode swallows provider failures in headless `run --format json` mode:
 * on a 429 usage-limit (and similar), it marks the error retryable, retries
 * silently, and emits NOTHING on stdout/stderr — so the caller only sees an
 * inactivity-watchdog timeout with no reason. The real error is recorded
 * only in OpenCode's own session log (`service=llm … error={…}`). This
 * module recovers that signal so a chat UI can show "usage limit reached"
 * instead of a bare timeout. OpenCode-specific by design.

 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { classifyAgentServiceFailure, type AgentServiceFailureCode } from './auth.js';

export interface OpenCodeServiceFailure {
  code: AgentServiceFailureCode;
  message: string;
  statusCode: number | null;
}

// OpenCode resolves its data dir as `$XDG_DATA_HOME/opencode` (when set) or
// `$HOME/.local/share/opencode`, with session logs under `log/`. Mirror that
// so we read the same files the spawned CLI wrote. Null when neither var is
// set (we have no basis to guess a path).
export function resolveOpenCodeLogDir({ env }: { env: Record<string, string | undefined> }): string | null {
  const xdg = typeof env.XDG_DATA_HOME === 'string' ? env.XDG_DATA_HOME.trim() : '';
  const home = typeof env.HOME === 'string' ? env.HOME.trim() : '';
  const base = xdg || (home ? path.join(home, '.local', 'share') : '');
  if (!base) return null;
  return path.join(base, 'opencode', 'log');
}

// Read the tail of OpenCode's most recent session log. Filenames are
// `<ISO-like-timestamp>.log`, so a lexicographic sort orders them by
// recency. `since` (when provided) binds the lookup to the current run: a
// file last written before the run started can only belong to an earlier
// session, so it is skipped rather than risk surfacing a stale provider
// error for this run. The 2 MB tail comfortably holds the final error frame
// even though OpenCode embeds the entire request body (system prompt + tool
// schemas) in each `service=llm` line. Synchronous on purpose: the only
// callers are a (non-async) run-close handler and an inactivity watchdog,
// once per failed OpenCode run. Returns null on any fs error (no dir yet,
// perms).
export function readLatestOpenCodeLogTail({ logDir }: { logDir: string }, options: { maxBytes?: number; since?: number } = {}
): string | null {
  const { maxBytes = 2_000_000, since } = options;
  const names = listLogNamesNewestFirst({ logDir });
  if (!names) return null;
  for (const name of names) {
    const full = path.join(logDir, name);
    if (since != null && predatesSince({ file: full, since })) continue;
    const tail = readFileTail({ file: full, maxBytes });
    if (tail !== null) return tail;
  }
  return null;
}

// `.log` names in the dir, newest filename first; null when the dir is
// unreadable or holds no logs.
function listLogNamesNewestFirst({ logDir }: { logDir: string }): string[] | null {
  let names: string[];
  try {
    names = readdirSync(logDir).filter((name) => name.endsWith('.log'));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  return names.sort().reverse(); // newest filename first
}

// True when the file was last written before `since` (an earlier session's
// log), or cannot be stat'ed — either way it is skipped.
function predatesSince({ file, since }: { file: string; since: number }): boolean {
  try {
    return statSync(file).mtimeMs < since;
  } catch {
    return true;
  }
}

// The last `maxBytes` of the file, or null when it cannot be read.
function readFileTail({ file, maxBytes }: { file: string; maxBytes: number }): string | null {
  try {
    const buf = readFileSync(file, 'utf8');
    return buf.length > maxBytes ? buf.slice(-maxBytes) : buf;
  } catch {
    return null;
  }
}

// Only treat a `"message":"…"` value as the failure reason when it reads
// like a service error. The embedded request body uses `"content":` for
// prompt text, but tool schemas and user prompts could still contain a
// stray `"message"` key, so this keyword gate keeps unrelated payload text
// from masquerading as the error.
// Split by theme only to keep each pattern readable; any one matching is enough.
const SERVICE_ERROR_MESSAGE_PATTERNS: readonly RegExp[] = [
  /usage limit|rate[ _-]?limit|quota|limit reached|exhaust|too many requests/i,
  /insufficient|credit|balance|overloaded|unavailable/i,
  /unauthor|authenticat|invalid[ _-]?(?:api[ _-]?)?key|api key|\/login/i,
];

function pickServiceErrorMessage(line: string): string | null {
  const re = /"message":"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    let value: string;
    try {
      value = JSON.parse(`"${match[1]}"`);
    } catch {
      value = match[1]!;
    }
    value = value.trim();
    // Conservative by design (SEC-002 / CR-R2): a non-matching "message" value is never
    // returned, even as a fallback. This line can embed the entire request body (system
    // prompt + tool schemas — see the module doc), so a "first message seen" fallback would
    // let unrelated payload content masquerade as the service-failure reason, defeating the
    // anti-masquerade keyword gate this function exists to enforce. Independently recommended
    // as the safe default by three separate reviews (code review, security, and a prior model
    // session) — see ADS-memory/reports/{code-review,security}/*-backend-coverage-push-2026-07-20.md.
    if (SERVICE_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(value))) return value;
  }
  return null;
}

function codeFromStatus(statusCode: number): AgentServiceFailureCode | null {
  if (statusCode === 401 || statusCode === 403) return 'AGENT_AUTH_REQUIRED';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode >= 500 && statusCode <= 599) return 'UPSTREAM_UNAVAILABLE';
  return null;
}

function defaultMessageForCode(code: AgentServiceFailureCode): string {
  switch (code) {
    case 'AGENT_AUTH_REQUIRED':
      return 'OpenCode could not authenticate with the model provider.';
    case 'RATE_LIMITED':
      return 'OpenCode hit a provider usage or rate limit.';
    case 'UPSTREAM_UNAVAILABLE':
      return "OpenCode's model provider is temporarily unavailable.";
  }
}

// Classify the latest `service=llm` provider error in an OpenCode log tail.
// We scope to that single line so the huge request body of *other* lines
// can't leak in, key the classification on the unambiguous HTTP `statusCode`
// first, and fall back to keyword matching the extracted message only.
function findLatestLlmErrorLine({ lines }: { lines: readonly string[] }): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = lines[i]!;
    if (candidate.includes('service=llm') && /\bERROR\b/.test(candidate) && candidate.includes('error=')) {
      return candidate;
    }
  }
  return null;
}

export function extractOpenCodeServiceFailure({ logTail }: { logTail: string }): OpenCodeServiceFailure | null {
  if (!logTail || !logTail.trim()) return null;
  const line = findLatestLlmErrorLine({ lines: logTail.split(/\r?\n/) });
  if (!line) return null;

  const statusMatch = /"statusCode":\s*(\d{3})/.exec(line);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;
  const message = pickServiceErrorMessage(line);

  const statusDerived = statusCode != null ? codeFromStatus(statusCode) : null;
  const code = statusDerived ?? (message ? classifyAgentServiceFailure({ text: message }) : null);
  if (!code) return null;

  return { code, message: message || defaultMessageForCode(code), statusCode };
}

// Convenience for a run-close handler / inactivity watchdog: resolve the
// log dir from the spawned agent's env, read the newest log tail (bound to
// the current run via `since`), and classify it.
export function readOpenCodeServiceFailure({ env }: { env: Record<string, string | undefined> }, options: { since?: number } = {}
): OpenCodeServiceFailure | null {
  const logDir = resolveOpenCodeLogDir({ env: env });
  if (!logDir) return null;
  const tail = readLatestOpenCodeLogTail({ logDir: logDir }, options);
  if (!tail) return null;
  return extractOpenCodeServiceFailure({ logTail: tail });
}
