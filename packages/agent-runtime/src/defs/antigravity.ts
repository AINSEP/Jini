/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/antigravity.ts` (import path adjusted only). See `source-map.md`. */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef, RuntimeModelOption } from '../types.js';

// `agy` v1.1.24 has a real `--model <id>` flag (`agy --help`: "Model for the current CLI
// session") plus a machine-readable `agy models` subcommand that lists every selectable model as
// a stable `<slug>\t<label>` pair — both verified live, neither true of the v1.0.3 this file used
// to target (upstream issue #35, closed by the flag's addition). That retires the
// settings.json-write-then-poll-the-log workaround this file used to carry (see git history for
// `writeAntigravityModelSelection`/`antigravityModelLock`/`waitForAgyToReadModel`, and the
// process-global race across concurrent runs it existed to serialize): the model rides argv on
// `buildArgs` below instead, exactly like every other flag this def emits, and there is nothing
// left to lock.
//
// Two cases `buildArgs` treats specially:
//   - `DEFAULT_MODEL_OPTION.id` ('default') or no model at all: omit `--model` entirely, so agy
//     keeps whatever it would otherwise default to (its own TUI's last pick, or its own default).
//   - any other id: one of the stable slugs below (e.g. `gemini-3.1-pro-high`), passed verbatim as
//     `--model`'s value.
//
// `supportsCustomModel: false` because the model set is still a server-side enum, not free text —
// but the failure mode for an id outside it changed for the better: `agy --model <bogus> -p ...`
// now prints a loud `Error: invalid model selection ...` plus the full list of valid models
// (verified live), rather than the old settings.json path's silent `availableModels` cache miss +
// empty print-mode output. Kept `false` anyway: nothing here validates a typed id before spawn, so
// letting a UI send arbitrary text would just move that same failure into production instead of
// preventing it — `isKnownModel` (`../models.ts`) is what actually gates a caller-supplied id
// against this list before it ever reaches `buildArgs`.
//
// The 14 slugs/labels below are `agy models`' full live output as of agy v1.1.24 (2026-09-02), not
// a hand-maintained guess — re-run `agy models` to refresh if upstream's catalog changes.

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
 * Parses `agy models`' stdout into the shared `RuntimeModelOption[]` shape.
 *
 * The CLI's real output (agy v1.1.24, verified live — see this file's header
 * comment for the exact captured transcript) is one `Fetching available
 * models...` progress line followed by one `<slug>\t<label>` pair per line.
 * Each data line is split on the FIRST tab only, so a label that itself
 * contains a tab or extra whitespace never bleeds into the id.
 *
 * @param stdout - Raw stdout from `agy models`.
 * @returns The synthetic default option prepended to every parsed entry, or
 * `null` when no real entry was found (empty stdout, or only the progress
 * line survives filtering) — mirrors `parseCursorAgentModels`'s same-shape
 * null contract, which `detection.ts#fetchModels` already treats the same
 * as an empty array: fall back to `fallbackModels`.
 * @complexity O(n) in the stdout length.
 */
export function parseAgyModels(stdout: string): RuntimeModelOption[] | null {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const out = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const line of lines) {
    if (/^fetching available models\.\.\.$/i.test(line)) continue;
    const tabIndex = line.indexOf('\t');
    if (tabIndex === -1) continue;
    const id = line.slice(0, tabIndex).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = line.slice(tabIndex + 1).trim();
    out.push({ id, label: label || id });
  }

  return out.length > 1 ? out : null;
}

export const antigravityAgentDef = {
  id: 'antigravity',
  name: 'Antigravity',
  bin: 'agy',
  versionArgs: ['--version'],
  // `agy models` does a real network fetch (its own stdout says "Fetching
  // available models..."), so this gets a longer budget than codex's 5s
  // local-cache read — 10s to absorb ordinary network latency without
  // making every detection pass wait needlessly long on a slow/offline run
  // (`detection.ts#fetchModels` falls back to `fallbackModels` on timeout).
  listModels: {
    args: ['models'],
    parse: parseAgyModels,
    timeoutMs: 10_000,
  },
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
    { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  supportsCustomModel: false,
  // agy has no `--effort`-shaped flag: reasoning effort is a trailing `-high`/
  // `-medium`/`-low` on the model slug `--model` already carries (see the
  // `fallbackModels` list above, which is `agy models`' real output). So this
  // def declares the suffix VOCABULARY only — see `types.ts`'s
  // `RuntimeReasoningInModelId` for why the per-base-model availability is
  // derived from the model list instead of enumerated here, and why
  // `-thinking` on `claude-opus-4-6-thinking` must not be read as a level.
  // `buildArgs` below is deliberately unchanged: the effort is already inside
  // `--model`'s value, so there is no second argv to emit.
  reasoningInModelId: {
    levels: [
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low', label: 'Low' },
    ],
  },
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
    prompt,
    _imagePaths,
    _extra = [],
    options = {},
    runtimeContext = {},
  ) => {
    // `-p` is a Go `flag`-package flag that TAKES THE PROMPT AS ITS VALUE,
    // not a boolean switch followed by a positional prompt, and agy has no
    // stdin sentinel under the default `--input-format text`. Verified
    // against the installed agy v1.1.19:
    //   - `agy -p` alone           -> `flag needs an argument: -p`
    //   - `echo <prompt> | agy -p -` -> runs, but the prompt is the literal
    //     one-character string `-`; the piped stdin is never read, and agy
    //     answers the empty ask with a generic greeting drawn from whatever
    //     project memory it has ("How can I assist you today?").
    //   - `agy -p '<prompt>'`      -> the prompt actually lands.
    // So the prompt rides argv as `-p`'s value. That is also why this def is
    // argv-budgeted (`maxPromptArgBytes` below) rather than `promptViaStdin`.
    const args: string[] = [];
    // `--model` is the same kind of Go flag as `--log-file`/`-p`: its value is
    // whatever argv token immediately follows it, so it too must be pushed
    // before `-p` (always last — see below). Verified live against agy
    // v1.1.24: `agy --model <slug> -p '<prompt>'` runs that one print-mode
    // turn on the named model, and combining it with `--log-file` works the
    // same way — relative order between `--model` and `--log-file` doesn't
    // matter (each independently consumes exactly the one token after it),
    // only that both precede `-p`.
    if (options.model && options.model !== DEFAULT_MODEL_OPTION.id) {
      args.push('--model', options.model);
    }
    // Always opt into `--log-file` when the daemon supplied a path so
    // it can post-exit grep for the actual upstream failure shape
    // (auth missing vs quota reached vs upstream error) — without it
    // the chat surfaces a generic "empty response" because print mode
    // never echoes those errors on stdout. See server.ts empty-output
    // guard for the consumer.
    if (runtimeContext.agentLogFilePath) {
      args.push('--log-file', runtimeContext.agentLogFilePath);
    }
    args.push('-p', prompt);
    return args;
  },
  // agy takes its prompt on argv (see `buildArgs`), so this def is
  // argv-budgeted like the other plain-stream argv adapters (aider,
  // deepseek) rather than `promptViaStdin`. Without one of these three
  // fields `assessAgentExecutorCompatibility` rejects the def outright.
  maxPromptArgBytes: 30_000,
  streamFormat: 'plain',
  // `buildArgs` above already consumes `runtimeContext.agentLogFilePath` when
  // the caller supplies one; this is what asks it to. Print mode never
  // echoes auth/quota failures on stdout, so post-exit log inspection is the
  // only way to tell those two apart — see server.ts's empty-output guard
  // for the consumer.
  needsAgentLogFile: true,
  // The one adapter in this package that must not stream live — see
  // `redactAntigravityAuthUrls`'s comment for the OAuth-URL-on-stdout-plus-
  // exit-0 behavior that forces it. Every other `streamFormat: 'plain'`
  // adapter (grok-build, aider, deepseek, qwen) leaves `stdoutPolicy` unset
  // and keeps streaming per chunk; aider's and deepseek's own comments call
  // that live cadence out as deliberate.
  stdoutPolicy: { buffering: 'until-close', sanitize: redactAntigravityAuthUrls },
  installUrl: 'https://antigravity.google/cli',
  docsUrl: 'https://antigravity.google/docs/cli-overview',
  // `externalMcpInjection: 'env-passthrough'` — the prior verdict here ("no safe, run-scoped
  // delivery mechanism exists") stood as long as the only candidates were a per-run config
  // flag/relocatable home dir, neither of which `agy` has (see the probes below, still accurate).
  // What flips the verdict is a THIRD property, verified live and not previously tested: `agy`
  // passes its own parent process environment through to the stdio MCP server children it spawns
  // for servers already sitting in its persistent global registry.
  //
  //   - Proven with a probe MCP server registered under a relocated `HOME`'s
  //     `.gemini/config/mcp_config.json`: booted under `agy -p`, it read a marker variable
  //     (`TOVU_ENV_PASSTHROUGH_PROBE`) straight out of its own `process.env` — no config field, no
  //     argv, nothing but inherited environment. Full MCP handshake observed on the same run:
  //     `server/discover` → `initialize` → `notifications/initialized` → `tools/list`
  //     (protocolVersion `2025-11-25`, clientInfo `antigravity-client`).
  //   - That makes the registration itself a STATIC, one-time operation — the operator adds one
  //     `tovu` entry to their real `~/.gemini/config/mcp_config.json` (confirmed still the one real
  //     mechanism; see the probes below) with a bare, env-free `command` pointing at this package's
  //     own `jini-mcp` bin, resolving its credential from the environment at spawn time instead of
  //     a baked-in value. No per-spawn config mutation, no lock, no restore discipline — the exact
  //     "safe, run-scoped delivery" gap the old verdict cited is closed by inheritance, not by
  //     relocation.
  //   - So this def's job shrinks to exactly what `'env-passthrough'` describes in `types.ts`: put
  //     the bridge entry's `JINI_RUN_ID`/`JINI_DAEMON_URL`/`JINI_DAEMON_TOKEN` onto `agy`'s OWN
  //     spawn env (done centrally by `@jini-ai/daemon`'s `computeChildEnv`, not by this def's
  //     `buildArgs`), and `agy` carries them the rest of the way to the already-registered server on
  //     its own.
  //
  // The prior probes into a per-run/relocatable mechanism remain accurate and are kept as the
  // record of what does NOT work, so a future reader does not re-walk the same dead ends:
  //
  //   - No per-run config-path flag. `agy --help` and `agy mcp add --help` were read in full: `mcp
  //     add/remove/list/enable/disable` only mutate the PERSISTENT global registry — there is no
  //     `--mcp-config <path>`-shaped flag anywhere on the top-level command or its subcommands.
  //   - No CODEX_HOME-equivalent env var. `strings` over the `agy` binary itself (not just docs) for
  //     every all-caps `*HOME*`/`*_DIR`/`*_PATH`/`XDG_*` token found nothing naming a relocatable
  //     config/data root for Antigravity or Gemini specifically — only the generic `HOME` (relocating
  //     that would redirect the ENTIRE user profile for the child, not a scoped config dir, and is not
  //     an "explicit, run-scoped delivery" by any reasonable reading). Also why the passthrough probe
  //     above used a relocated `HOME` only to prove inheritance in isolation — production spawns
  //     always use the operator's real `HOME`, since relocating it breaks `agy`'s own auth.
  //   - The workspace-relative `.agents/mcp_config.json` this comment used to cite as unverified is
  //     now verified NOT to be what it looked like: a project dir was seeded with a real
  //     `.agents/mcp_config.json` entry, then `agy mcp list` (run from that cwd) showed only the
  //     REAL global config's servers — the workspace file never appeared. A live headless `agy -p`
  //     run from that same cwd (both with and without `--new-project`), captured via `--log-file`,
  //     shows zero mention of "mcp" or the seeded server name anywhere in its diagnostic log, and its
  //     own log line reports the run scoped to a generic `"CLI Project"` bucket, not the cwd as a
  //     distinct project. Best read: `.agents/mcp_config.json` belongs to the Antigravity IDE
  //     extension's own project layer, a different consumer than the bare `agy` CLI binary this
  //     daemon actually spawns — not a mechanism reachable from a plain `agy -p` invocation at all.
  //     Confirmed independently upstream: antigravity-cli issue #60 (open, no maintainer response)
  //     reports the identical "project-local mcp_config.json is read but ignored" symptom.
  //   - `~/.gemini/config/mcp_config.json` (global, JSON, `{"mcpServers":{"<name>":{"command":...}}}`,
  //     confirmed by reading the operator's own file read-only after backing it up) has no relocation
  //     path — but per the passthrough finding above, this def never needs to write to it at all
  //     outside the one-time operator registration, so the shared-file race a prior version of this
  //     comment warned about (a second race alongside the now-deleted settings.json model lock) never
  //     materializes: nothing here mutates that file per run.
  //
  // No hang was observed on any of these probes (all completed in well under `--print-timeout`'s
  // default 5m).
  externalMcpInjection: 'env-passthrough',
} satisfies RuntimeAgentDef;
