/**
 * @module auth
 *
 * Agent auth/service-failure classification: probing whether an installed
 * agent CLI is authenticated, and text-based classification of a CLI's raw
 * error output into auth/rate-limit/upstream failure classes.
 *
 * Ported from OD's `apps/daemon/src/runtimes/auth.ts` with one
 * de-branding change: the five guidance-text functions
 * (`cursorAuthGuidance`, `deepseekAuthGuidance`, `antigravityAuthGuidance`,
 * `antigravityQuotaGuidance`, `reasonixAuthGuidance`, `claudeAuthGuidance`)
 * and `genericAuthGuidance` took an implicit product name baked into nine
 * literal strings (e.g. "expose CURSOR_API_KEY in the <product>'s process
 * environment" — see `source-map.md` for the exact original text). Each
 * now takes an optional `hostName`
 * parameter (default `'the host application'`) so the guidance text is
 * product-neutral by default and a consumer can substitute its own name.
 * `classifyAgentAuthFailure`/`probeAgentAuthStatus` thread `hostName`
 * through to whichever guidance function they call. See `source-map.md`.
 */
import { execAgentFile } from './invocation.js';
import type { RuntimeAgentDef, RuntimeEnv } from './types.js';

export type AgentAuthProbeResult = {
  status: 'ok' | 'missing' | 'unknown';
  message?: string;
  // Output captured from the probe child process. Exposed so callers like
  // a connection-test layer can fold the probe's own stderr/exit context
  // into their structured diagnostics — the probe runs before a smoke
  // spawn, so without this the diagnostics block would otherwise drop the
  // probe output entirely.
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number | null;
  signal?: string | null;
};

const DEFAULT_HOST_NAME = 'the host application';

function cursorAuthGuidanceText(hostName: string): string {
  return `Cursor Agent is not authenticated. Run \`cursor-agent login\`, then \`cursor-agent status\`, and retry. For automation, ensure CURSOR_API_KEY is set in ${hostName}'s process environment.`;
}

function deepseekAuthGuidanceText(hostName: string): string {
  return `DeepSeek TUI is installed but is not authenticated. Add or verify your API key in \`~/.deepseek/config.toml\` as \`api_key = "..."\`, or expose DEEPSEEK_API_KEY to ${hostName}'s daemon process, then retry. If ${hostName} is launched outside an interactive shell, shell rc files such as ~/.zshrc may not be loaded.`;
}

// agy's print mode (`-p`) detects a missing OAuth token, prints the
// Google sign-in URL to stdout, waits 30s for completion, then exits
// "Error: authentication timed out." That URL points at a callback page
// that asks the user to paste the resulting auth code BACK into agy —
// which only works in the interactive TUI. So surfacing the raw URL in a
// chat UI is a dead end (no input field to paste the code into). Instead
// we ask the user to run `agy` in a terminal once, which opens the
// browser, completes OAuth, and writes the credentials to the system
// keyring — both `-p` and TUI invocations read from there afterward, so
// the chat run can succeed on retry.
function antigravityAuthGuidanceText(hostName: string): string {
  return `Antigravity needs to sign in. The agy CLI's keyring entry has expired or been cleared, and \`-p\` print mode cannot complete OAuth on its own (it has no field to paste the auth code into).\n\nFix: open a terminal and run \`agy\` once — it will open Google sign-in in your browser, accept the redirect, and store the token in your system keyring. After you finish, return here and retry this chat. You only need to do this once; the keyring entry persists across both terminal and ${hostName} runs.`;
}

// agy's account-level quota is per-model (consumer accounts get a
// separate quota for Gemini 3 Pro vs Flash vs Claude vs GPT-OSS), and
// when exhausted the upstream returns
//   RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact
//   your administrator to enable overages. Resets in <H>h<M>m<S>s.
// to the `--log-file`. Print mode emits nothing on stdout/stderr, so
// without log inspection the failure misreads as missing-OAuth.
function antigravityQuotaGuidanceText(): string {
  return 'Antigravity returned "RESOURCE_EXHAUSTED: Individual quota reached" for the current model. Each Antigravity model (Gemini 3 Pro / Flash, Claude 4.6, GPT-OSS) has its own quota.\n\nFix: open `agy` in a terminal and use its Switch Model picker (the menu at the bottom of the TUI) to pick a model with available quota, then retry here. Quotas reset automatically on Antigravity\'s schedule.';
}

function reasonixAuthGuidanceText(hostName: string): string {
  return `DeepSeek Reasonix is installed but is not authenticated. Add your API key in \`~/.reasonix/config.json\` under \`apiKey\`, or expose DEEPSEEK_API_KEY to ${hostName}'s daemon process, then retry. If ${hostName} is launched outside an interactive shell, shell rc files such as ~/.zshrc may not be loaded.`;
}

function claudeAuthGuidanceText(hostName: string): string {
  return `Claude Code is installed but is not authenticated. Run \`claude auth login\` or open \`claude\` and complete login in a terminal, then rescan. If ${hostName} was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.`;
}

export function cursorAuthGuidance(hostName: string = DEFAULT_HOST_NAME): string {
  return cursorAuthGuidanceText(hostName);
}

export function deepseekAuthGuidance(hostName: string = DEFAULT_HOST_NAME): string {
  return deepseekAuthGuidanceText(hostName);
}

export function antigravityAuthGuidance(hostName: string = DEFAULT_HOST_NAME): string {
  return antigravityAuthGuidanceText(hostName);
}

export function antigravityQuotaGuidance(): string {
  return antigravityQuotaGuidanceText();
}

export function reasonixAuthGuidance(hostName: string = DEFAULT_HOST_NAME): string {
  return reasonixAuthGuidanceText(hostName);
}

export function claudeAuthGuidance(hostName: string = DEFAULT_HOST_NAME): string {
  return claudeAuthGuidanceText(hostName);
}

export function isCursorAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    /authentication required/i.test(value) ||
    /not authenticated/i.test(value) ||
    /not logged in/i.test(value) ||
    /unauthenticated/i.test(value) ||
    /agent login/i.test(value) ||
    /cursor_api_key/i.test(value)
  );
}

// agy's plain-mode output when no keyring credentials are available:
//   - Top of stdout: "Authentication required. Please visit the URL to log in: <URL>"
//   - Tail of stdout: "Waiting for authentication (timeout 30s)..."
//                      "Error: authentication timed out."
// The same TUI text is logged by `agy --log-file` as
//   "You are not logged into Antigravity" and
//   "error getting token source: You are not logged into Antigravity"
// Any of these is sufficient signal — match conservatively so the regex
// doesn't fire on prose containing the word "authentication" by accident.
export function isAntigravityAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    /authentication required.*please visit/i.test(value) ||
    /authentication timed out/i.test(value) ||
    /not logged into antigravity/i.test(value) ||
    /accounts\.google\.com\/o\/oauth2\/auth.*antigravity/i.test(value)
  );
}

export function isDeepSeekAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    /KEY=<your-key>/i.test(value) ||
    /api_key\s*=\s*["']<your-key>["']/i.test(value) ||
    (/~\/\.deepseek\/config\.toml/i.test(value) && /api[_ -]?key|KEY=/i.test(value)) ||
    (/DEEPSEEK_API_KEY/i.test(value) &&
      /auth|api[_ -]?key|missing|not set|required|unauthorized/i.test(value))
  );
}

export function isReasonixAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    (/~\/\.reasonix\/config\.json/i.test(value) &&
      /api[_ -]?key|missing|not set|required|unauthorized|invalid/i.test(value)) ||
    (/DEEPSEEK_API_KEY/i.test(value) &&
      /auth|missing|not set|required|unauthorized|invalid/i.test(value))
  );
}

export function isClaudeAuthFailureText(text: string): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  try {
    const parsed = JSON.parse(value) as { authenticated?: unknown; loggedIn?: unknown };
    if (parsed.authenticated === true || parsed.loggedIn === true) return false;
    if (parsed.authenticated === false || parsed.loggedIn === false) return true;
  } catch {
    // Fall through to text matching below.
  }
  if (/"authenticated"\s*:\s*true/i.test(value) || /"loggedIn"\s*:\s*true/i.test(value)) {
    return false;
  }
  return (
    /"authenticated"\s*:\s*false/i.test(value) ||
    /"loggedIn"\s*:\s*false/i.test(value) ||
    /not authenticated/i.test(value) ||
    /not logged[ _-]?in/i.test(value) ||
    /authentication required/i.test(value) ||
    /please (?:sign|log)[ _-]?in/i.test(value)
  );
}

export function classifyAgentAuthFailure(
  agentId: string,
  text: string,
  hostName: string = DEFAULT_HOST_NAME,
): AgentAuthProbeResult | null {
  if (agentId === 'claude') {
    if (!isClaudeAuthFailureText(text)) return null;
    return { status: 'missing', message: claudeAuthGuidance(hostName) };
  }
  if (agentId === 'cursor-agent') {
    if (!isCursorAuthFailureText(text)) return null;
    return { status: 'missing', message: cursorAuthGuidance(hostName) };
  }
  if (agentId === 'deepseek') {
    if (!isDeepSeekAuthFailureText(text)) return null;
    return { status: 'missing', message: deepseekAuthGuidance(hostName) };
  }
  if (agentId === 'antigravity') {
    if (!isAntigravityAuthFailureText(text)) return null;
    return { status: 'missing', message: antigravityAuthGuidance(hostName) };
  }
  if (agentId === 'reasonix') {
    if (!isReasonixAuthFailureText(text)) return null;
    return { status: 'missing', message: reasonixAuthGuidance(hostName) };
  }
  return null;
}

// Model-service failure classes that map a CLI agent's raw error text to a
// structured API error code. `classifyAgentAuthFailure` only covers the
// agents that ship a tailored sign-in hint; every other CLI agent used to
// collapse auth / quota / upstream failures into a generic execution
// failure. This agent-agnostic, text-based classifier recovers the
// specific class so the chat shows an accurate reason.
export type AgentServiceFailureCode = 'AGENT_AUTH_REQUIRED' | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE';

// A bare HTTP status number (`500`, `429`, …) is too noisy to trust on its own
// — agent stderr is full of unrelated numbers (`line 500`, `read 502 bytes`,
// `took 503ms`, `exit code 401`, `process exited with code 429`). Only treat a
// status number as a signal when it carries explicit HTTP-status context
// (`HTTP 500`, `status 429`, `status code 401`, `error code 502`,
// `server error 503`, or a punctuation-bound `code: 401`). Crucially `code`
// alone is NOT enough — that would still match process-exit lines like `exit
// code 401`; it only counts when qualified (status/error/response code) or
// immediately followed by `:`/`=`/`#`.
const STATUS_CTX =
  '(?:' +
  '\\bhttp(?:[ /]?\\d(?:\\.\\d)?)?\\b' + // HTTP, HTTP/1.1
  '|\\b(?:status|error|response)(?:[ _-]?code)?\\b' + // status / status code / error code / response code
  '|\\bcode(?=\\s*[:=#])' + // code: 401 / code=429  (NOT "exit code 401")
  '|\\b(?:server|http)[ _-]?error\\b' + // server error / http error
  ')[\\s:=#-]*';

// Authentication / authorization: a missing, invalid, or expired credential.
const AGENT_AUTH_FAILURE_RE = new RegExp(
  `(\\b(unauthor(?:ized|ised)|authenticat(?:e|ed|ion)|invalid[ _-]?(?:api[ _-]?)?key|incorrect api key|x-api-key|not (?:authenticated|logged[ _-]?in)|please (?:sign|log)[ _-]?in|oauth token (?:has )?expired|session expired|credentials? (?:are )?(?:missing|invalid|required))\\b|\\/login\\b|${STATUS_CTX}401\\b)`,
  'i',
);

// Quota / rate limit / billing balance — the wall a hosted gateway avoids.
const AGENT_RATE_FAILURE_RE = new RegExp(
  `(\\b(rate[ _-]?limit|too many requests|quota|insufficient[ _-]?(?:quota|balance|credit|funds)|credit balance is too low|exceeded your current quota|usage limit|session limit|limit reached|billing (?:hard )?limit)\\b|${STATUS_CTX}429\\b)`,
  'i',
);

// Upstream model/provider problems: overloaded, 5xx, temporarily unavailable.
const AGENT_UPSTREAM_FAILURE_RE = new RegExp(
  `(\\b(overloaded(?:_error)?|service (?:is )?(?:temporarily )?unavailable|bad gateway|gateway timeout|internal server error|upstream (?:error|unavailable)|provider (?:error|unavailable)|temporarily unavailable|model is currently overloaded|5xx)\\b|${STATUS_CTX}5\\d\\d\\b|\\b5\\d\\d\\s+(?:bad gateway|service unavailable|internal server error|gateway timeout))`,
  'i',
);

// Returns the model-service failure class implied by an agent's combined
// stdout/stderr/error text, or null when the text looks like an ordinary
// process failure. Auth is checked before rate/upstream so a `401` is never
// misread as a `5xx`. Pure text match — no agent-specific assumptions — so it
// applies uniformly to any CLI agent.
export function classifyAgentServiceFailure(text: string): AgentServiceFailureCode | null {
  const value = String(text || '');
  if (!value.trim()) return null;
  if (AGENT_AUTH_FAILURE_RE.test(value)) return 'AGENT_AUTH_REQUIRED';
  if (AGENT_RATE_FAILURE_RE.test(value)) return 'RATE_LIMITED';
  if (AGENT_UPSTREAM_FAILURE_RE.test(value)) return 'UPSTREAM_UNAVAILABLE';
  return null;
}

// Tail length matches a smoke-test sink so the diagnostics block stays
// compact when it folds probe output back into its overrides.
const PROBE_TAIL_BYTES = 400;

// Both real call sites (`withProbeTails`, immediately below) already hold a
// `string` — `probeAgentAuthStatus` normalizes `stdout`/`stderr` to `''` via
// `typeof stdout === 'string' ? stdout : ''` before either ever reaches here
// — so a `value: unknown` parameter plus a runtime `typeof` guard was dead
// code for every real caller. Narrowed to `string` to remove the
// unreachable branch instead of padding a test around it.
function tailString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > PROBE_TAIL_BYTES ? trimmed.slice(-PROBE_TAIL_BYTES) : trimmed;
}

function withProbeTails(base: AgentAuthProbeResult, stdoutText: string, stderrText: string): AgentAuthProbeResult {
  const result: AgentAuthProbeResult = { ...base };
  const stdoutTail = tailString(stdoutText);
  const stderrTail = tailString(stderrText);
  if (stdoutTail) result.stdoutTail = stdoutTail;
  if (stderrTail) result.stderrTail = stderrTail;
  return result;
}

// Default generic sign-in hint for adapters that declare an `authProbe` but
// ship no tailored guidance (cursor / deepseek / antigravity / reasonix each
// have their own via `classifyAgentAuthFailure`). Kept agent-agnostic so a
// newly-onboarded CLI gets an actionable banner the moment it opts into auth
// probing, without bespoke copy.
function genericAuthGuidance(agentName: string, hostName: string): string {
  return `${agentName} appears to be installed but is not authenticated. Sign in with the CLI in a terminal, then rescan. If ${hostName} was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.`;
}

// Agents that ship a bespoke auth-failure classifier + tailored sign-in hint
// via `classifyAgentAuthFailure`. For these, a null result is authoritative
// ("authenticated"); we must NOT second-guess it with the broad generic
// regex (e.g. cursor-agent's healthy `status` output mentions "login" in
// ways the generic matcher would misread). The generic classifier is only a
// fallback for adapters with no tailored classifier of their own.
const TAILORED_AUTH_AGENTS = new Set(['claude', 'cursor-agent', 'deepseek', 'antigravity', 'reasonix']);

function hasNonEmptyEnv(env: RuntimeEnv, keys: string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function hasProbeSatisfyingApiKey(def: Pick<RuntimeAgentDef, 'id'>, env: RuntimeEnv): boolean {
  if (def.id === 'codex') {
    return hasNonEmptyEnv(env, ['CODEX_API_KEY', 'OPENAI_API_KEY']);
  }
  if (def.id === 'claude') {
    return hasNonEmptyEnv(env, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  }
  return false;
}

// Classify an auth-probe's combined output into a missing-auth result, or
// null when the output does not look like an auth failure. Agents with a
// tailored classifier use only that (null === authenticated); every other
// adapter that opts into probing falls back to the generic, agent-agnostic
// HTTP/text classifier so it still gets a usable signal without bespoke
// regexes.
function classifyProbedAuthFailure(
  def: Pick<RuntimeAgentDef, 'id' | 'name'>,
  text: string,
  hostName: string,
): AgentAuthProbeResult | null {
  if (TAILORED_AUTH_AGENTS.has(def.id)) {
    return classifyAgentAuthFailure(def.id, text, hostName);
  }
  if (classifyAgentServiceFailure(text) === 'AGENT_AUTH_REQUIRED') {
    return { status: 'missing', message: genericAuthGuidance(def.name || def.id, hostName) };
  }
  return null;
}

// Run an adapter's declared authentication probe (a cheap, side-effect-free
// status/whoami command) and classify the result. Returns null when the
// adapter declares no `authProbe` — those agents are never actively probed;
// their auth status is inferred only from a real chat failure's error text.
export async function probeAgentAuthStatus(
  def: Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>,
  resolvedBin: string,
  env: RuntimeEnv,
  hostName: string = DEFAULT_HOST_NAME,
): Promise<AgentAuthProbeResult | null> {
  const probe = def.authProbe;
  if (!probe) return null;
  if (hasProbeSatisfyingApiKey(def, env)) return { status: 'ok' };
  try {
    const { stdout, stderr } = await execAgentFile(resolvedBin, probe.args, {
      env: env as NodeJS.ProcessEnv,
      timeout: probe.timeoutMs ?? 5000,
      maxBuffer: 1024 * 1024,
    });
    const stdoutText = typeof stdout === 'string' ? stdout : '';
    const stderrText = typeof stderr === 'string' ? stderr : '';
    const output = `${stdoutText}\n${stderrText}`;
    const failure = classifyProbedAuthFailure(def, output, hostName);
    if (failure) {
      return withProbeTails({ ...failure, exitCode: 0, signal: null }, stdoutText, stderrText);
    }
    return { status: 'ok' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: unknown;
      stderr?: unknown;
      code?: string | number;
      signal?: string;
    };
    const stdoutText = typeof err.stdout === 'string' ? err.stdout : '';
    const stderrText = typeof err.stderr === 'string' ? err.stderr : '';
    const output = [err.message, stdoutText, stderrText].join('\n');
    // util.promisify(execFile) attaches `code` and `signal` to the
    // rejection error. `code` may be a number (real non-zero exit) or a
    // Node ErrnoException string ("ENOENT"); only the numeric form is
    // meaningful as an exit code.
    const numericExit = typeof err.code === 'number' ? err.code : null;
    const childSignal = typeof err.signal === 'string' ? err.signal : null;
    const failure = classifyProbedAuthFailure(def, output, hostName);
    if (failure) {
      return withProbeTails({ ...failure, exitCode: numericExit, signal: childSignal }, stdoutText, stderrText);
    }
    return withProbeTails(
      {
        status: 'unknown',
        message: `${def.name || def.id} authentication status could not be verified with \`${def.id} ${probe.args.join(' ')}\`.`,
        exitCode: numericExit,
        signal: childSignal,
      },
      stdoutText,
      stderrText,
    );
  }
}
