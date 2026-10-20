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
 * environment" — see `archived provenance ledger` for the exact original text). Each
 * now takes an optional `hostName`
 * parameter (default `'the host application'`) so the guidance text is
 * product-neutral by default and a consumer can substitute its own name.
 * `classifyAgentAuthFailure`/`probeAgentAuthStatus` thread `hostName`
 * through to whichever guidance function they call. See `archived provenance ledger`.
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

export function cursorAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Cursor Agent is not authenticated. Run \`cursor-agent login\`, then \`cursor-agent status\`, and retry. For automation, ensure CURSOR_API_KEY is set in ${hostName}'s process environment.`;
}

export function deepseekAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
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
export function antigravityAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Antigravity needs to sign in. The agy CLI's keyring entry has expired or been cleared, and \`-p\` print mode cannot complete OAuth on its own (it has no field to paste the auth code into).\n\nFix: open a terminal and run \`agy\` once — it will open Google sign-in in your browser, accept the redirect, and store the token in your system keyring. After you finish, return here and retry this chat. You only need to do this once; the keyring entry persists across both terminal and ${hostName} runs.`;
}

// agy's account-level quota is per-model (consumer accounts get a
// separate quota for Gemini 3 Pro vs Flash vs Claude vs GPT-OSS), and
// when exhausted the upstream returns
//   RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact
//   your administrator to enable overages. Resets in <H>h<M>m<S>s.
// to the `--log-file`. Print mode emits nothing on stdout/stderr, so
// without log inspection the failure misreads as missing-OAuth.
export function antigravityQuotaGuidance(): string {
  return 'Antigravity returned "RESOURCE_EXHAUSTED: Individual quota reached" for the current model. Each Antigravity model (Gemini 3 Pro / Flash, Claude 4.6, GPT-OSS) has its own quota.\n\nFix: open `agy` in a terminal and use its Switch Model picker (the menu at the bottom of the TUI) to pick a model with available quota, then retry here. Quotas reset automatically on Antigravity\'s schedule.';
}

export function reasonixAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `DeepSeek Reasonix is installed but is not authenticated. Add your API key in \`~/.reasonix/config.json\` under \`apiKey\`, or expose DEEPSEEK_API_KEY to ${hostName}'s daemon process, then retry. If ${hostName} is launched outside an interactive shell, shell rc files such as ~/.zshrc may not be loaded.`;
}

export function claudeAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Claude Code is installed but is not authenticated. Run \`claude auth login\` or open \`claude\` and complete login in a terminal, then rescan. If ${hostName} was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.`;
}


export function isCursorAuthFailureText({ text }: { text: string }): boolean {
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
export function isAntigravityAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    /authentication required.*please visit/i.test(value) ||
    /authentication timed out/i.test(value) ||
    /not logged into antigravity/i.test(value) ||
    /accounts\.google\.com\/o\/oauth2\/auth.*antigravity/i.test(value)
  );
}

export function isDeepSeekAuthFailureText({ text }: { text: string }): boolean {
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

export function isReasonixAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    (/~\/\.reasonix\/config\.json/i.test(value) &&
      /api[_ -]?key|missing|not set|required|unauthorized|invalid/i.test(value)) ||
    (/DEEPSEEK_API_KEY/i.test(value) &&
      /auth|missing|not set|required|unauthorized|invalid/i.test(value))
  );
}

// Structured verdict from `claude auth status` JSON: a boolean when either key
// is a boolean (`true` wins), undefined when the text is not JSON or carries
// neither key. Property access on a JSON `null` throws inside the `try`, which
// deliberately lands in the same text-matching fallback as invalid JSON.
function claudeJsonAuthFailure({ value }: { value: string }): boolean | undefined {
  try {
    const parsed = JSON.parse(value) as { authenticated?: unknown; loggedIn?: unknown };
    if (parsed.authenticated === true || parsed.loggedIn === true) return false;
    if (parsed.authenticated === false || parsed.loggedIn === false) return true;
  } catch {
    // Fall through to text matching below.
  }
  return undefined;
}

function claudeTextAuthFailure({ value }: { value: string }): boolean {
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

export function isClaudeAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return claudeJsonAuthFailure({ value }) ?? claudeTextAuthFailure({ value });
}

type TailoredAuthClassifier = {
  isFailure: (requiredArgs: { text: string }) => boolean;
  guidance: (requiredArgs: { hostName: string }) => string;
};

// Agents that ship a bespoke auth-failure classifier + tailored sign-in hint.
// Map (not an object literal) so an arbitrary agent id can never hit a
// prototype key.
const TAILORED_AUTH_CLASSIFIERS: ReadonlyMap<string, TailoredAuthClassifier> = new Map<string, TailoredAuthClassifier>([
  ['claude', { isFailure: isClaudeAuthFailureText, guidance: ({ hostName }) => claudeAuthGuidance({}, { hostName }) }],
  ['cursor-agent', { isFailure: isCursorAuthFailureText, guidance: ({ hostName }) => cursorAuthGuidance({}, { hostName }) }],
  ['deepseek', { isFailure: isDeepSeekAuthFailureText, guidance: ({ hostName }) => deepseekAuthGuidance({}, { hostName }) }],
  ['antigravity', { isFailure: isAntigravityAuthFailureText, guidance: ({ hostName }) => antigravityAuthGuidance({}, { hostName }) }],
  ['reasonix', { isFailure: isReasonixAuthFailureText, guidance: ({ hostName }) => reasonixAuthGuidance({}, { hostName }) }],
]);


export function classifyAgentAuthFailure({ agentId, text }: { agentId: string; text: string }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}
): AgentAuthProbeResult | null {
  const classifier = TAILORED_AUTH_CLASSIFIERS.get(agentId);
  if (!classifier?.isFailure({ text: text })) return null;
  return { status: 'missing', message: classifier.guidance({ hostName: hostName }) };
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
export function classifyAgentServiceFailure({ text }: { text: string }): AgentServiceFailureCode | null {
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
// `stringOrEmpty` before either ever reaches here
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
// via `classifyAgentAuthFailure` (`TAILORED_AUTH_CLASSIFIERS`). For these, a null result is authoritative
// ("authenticated"); we must NOT second-guess it with the broad generic
// regex (e.g. cursor-agent's healthy `status` output mentions "login" in
// ways the generic matcher would misread). The generic classifier is only a
// fallback for adapters with no tailored classifier of their own.
// (The tailored set is `TAILORED_AUTH_CLASSIFIERS`' keys, so the two lists
// can no longer drift apart.)

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
  if (TAILORED_AUTH_CLASSIFIERS.has(def.id)) {
    return classifyAgentAuthFailure({ agentId: def.id, text: text }, { hostName: hostName });
  }
  if (classifyAgentServiceFailure({ text: text }) === 'AGENT_AUTH_REQUIRED') {
    return { status: 'missing', message: genericAuthGuidance(def.name || def.id, hostName) };
  }
  return null;
}

type AuthProbeDef = Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>;
type AuthProbeSpec = NonNullable<RuntimeAgentDef['authProbe']>;

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Classify the probe's combined output and, on a missing-auth result, attach
// the exit context and the stdout/stderr tails.
function probedFailureWithContext(
  { def, output, stdoutText, stderrText, exitCode, signal }: { def: AuthProbeDef; output: string; stdoutText: string; stderrText: string; exitCode: number | null; signal: string | null },
  { hostName }: { hostName: string },
): AgentAuthProbeResult | null {
  const failure = classifyProbedAuthFailure(def, output, hostName);
  if (!failure) return null;
  return withProbeTails({ ...failure, exitCode, signal }, stdoutText, stderrText);
}

async function runAuthProbe(
  { def, probe, resolvedBin, env }: { def: AuthProbeDef; probe: AuthProbeSpec; resolvedBin: string; env: RuntimeEnv },
  { hostName }: { hostName: string },
): Promise<AgentAuthProbeResult> {
  const { stdout, stderr } = await execAgentFile({ command: resolvedBin, args: probe.args }, { options: {
    env: env as NodeJS.ProcessEnv,
    timeout: probe.timeoutMs ?? 5000,
    maxBuffer: 1024 * 1024,
  } });
  const stdoutText = stringOrEmpty(stdout);
  const stderrText = stringOrEmpty(stderr);
  const output = `${stdoutText}\n${stderrText}`;
  return (
    probedFailureWithContext({ def, output, stdoutText, stderrText, exitCode: 0, signal: null }, { hostName }) ?? { status: 'ok' }
  );
}

function probeRejectionResult(
  { def, probe, error }: { def: AuthProbeDef; probe: AuthProbeSpec; error: unknown },
  { hostName }: { hostName: string },
): AgentAuthProbeResult {
  const err = error as NodeJS.ErrnoException & {
    stdout?: unknown;
    stderr?: unknown;
    code?: string | number;
    signal?: string;
  };
  const stdoutText = stringOrEmpty(err.stdout);
  const stderrText = stringOrEmpty(err.stderr);
  const output = [err.message, stdoutText, stderrText].join('\n');
  // util.promisify(execFile) attaches `code` and `signal` to the
  // rejection error. `code` may be a number (real non-zero exit) or a
  // Node ErrnoException string ("ENOENT"); only the numeric form is
  // meaningful as an exit code.
  const exitCode = typeof err.code === 'number' ? err.code : null;
  const signal = typeof err.signal === 'string' ? err.signal : null;
  const failure = probedFailureWithContext({ def, output, stdoutText, stderrText, exitCode, signal }, { hostName });
  if (failure) return failure;
  return withProbeTails(
    {
      status: 'unknown',
      message: `${def.name || def.id} authentication status could not be verified with \`${def.id} ${probe.args.join(' ')}\`.`,
      exitCode,
      signal,
    },
    stdoutText,
    stderrText,
  );
}

// Run an adapter's declared authentication probe (a cheap, side-effect-free
// status/whoami command) and classify the result. Returns null when the
// adapter declares no `authProbe` — those agents are never actively probed;
// their auth status is inferred only from a real chat failure's error text.
export async function probeAgentAuthStatus({ def, resolvedBin, env }: { def: Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>; resolvedBin: string; env: RuntimeEnv }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}
): Promise<AgentAuthProbeResult | null> {
  const probe = def.authProbe;
  if (!probe) return null;
  if (hasProbeSatisfyingApiKey(def, env)) return { status: 'ok' };
  try {
    return await runAuthProbe({ def, probe, resolvedBin, env }, { hostName });
  } catch (error) {
    return probeRejectionResult({ def, probe, error }, { hostName });
  }
}
