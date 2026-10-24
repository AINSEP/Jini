import { resolveNativeCapabilityDenies, resolveNativeToolDenies } from '../native-tool-policy.js';
import { claudeFilesystemSettings, validateFilesystemLaunch } from '../claude-filesystem-policy.js';
import { createAgentModelDiscovery } from '../model-discovery-native.js';
/**
 * Claude Code has no dedicated image-attachment flag. imageDelivery: 'prompt-path' makes the
 * executor append local image paths to the prompt and add their directories to extraAllowedDirs;
 * buildArgs then grants --add-dir access so the CLI can read them itself. Native-delivery defs
 * must not also receive this augmentation; see RuntimeAgentDef.imageDelivery for that contract.
 * A filesystemRoot launch instead validates these directories and omits --add-dir entirely;
 * hosts must stage attachments inside that root (owner boundary introduced 2026-10-23).
 */
import { addDirArgs, nonDefaultFlag, permissionModeArgs, resolveCapabilities, sessionArgs } from './claude-compatible-args.js';
import { buildClaudeMcpConfigArgs, DEFAULT_MODEL_OPTION } from './shared.js';
import { loadMmdRouteModels } from '../mmd-routes.js';
import { loadAnthropicLiveModels, mergeLiveModels } from '../anthropic-live-models.js';
import { loadClaudeCodeModels } from '../claude-code-models.js';
import type { RuntimeAgentDef, RuntimeBuildOptions, RuntimeCapabilityMap, RuntimeContext } from '../types.js';

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
 * Historically every live source was unioned on top of this list. Packaged hints are now
 * offline-only: successful native discovery can remove retired models.
 *
 * Ordered current-first, then the still-active-but-superseded generations, which are KEPT rather
 * than dropped — an installed CLI may be pinned to one via its own config, and removing a working
 * selection out from under a user is worse than listing it last.
 *
 * The current picker cache was rechecked on 2026-10-07; its four newer selectable IDs are
 * included first. The previous verification below still explains why older IDs remain.
 * Every older id below is verified present in the installed Claude Code binary's own embedded model
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
  // Current picker cache additions; older selectable IDs remain below for pinned installs.
  { id: 'claude-opus-5-5', label: 'claude-opus-5-5' },
  { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5' },
  { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
  { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5-20251001' },
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

// `--effort` is newer than `--model`, so it gets the same probe gate as
// `--include-partial-messages`: an older build rejects an unknown option
// with exit 1, which kills the chat rather than degrading it.
function claudeEffortArgs({ options, caps }: { options: RuntimeBuildOptions; caps: RuntimeCapabilityMap }): string[] {
  const reasoning = options.reasoning;
  return caps.effort && typeof reasoning === 'string' && CLAUDE_EFFORT_LEVELS.has(reasoning) ? ['--effort', reasoning] : [];
}

// Finding 2 (SEC-assistant-env-isolation-2026-09-07): `RuntimeBuildOptions.disallowedTools`/
// `allowedTools` are a `@jini-ai/agent-runtime`-level *mechanism* only — no product policy is
// baked in here (see `types.ts`'s own doc on those fields). Verified against installed Claude
// Code 2.1.263's own `-p --help`: `--disallowedTools, --disallowed-tools <tools...>` /
// `--allowedTools, --allowed-tools <tools...>`. Placed last, after every other flag, so an
// omitted (default) value is a true no-op — every existing call site that never passes these
// options sees byte-identical argv to before this change.
function claudeToolPolicyArgs(options: RuntimeBuildOptions): string[] {
  const deniedTools = resolveNativeCapabilityDenies({
    ...(options.nativeCapabilities !== undefined ? { capabilities: options.nativeCapabilities } : {}),
    denied: resolveNativeToolDenies({ enabled: options.nativeToolAccess,
      ...(options.disallowedTools !== undefined ? { denied: options.disallowedTools } : {}) }, {}) }, {});
  const allowedTools = options.allowedTools ?? [];
  return [
    ...(deniedTools.length > 0 ? ['--disallowedTools', ...deniedTools] : []),
    ...(allowedTools.length > 0 ? ['--allowedTools', ...allowedTools] : []),
  ];
}

// See `RuntimeBuildOptions.settingSources`. Probe-gated like `--effort`: an older build
// rejects an unknown option with exit 1, which would kill the chat rather than degrade it.
function claudeSettingSourcesArgs({ options, caps }: { options: RuntimeBuildOptions; caps: RuntimeCapabilityMap }): string[] {
  if (options.nativeCapabilities?.userSettings === false) {
    // This is an explicit restriction, not an optional enhancement: do not probe it away.
    return ['--setting-sources', '', '--disable-slash-commands'];
  }
  // An explicit empty source list is a host isolation policy, not an optional enhancement.
  if (options.filesystemRoot || options.settingSources?.length === 0) return ['--setting-sources', ''];
  if (options.settingSources !== undefined && caps.settingSources) {
    return ['--setting-sources', options.settingSources.join(',')];
  }
  return [];
}

// See `RuntimeBuildOptions.chromeIntegration`. Probe-gated like `--effort`: `--chrome`/`--no-chrome`
// are newer than `--model`, and an older build rejects an unknown option with exit 1, which would
// kill the chat rather than degrade it. Undefined emits nothing, so existing argv is unchanged.
function claudeChromeArgs({ options, caps }: { options: RuntimeBuildOptions; caps: RuntimeCapabilityMap }): string[] {
  if (options.chromeIntegration === undefined || !caps.chrome) return [];
  return [options.chromeIntegration ? '--chrome' : '--no-chrome'];
}

/** Resolve the mandatory filesystem settings as one launch fragment, independently of parity.
 * Native file reads keep today's tool set; outside attachment grants fail before argv exists.
 * O(n) containment checks for n attachment paths, plus host-settings serialization.
 */
function claudeLaunchPolicy({ options, caps, extraAllowedDirs, imagePaths, runtimeContext }: {
  options: RuntimeBuildOptions; caps: RuntimeCapabilityMap; extraAllowedDirs: readonly string[];
  imagePaths: readonly string[]; runtimeContext: RuntimeContext;
}, _optional = {}) {
  if (options.filesystemRoot !== undefined) {
    validateFilesystemLaunch({ filesystemRoot: options.filesystemRoot, cwd: runtimeContext.cwd ?? options.filesystemRoot,
      extraAllowedDirs, imagePaths }, {});
    return { directoryArgs: [], settingsArgs: ['--settings', claudeFilesystemSettings({ options }, {})] };
  }
  return { directoryArgs: addDirArgs({ extraAllowedDirs, caps }),
    settingsArgs: options.settings ? ['--settings', options.settings] : [] };
}

export const claudeAgentDef = {
  ...createAgentModelDiscovery('claude', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => claudeAgentDef.fallbackModels }),
    id: 'claude',
    supportsNativeToolAccess: true,
    // Native Task/Agent subagent tool (see `native-tool-policy.ts`'s `subagents` dimension).
    supportsSubagents: true,
    // `--chrome`/`--no-chrome` via `RuntimeBuildOptions.chromeIntegration` (see `claudeChromeArgs`).
    supportsChromeIntegration: true,
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
      '--setting-sources': 'settingSources',
      // Also matches `--no-chrome`; both ship together (Claude Code 2.1.307 `-p --help`).
      '--chrome': 'chrome',
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
    //      Successful discovery replaces packaged hints. The snapshot layer labels caches separately.
    //   3. The static list, when neither live source answers.
    //
    // Returning `null` from any step is "nothing to add", and `detection.ts#fetchModels` renders
    // `fallbackModels` for it in legacy callers. The required discovery port uses the shared
    // snapshot layer instead: configured routes are not proof of live availability.
    fallbackModels: CLAUDE_FALLBACK_MODELS,
    // Reasserted on 2026-10-07 against the local picker cache, retaining the previous
    // assertion against the installed Claude Code 2.1.261 binary's embedded model table and
    // `~/.claude.json`'s server-fetched `additionalModelOptionsCache`. See
    // `RuntimeAgentDef.fallbackModelsAssertedAt` and `scripts/check-model-fallback-freshness.ts`.
    fallbackModelsAssertedAt: '2026-10-07',
    fetchModels: async ({ resolvedBin, env }) => {
      const routed = await loadMmdRouteModels({ env: env, fallbackModels: [] });
      if (routed) return routed;
      const [fromCli, fromApi] = await Promise.all([
        loadClaudeCodeModels(resolvedBin, env, CLAUDE_FALLBACK_MODELS),
        loadAnthropicLiveModels({ env, fallbackModels: CLAUDE_FALLBACK_MODELS }),
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
      // "Default (CLI config)". Reasoning retains its Default option; model defaults now use
      // a pre-selected concrete entry, and never display that historical model label.
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
    // default), which has no length cap. Mirrors the codex/opencode/
    // cursor/qwen entries below.
    buildArgs: (_requiredArgs, { extraAllowedDirs = [], options = {}, runtimeContext = {} } = {}) => {
      const caps = resolveCapabilities({ agentId: 'claude', options });
      const policy = claudeLaunchPolicy({ options, caps, extraAllowedDirs, imagePaths: _requiredArgs.imagePaths, runtimeContext }, {});
      return [
        // `--input-format stream-json` lets the daemon stream multiple JSONL
        // messages into stdin instead of closing it after the initial prompt,
        // keeping the turn open so the daemon can stream further user messages
        // mid-conversation. Paired with `--output-format stream-json` so the
        // adapter parses structured events (see claude-stream.ts).
        '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        // `--include-partial-messages` lands richer streaming events but only
        // exists in newer Claude Code builds. Older installs reject it with
        // "unknown option" and exit 1, killing the chat. Gate on the probe.
        ...(caps.partialMessages ? ['--include-partial-messages'] : []),
        ...nonDefaultFlag({ flag: '--model', value: options.model }),
        ...claudeEffortArgs({ options, caps }),
        // `--add-dir` is older but still gate it for symmetry — old/forked
        // builds may lack it.
        ...policy.directoryArgs,
        // `--append-system-prompt` delivery now lives outside this function — see
        // `systemPromptDelivery` below and `@jini-ai/daemon`'s `resolveSystemPromptOverlayDelivery`
        // (the single dispatch point for every def, not just this one). The probe-gate reasoning
        // (an older build rejects an unknown option with exit 1, which kills the chat rather than
        // degrading it) is preserved there via `capabilityKey: 'appendSystemPrompt'`, read from the
        // same `capabilityFlags` probe above — moving the *call site* changed nothing about the gate
        // itself.
        // Continue Claude's own CLI session across turns (see `sessionArgs`).
        ...sessionArgs(runtimeContext),
        // The permission mode is unchanged for folder-limited runs: blockReadsOutsideWorkingDirectories
        // and the Bash sandbox hold in every mode, including bypassPermissions (verified live on
        // 2.1.309, 2026-10-23). dontAsk would deny Edit/Write and every MCP tool, because the CLI skips
        // an unanchored `--allowedTools '*'` (permissions docs, "Tool name wildcards").
        ...permissionModeArgs(options),
        // Explicit `--strict-mcp-config --mcp-config <path>` instead of relying on Claude Code's
        // auto-discovery of `.mcp.json` from cwd. Shared with every other `'claude-mcp-json'` def —
        // see `buildClaudeMcpConfigArgs`'s own doc for why explicit, why strict, and why this is one
        // implementation rather than a copy per def. A no-op (`[]`) whenever the caller staged no
        // file, so a host that never configured MCP injection sees no argv change.
        ...buildClaudeMcpConfigArgs(runtimeContext, options),
        ...claudeToolPolicyArgs(options),
        ...claudeSettingSourcesArgs({ options, caps }),
        // See `RuntimeBuildOptions.settings`. Not probe-gated: `--settings` long predates `--setting-sources`.
        ...policy.settingsArgs,
        ...claudeChromeArgs({ options, caps }),
      ];
    },
    promptViaStdin: true,
    promptInputFormat: 'stream-json',
    streamFormat: 'claude-stream-json',
    usageCostBasis: 'session',
    // Claude Code auto-loads `.mcp.json` from the project cwd at spawn,
    // so the daemon writes the user's external MCP servers there before
    // launching (server.ts handles the cwd guard).
    externalMcpInjection: 'claude-mcp-json',
    // Load MCP tools up front instead of deferring them behind the CLI's ToolSearch tool.
    // Deferral cost every run one extra model round (a `select:` ToolSearch call, ~3 s) before its
    // first real tool call, while the run's MCP set is only what the daemon stages
    // (`--strict-mcp-config`; 11 tools for the originating host), so loading it eagerly is cheap. Documented at
    // code.claude.com/docs/en/mcp ("`false` — All MCP tools loaded upfront, no deferral"); verified
    // in the installed 2.1.283 binary (a defined-falsy value selects the "standard" tool mode).
    // A default only: a run's own env can still set ENABLE_TOOL_SEARCH (see agent-executor).
    env: {
      ENABLE_TOOL_SEARCH: 'false',
      // 2026-10-10 plannie incident: the CLI stopped two background theme subagents ten minutes
      // after the reply ended. Installed Claude Code 2.1.296 confirms 0 waits indefinitely.
      // Complements the daemon's stdin hold while background tasks run (agent-executor/events.ts).
      // A default only: the host can override it through the run's explicit env passthrough.
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
    },
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
