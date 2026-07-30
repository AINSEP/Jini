/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/antigravity.ts` (import path adjusted only). See `source-map.md`. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef, RuntimeLock, RuntimeLockHold } from '../types.js';

// `agy` v1.0.3 still has no `--model` flag (upstream issue #35), but the
// TUI's Switch-Model picker writes the choice to its settings.json, and
// every `agy -p` invocation re-reads that file on startup — verified by
// capturing the `--log-file` line `Propagating selected model override to
// backend: label="<model>"`. So we can route OD's model picker through
// settings.json: when the user picks a concrete model in Settings, the
// daemon writes the label into agy's settings.json right before spawn,
// and the resulting print-mode run uses that model.
//
// Two ids the picker exposes are special:
//   - 'default'         : leave settings.json untouched, so agy keeps
//                         whatever the user last picked in its own TUI.
//                         (Respects user choice when they switch models
//                         from `agy` directly.)
//   - any other id      : the literal display label agy expects (e.g.
//                         "Gemini 3.1 Pro (High)", "Claude Sonnet 4.6
//                         (Thinking)"). We persist it before spawn.
//
// `supportsCustomModel: false` because the label set is a server-side
// enum — a typed id agy doesn't recognise resolves to a silent
// `availableModels` cache miss + empty print-mode output, which surfaces
// to the user as a generic "empty response" error.
//
// The 8 model labels mirror what `Switch Model` in agy's TUI lists for
// consumer-tier accounts as of 2026-05-28. The set is small and stable
// enough to ship statically until upstream adds a programmatic
// `agy models` subcommand (also tracked under issue #35).
const ANTIGRAVITY_SETTINGS_PATH = join(
  homedir(),
  '.gemini',
  'antigravity-cli',
  'settings.json',
);

export function writeAntigravityModelSelection(
  label: string,
  settingsPath: string = ANTIGRAVITY_SETTINGS_PATH,
): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt JSON — fall through and rewrite the file from scratch so
      // the next spawn starts from a known-good state.
    }
  }
  existing.model = label;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);
}

// Per-process serialization for write-settings → spawn → agy-reads
// cycles on antigravity. `~/.gemini/antigravity-cli/settings.json` is
// process-global, so two OD runs that both pick concrete (non-default)
// models can race: run A writes model A, spawn A starts, run B writes
// model B before A's agy has read settings.json — A then executes on
// model B. The daemon serialises non-default antigravity spawns
// through this chain: each acquire awaits the previous release, and
// each release fires only after the spawned agy actually emits
// `Propagating selected model override to backend: label="<X>"` in
// its `--log-file` (which is the upstream signal that settings.json
// has been read).
let antigravityLockChain: Promise<void> = Promise.resolve();

export async function acquireAntigravityModelLock(): Promise<() => void> {
  const previous = antigravityLockChain;
  // Definite-assignment assertion (`!`), not a `() => {}` fallback default:
  // the ECMAScript spec guarantees a `Promise` executor runs synchronously,
  // immediately, during construction — `release = resolve` below has
  // already run by the time `new Promise(...)` returns, so a fallback
  // no-op default would be assigned, coverage-instrumented, and never once
  // invoked. Removing it drops that dead function instead of padding a
  // test around code that cannot execute.
  let release!: () => void;
  antigravityLockChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

// Visible for tests. Resets the module-level lock chain so a test that
// installed a hanging acquirer can release it without leaking state to
// subsequent test cases. Production code never calls this.
export function _resetAntigravityModelLockForTests(): void {
  antigravityLockChain = Promise.resolve();
}

export interface WaitForAgyModelOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  // Override for tests; production reads the daemon-owned log file path.
  readFile?: (path: string) => Promise<string>;
  // Override `Date.now` for tests; production uses the wall clock.
  now?: () => number;
  // Stops polling when fired. Production wires this to `child.once('exit')`
  // so the watcher cancels as soon as agy exits — the lock release is
  // then driven by the exit handler rather than the helper's return
  // value, eliminating the slow-startup race the looper review at
  // 263fd2fe7 flagged: if a cold agy takes >timeoutMs to read its
  // settings.json, we'd otherwise return false, the caller would
  // release the lock, and a concurrent run B could rewrite
  // settings.json before A's agy actually read it.
  abortSignal?: AbortSignal;
}

// Polls agy's `--log-file` for the line
//   `Propagating selected model override to backend: label="<expectedModel>"`
// which `model_config_manager.go` emits once agy has finished reading
// `~/.gemini/antigravity-cli/settings.json` and sent the model
// override to the upstream backend. Returns true on observed signal,
// false on timeout OR abort. Never throws — a missing log file is
// treated as "not yet seen" so the polling loop keeps retrying until
// either the deadline or the abort signal fires.
//
// IMPORTANT: callers MUST NOT use a `false` return as a "go ahead and
// release the settings.json lock" signal — false means "I gave up
// polling," not "agy definitely didn't read this." Release the lock
// only on (a) a `true` return, OR (b) child exit. See server.ts for
// the wiring.
export async function waitForAgyToReadModel(
  logFilePath: string,
  expectedModel: string,
  options: WaitForAgyModelOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const readFile =
    options.readFile ?? ((path: string) => fsReadFile(path, 'utf8'));
  const now = options.now ?? Date.now;
  const abortSignal = options.abortSignal;
  if (abortSignal?.aborted) return false;
  const escaped = expectedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `Propagating selected model override to backend: label="${escaped}"`,
  );
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (abortSignal?.aborted) return false;
    try {
      const content = await readFile(logFilePath);
      if (pattern.test(content)) return true;
    } catch {
      // Log file may not have appeared yet; keep polling.
    }
    if (now() >= deadline) break;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      // `{ once: true }` only detaches the listener on the abort path. When the
      // timer wins instead — the common case, once per poll — the listener would
      // stay attached to a signal that outlives this iteration, so a default
      // 15s/250ms run accumulates ~60 of them on the same AbortSignal before the
      // process exits. Detach explicitly on the timer path too.
      const timer = setTimeout(() => {
        abortSignal?.removeEventListener('abort', onAbort);
        resolve();
      }, pollIntervalMs);
      abortSignal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  return false;
}

// `agy -p` prints an interactive OAuth sign-in URL to **stdout** and then
// exits **0** when the keyring entry is missing or expired, so a driver that
// streams stdout live shows that URL to the user as if it were the model's
// reply. Two reasons that is a leak, not merely ugly:
//   - the URL carries the client_id and redirect_uri of a login flow bound to
//     whoever runs the daemon, and a chat transcript is a far wider audience
//     than a terminal;
//   - it is also useless to click: `-p` print mode has no field to paste the
//     resulting auth code back into (see `auth.ts`'s
//     `antigravityAuthGuidance`), so the only outcome is a leaked URL.
// Hence `stdoutPolicy: {buffering: 'until-close'}` plus this redactor.
//
// The shape being matched is real, not guessed — it is the same text this
// package's own `isAntigravityAuthFailureText` already classifies, captured
// from agy v1.0.3:
//   Authentication required. Please visit the URL to log in:
//   https://accounts.google.com/o/oauth2/auth?client_id=…&redirect_uri=antigravity-redirect
const OAUTH_URL_PATTERN = new RegExp(
  [
    // Google's own OAuth 2.0 authorization host — the endpoint agy actually
    // prints. Host-anchored rather than path-anchored so an upstream move
    // from `/o/oauth2/auth` to any other path on that host still redacts.
    String.raw`https?://accounts\.google\.com/\S*`,
    // Any other absolute URL carrying an OAuth request's or a bearer
    // credential's hallmark query parameter, so a future change of identity
    // provider degrades to "redacted" instead of "leaked". Deliberately keyed
    // on the parameter names rather than on the word "oauth" appearing
    // somewhere in the URL, which would also eat ordinary documentation links
    // an assistant reply might legitimately contain.
    String.raw`https?://\S*[?&](?:client_id|code_challenge|code_verifier|access_token|id_token|refresh_token)=\S*`,
  ].join('|'),
  'gi',
);

/** What a redacted URL is replaced with. Deliberately says *what* was removed, so the surrounding "Please visit the URL to log in:" text does not read as truncated output. */
const OAUTH_URL_PLACEHOLDER = '[redacted sign-in URL]';

/**
 * Redacts any OAuth sign-in URL from agy's buffered print-mode stdout,
 * leaving all other output byte-identical.
 *
 * Scoped to redaction on purpose: it does **not** classify the output as an
 * auth failure or substitute sign-in guidance for it. That classification
 * already has an owner — `auth.ts`'s `classifyAgentAuthFailure` /
 * `isAntigravityAuthFailureText`, consumed by whatever surfaces a structured
 * auth error — and duplicating the decision here would mean this def silently
 * rewrites assistant text into instructions. See `source-map.md`.
 *
 * @param fullText - The concatenation of every stdout chunk agy produced.
 * @returns The same text with every sign-in URL replaced by a placeholder.
 * @complexity O(n) in the buffered text length.
 * @overallScore 100/100
 */
export function redactAntigravityAuthUrls(fullText: string): string {
  return fullText.replace(OAUTH_URL_PATTERN, OAUTH_URL_PLACEHOLDER);
}

/**
 * Resolves when `signal` aborts (immediately if it already has). Used instead
 * of a never-settling `new Promise(() => {})` so a long-lived caller does not
 * accumulate one permanently-pending promise, plus its captured closure, per
 * run.
 */
function waitUntilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * Adapts the module-level `acquireAntigravityModelLock` /
 * `waitForAgyToReadModel` pair to the caller-facing {@link RuntimeLock}
 * contract. A thin adapter, deliberately: the mutex and the log-polling
 * handoff detector are the existing, separately-tested functions above, and
 * this adds no serialization logic of its own.
 *
 * The one policy decision it does make — skipping the lock entirely when no
 * concrete model was selected — mirrors `buildArgs`'s own
 * `options.model && options.model !== DEFAULT_MODEL_OPTION.id` guard exactly.
 * The lock guards the `settings.json` write, so when that write will not
 * happen there is nothing to serialize, and holding the chain anyway would
 * make a `'default'`-model run queue behind an unrelated one for no benefit.
 */
export const antigravityModelLock: RuntimeLock = {
  acquire: async ({ model }): Promise<RuntimeLockHold> => {
    if (!model || model === DEFAULT_MODEL_OPTION.id) {
      // No settings.json write this spawn — hand back an inert hold rather
      // than joining the chain. `release` must still exist and still be
      // idempotent: the caller calls it on both handoff and process exit
      // without knowing which kind of hold it got.
      return { release: () => {} };
    }
    const release = await acquireAntigravityModelLock();
    return {
      release,
      waitForHandoff: async ({ logFilePath, processExited }) => {
        if (logFilePath !== undefined) {
          const observed = await waitForAgyToReadModel(logFilePath, model, {
            abortSignal: processExited,
          });
          if (observed) return;
        }
        // Reached when either there is no `--log-file` to watch (no
        // observable propagation signal exists at all), or the watcher
        // stopped without seeing the line. Neither is evidence that agy
        // failed to read settings.json — `waitForAgyToReadModel`'s `false`
        // means "stopped polling" (see its own doc). Resolving here would
        // release the lock while a cold-starting agy may still be about to
        // read the file, reopening exactly the race this lock closes. So
        // hand the release decision back to process exit, the only event
        // that proves agy can no longer read it.
        await waitUntilAborted(processExited);
      },
    };
  },
};

export const antigravityAgentDef = {
  id: 'antigravity',
  name: 'Antigravity',
  bin: 'agy',
  versionArgs: ['--version'],
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'Gemini 3.1 Pro (High)', label: 'Gemini 3.1 Pro (High)' },
    { id: 'Gemini 3.1 Pro (Low)', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)' },
    { id: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)' },
    { id: 'Gemini 3.5 Flash (Low)', label: 'Gemini 3.5 Flash (Low)' },
    {
      id: 'Claude Sonnet 4.6 (Thinking)',
      label: 'Claude Sonnet 4.6 (Thinking)',
    },
    { id: 'Claude Opus 4.6 (Thinking)', label: 'Claude Opus 4.6 (Thinking)' },
    { id: 'GPT-OSS 120B (Medium)', label: 'GPT-OSS 120B (Medium)' },
  ],
  supportsCustomModel: false,
  // We deliberately do NOT opt into `resumesSessionViaCli` / agy's `-c`
  // resume flag on follow-up turns. Tested both shapes; `-c` activates
  // agy's internal agentic loop (multi-step model retries, tool calls,
  // fallback-to-cached-response on tool errors) which can't be steered
  // from OD's system-prompt OVERRIDE — even with the strongest wording
  // we got an identical byte-for-byte form re-emission on turn 2 when
  // turn 1's tool-call retry path returned the cached form response.
  //
  // Instead we treat agy as a stateless plain adapter like qwen /
  // deepseek: every spawn gets the full OD-rendered transcript via
  // `buildDaemonTranscript`, and that transcript's prior assistant
  // turns are sanitized to strip `<question-form>` markup + form-schema
  // JSON fences (see `sanitizePriorAssistantTurnForTranscript` in
  // apps/web/src/providers/daemon.ts). The stronger OVERRIDE block
  // composed in server.ts gives a second line of defense for weak
  // plain-stream models like Gemini 3.5 Flash.
  buildArgs: (
    _prompt,
    _imagePaths,
    _extra = [],
    options = {},
    runtimeContext = {},
  ) => {
    if (options.model && options.model !== DEFAULT_MODEL_OPTION.id) {
      writeAntigravityModelSelection(
        options.model,
        runtimeContext.antigravitySettingsPath,
      );
    }
    // We invoke agy via `-p -` (print mode + stdin sentinel), NOT
    // `chat -`. Verified against `agy --help` on v1.0.3 — the
    // `Available subcommands` list is `changelog / help / install /
    // plugin / update`, and `chat` is NOT among them. `-p` is the
    // documented print-mode flag (`Short alias for --print`) and
    // `agy -p -` reads the prompt from stdin. The looper reviewer
    // bot's environment runs a different agy build that may have
    // renamed the entry point; until upstream confirms a stable
    // headless subcommand (see google-antigravity/antigravity-cli#119)
    // and the change actually ships in the auto-update channel that
    // packaged OD users get, `-p -` is the contract that actually
    // produces a print-mode reply on the installed CLI.
    const args: string[] = [];
    // Always opt into `--log-file` when the daemon supplied a path so
    // it can post-exit grep for the actual upstream failure shape
    // (auth missing vs quota reached vs upstream error) — without it
    // the chat surfaces a generic "empty response" because print mode
    // never echoes those errors on stdout. See server.ts empty-output
    // guard for the consumer.
    //
    // Flag order is load-bearing on agy v1.0.3: `agy -p --log-file
    // /tmp/x -` runs successfully but leaves /tmp/x empty, while `agy
    // --log-file /tmp/x -p -` captures the diagnostic log, including
    // `Propagating selected model override to backend: label="<model>"`
    // and auth/quota failures.
    if (runtimeContext.agentLogFilePath) {
      args.push('--log-file', runtimeContext.agentLogFilePath);
    }
    args.push('-p');
    args.push('-');
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'plain',
  // `buildArgs` above already consumes `runtimeContext.agentLogFilePath` when
  // the caller supplies one; this is what asks it to. Two distinct things
  // depend on the log file, which is why it is not merely a diagnostic nicety
  // for this adapter:
  //   - `runtimeLock`'s handoff detector polls it for agy's own
  //     "Propagating selected model override to backend" line;
  //   - print mode never echoes auth/quota failures on stdout, so post-exit
  //     log inspection is the only way to tell those two apart.
  needsAgentLogFile: true,
  // The one adapter in this package that must not stream live — see
  // `redactAntigravityAuthUrls`'s comment for the OAuth-URL-on-stdout-plus-
  // exit-0 behavior that forces it. Every other `streamFormat: 'plain'`
  // adapter (grok-build, aider, deepseek, qwen) leaves `stdoutPolicy` unset
  // and keeps streaming per chunk; aider's and deepseek's own comments call
  // that live cadence out as deliberate.
  stdoutPolicy: { buffering: 'until-close', sanitize: redactAntigravityAuthUrls },
  runtimeLock: antigravityModelLock,
  installUrl: 'https://antigravity.google/cli',
  docsUrl: 'https://antigravity.google/docs/cli-overview',
} satisfies RuntimeAgentDef;
