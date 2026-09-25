/**
 * Ported verbatim from OD's `apps/daemon/src/runtimes/defs/claude.ts` (import
 * path adjusted only). See `source-map.md`.
 *
 * **Image delivery (added 2026-08-03):** `buildArgs` below takes an
 * `_imagePaths` parameter but never references it — the Claude Code CLI has
 * no dedicated image-attachment flag or wire mechanism this adapter could
 * forward to. It is not, however, blind to images: confirmed live by piping
 * `Tell me what this image is as best you can: /tmp/probe-image.png` into a
 * real `claude -p` and getting an accurate description back — the CLI reads
 * a local file itself once its path is named in the prompt text. The one
 * real precondition, also confirmed live: the path's directory has to be in
 * the CLI's allowed-directory list (`claude -p` first refused the identical
 * probe when the path was under `/Users/la/Desktop`, reporting that
 * directory as outside its allowed working directories) — which is exactly
 * what `buildArgs`'s existing `extraAllowedDirs` -> `--add-dir` handling
 * below already provides, unmodified.
 *
 * `imageDelivery: 'prompt-path'` (declared below) is what turns this into
 * real behavior: `@jini-ai/daemon`'s `agent-executor.ts` reads that field and,
 * before `buildArgs` ever runs, (1) appends an attachment-naming section to
 * the prompt text via `image-prompt-delivery.ts#augmentPromptWithImageAttachments`
 * and (2) widens `extraAllowedDirs` with each image's containing directory —
 * so this file needed no change to its own `dirs`/`--add-dir` logic at all,
 * only the one-line `imageDelivery` declaration. See
 * `types.ts#RuntimeAgentDef.imageDelivery`'s doc for the full mode contract
 * and why 'native'-delivery defs (ACP, pi-rpc, qoder) must never also get
 * this treatment.
 */
import { agentCapabilities } from '../capabilities.js';
import { buildClaudeMcpConfigArgs, DEFAULT_MODEL_OPTION } from './shared.js';
import { loadMmdRouteModels } from '../mmd-routes.js';
import { loadAnthropicLiveModels, mergeLiveModels } from '../anthropic-live-models.js';
import { loadClaudeCodeModels } from '../claude-code-models.js';
import type { RuntimeAgentDef } from '../types.js';

/**
 * The levels `claude --effort` accepts, as the CLI itself reports them when
 * given an unknown one. Anything outside this set is dropped rather than
 * forwarded: the CLI answers an unrecognized level with a stderr warning and
 * then runs at its default, so passing one through would look like the setting
 * applied while silently doing nothing.
 */
const CLAUDE_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low', 'medium', 'high', 'xhigh', 'max',
]);

/**
 * The list a picker renders when nothing live is available — no `~/.config/mms/model-routes.json`,
 * the CLI's own picker catalog unreadable (see `claude-code-models.ts`), and no `ANTHROPIC_API_KEY`
 * in the agent's environment or a failed live call. Not the primary source: see `fetchModels` below.
 * Every live source is unioned ON TOP of this list, so it is also the floor that never shrinks.
 *
 * Ordered current-first, then the still-active-but-superseded generations, which are KEPT rather
 * than dropped — an installed CLI may be pinned to one via its own config, and removing a working
 * selection out from under a user is worse than listing it last.
 *
 * Every id below is verified present in the installed Claude Code binary's own embedded model
 * table (2.1.261), and `claude-fable-5-1` is additionally the value in `~/.claude.json`'s
 * server-fetched `additionalModelOptionsCache`. `claude-fable-5-mythos-5` appears in the binary but
 * NOT in that server-fetched picker list, so it is deliberately omitted: an id in the binary is not
 * evidence it is a selectable model.
 *
 * The `[1m]` long-context suffix the server-fetched cache carries on `claude-fable-5-1` is dropped
 * here on purpose — `models.ts#sanitizeCustomModel` rejects brackets, and `claude --help` documents
 * the bare full name as the accepted `--model` form.
 *
 * **This list WILL go stale, and that is now a detectable event rather than a silent one** — see
 * `fallbackModelsAssertedAt` on the def below and `scripts/check-model-fallback-freshness.ts`.
 */
const CLAUDE_FALLBACK_MODELS = [
  DEFAULT_MODEL_OPTION,
  { id: 'fable', label: 'Fable (alias)' },
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'haiku', label: 'Haiku (alias)' },
  { id: 'claude-fable-5-1', label: 'claude-fable-5-1' },
  { id: 'claude-fable-5', label: 'claude-fable-5' },
  { id: 'claude-opus-5', label: 'claude-opus-5' },
  { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
  { id: 'claude-opus-4-8', label: 'claude-opus-4-8' },
  { id: 'claude-opus-4-7', label: 'claude-opus-4-7' },
  { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
];

export const claudeAgentDef = {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    // Drop-in forks that ship a CLI argv-compatible with `claude`. Tried in
    // order if `claude` itself isn't on PATH, so users on a single-binary
    // install (e.g. only OpenClaude — https://github.com/Gitlawb/openclaude
    // — issue #235) get auto-detected without writing wrapper scripts.
    fallbackBins: ['openclaude'],
    versionArgs: ['--version'],
    authProbe: {
      args: ['auth', 'status'],
      timeoutMs: 5000,
    },
    helpArgs: ['-p', '--help'],
    capabilityFlags: {
      // Flag string -> capability key. After probing `--help`, we set
      // `agentCapabilities[id][key] = true` for each substring that matches.
      // `--add-dir` and `--include-partial-messages` live under `claude -p`
      // subcommand, so we probe `claude -p --help` instead of `claude --help`.
      // Fixes issue #430: --add-dir never detected because it wasn't in global help.
      '--include-partial-messages': 'partialMessages',
      '--add-dir': 'addDir',
      '--effort': 'effort',
      '--append-system-prompt': 'appendSystemPrompt',
    },
    // `claude` has no list-models subcommand, so the model list is answered from the best source
    // available, in this order:
    //
    //   1. Local mmd/MMS routes, when `~/.config/mms/model-routes.json` exists — an explicit local
    //      routing config is the operator's own authoritative statement of what this CLI can reach,
    //      including proxy-backed Claude-compatible models the vendor API knows nothing about.
    //   2. Otherwise, the UNION of two live sources, run in parallel:
    //      a. The CLI's own `/model` picker catalog — NO credential needed (subscription auth
    //         works). See `claude-code-models.ts`: the stream-json `initialize` control request,
    //         falling back to `~/.claude.json`'s `additionalModelOptionsCache`. Cached per process.
    //      b. The account's live Anthropic catalog, when `ANTHROPIC_API_KEY` is in this agent's
    //         environment (makes no network call at all without a key).
    //      Both are merged ON TOP of the static list, never in place of it; neither shadows the other.
    //   3. The static list, when neither live source answers.
    //
    // Returning `null` from any step is "nothing to add", and `detection.ts#fetchModels` renders
    // `fallbackModels` for it — so a live-discovery failure can never empty or shrink the picker.
    fallbackModels: CLAUDE_FALLBACK_MODELS,
    // Asserted against the installed Claude Code 2.1.261 binary's embedded model table and
    // `~/.claude.json`'s server-fetched `additionalModelOptionsCache`. See
    // `RuntimeAgentDef.fallbackModelsAssertedAt` and `scripts/check-model-fallback-freshness.ts`.
    fallbackModelsAssertedAt: '2026-09-05',
    fetchModels: async (resolvedBin, env) => {
      const routed = await loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS);
      if (routed) return routed;
      const [fromCli, fromApi] = await Promise.all([
        loadClaudeCodeModels(resolvedBin, env, CLAUDE_FALLBACK_MODELS),
        loadAnthropicLiveModels(env, CLAUDE_FALLBACK_MODELS),
      ]);
      if (!fromCli) return fromApi;
      return fromApi ? mergeLiveModels(fromCli, fromApi) : fromCli;
    },
    // `claude --effort <level>`. The set differs from codex's on both ends — it
    // has `max` and has no `none`/`minimal` — so it is spelled out rather than
    // shared, and `CLAUDE_EFFORT_LEVELS` below is what `buildArgs` validates
    // against: a level carried over from another runtime's picker must not reach
    // the CLI, which would warn on stderr and silently fall back to the default.
    reasoningOptions: [
      // Spelled out rather than reusing DEFAULT_MODEL_OPTION: its label reads
      // "Default (CLI config)", which is right for a model row and wrong here.
      { id: 'default', label: 'Default' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
      { id: 'max', label: 'Max' },
    ],
    // Prompt delivered via stdin to avoid both Linux `spawn E2BIG`
    // (MAX_ARG_STRLEN caps a single argv entry at ~128 KB) and Windows
    // `spawn ENAMETOOLONG` (CreateProcess caps the full command line at
    // ~32 KB direct, ~8 KB via .cmd shim). `claude -p` with no positional
    // prompt reads the prompt from stdin under `--input-format text` (the
    // default), which has no length cap. Mirrors the codex/gemini/opencode/
    // cursor/qwen entries below.
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}, runtimeContext = {}) => {
      const caps = agentCapabilities.get('claude') || {};
      // `--input-format stream-json` lets the daemon stream multiple JSONL
      // messages into stdin instead of closing it after the initial prompt,
      // keeping the turn open so the daemon can stream further user messages
      // mid-conversation. Paired with `--output-format stream-json` so the
      // adapter parses structured events (see claude-stream.ts).
      const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
      // `--include-partial-messages` lands richer streaming events but only
      // exists in newer Claude Code builds. Older installs reject it with
      // "unknown option" and exit 1, killing the chat. Gate on the probe.
      if (caps.partialMessages) {
        args.push('--include-partial-messages');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      // `--effort` is newer than `--model`, so it gets the same probe gate as
      // `--include-partial-messages`: an older build rejects an unknown option
      // with exit 1, which kills the chat rather than degrading it.
      if (
        caps.effort
        && typeof options.reasoning === 'string'
        && CLAUDE_EFFORT_LEVELS.has(options.reasoning)
      ) {
        args.push('--effort', options.reasoning);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      // `--add-dir` is older but still gate it for symmetry — old/forked
      // builds may lack it.
      if (dirs.length > 0 && caps.addDir !== false) {
        args.push('--add-dir', ...dirs);
      }
      // `--append-system-prompt` delivery now lives outside this function — see
      // `systemPromptDelivery` below and `@jini-ai/daemon`'s `resolveSystemPromptOverlayDelivery`
      // (the single dispatch point for every def, not just this one). The probe-gate reasoning
      // (an older build rejects an unknown option with exit 1, which kills the chat rather than
      // degrading it) is preserved there via `capabilityKey: 'appendSystemPrompt'`, read from the
      // same `capabilityFlags` probe above — moving the *call site* changed nothing about the gate
      // itself.
      // Continue Claude's own CLI session across turns so it keeps its
      // working memory (files read, edits made, tool history) instead of
      // re-deriving everything from the rendered transcript each turn.
      // `--resume <id>` continues a stored session; `--session-id <uuid>`
      // starts a new one with an id the daemon controls and persists.
      if (typeof runtimeContext.resumeSessionId === 'string' && runtimeContext.resumeSessionId) {
        args.push('--resume', runtimeContext.resumeSessionId);
      } else if (typeof runtimeContext.newSessionId === 'string' && runtimeContext.newSessionId) {
        args.push('--session-id', runtimeContext.newSessionId);
      }
      // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
      // behavior) unless a caller explicitly opts into a restricted run.
      if (options.permissionMode !== 'restricted') {
        args.push('--permission-mode', 'bypassPermissions');
      }
      // Explicit `--strict-mcp-config --mcp-config <path>` instead of relying on Claude Code's
      // auto-discovery of `.mcp.json` from cwd. Shared with every other `'claude-mcp-json'` def —
      // see `buildClaudeMcpConfigArgs`'s own doc for why explicit, why strict, and why this is one
      // implementation rather than a copy per def. A no-op (`[]`) whenever the caller staged no
      // file, so a host that never configured MCP injection sees no argv change.
      args.push(...buildClaudeMcpConfigArgs(runtimeContext));
      // Finding 2 (SEC-assistant-env-isolation-2026-09-07): `RuntimeBuildOptions.disallowedTools`/
      // `allowedTools` are a `@jini-ai/agent-runtime`-level *mechanism* only — no product policy is
      // baked in here (see `types.ts`'s own doc on those fields). Verified against installed Claude
      // Code 2.1.263's own `-p --help`: `--disallowedTools, --disallowed-tools <tools...>` /
      // `--allowedTools, --allowed-tools <tools...>`. Placed last, after every other flag, so an
      // omitted (default) value is a true no-op — every existing call site that never passes these
      // options sees byte-identical argv to before this change.
      if (options.disallowedTools && options.disallowedTools.length > 0) {
        args.push('--disallowedTools', ...options.disallowedTools);
      }
      if (options.allowedTools && options.allowedTools.length > 0) {
        args.push('--allowedTools', ...options.allowedTools);
      }
      return args;
    },
    promptViaStdin: true,
    promptInputFormat: 'stream-json',
    streamFormat: 'claude-stream-json',
    // Claude Code auto-loads `.mcp.json` from the project cwd at spawn,
    // so the daemon writes the user's external MCP servers there before
    // launching (server.ts handles the cwd guard).
    externalMcpInjection: 'claude-mcp-json',
    // Formerly inline in `buildArgs` above (see the comment there) — moved to the declarative
    // shape every def now uses to receive `RuntimeBuildOptions.systemPromptOverlay`. Same flag,
    // same probe gate (`capabilityFlags['--append-system-prompt']` above), same "append, never
    // replace" behavior as before this moved.
    systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' },
    resumesSessionViaCli: true,
    // See this file's module doc's "Image delivery" section — the CLI reads
    // a local file once its path is named in the prompt, so the daemon
    // augments the prompt text and widens `extraAllowedDirs` on this def's
    // behalf rather than this file forwarding `_imagePaths` itself.
    imageDelivery: 'prompt-path',
} satisfies RuntimeAgentDef;
