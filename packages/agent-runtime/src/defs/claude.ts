/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/claude.ts` (import path adjusted only). See `source-map.md`. */
import { agentCapabilities } from '../capabilities.js';
import { DEFAULT_MODEL_OPTION } from './shared.js';
import { loadMmdRouteModels } from '../mmd-routes.js';
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

const CLAUDE_FALLBACK_MODELS = [
  DEFAULT_MODEL_OPTION,
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'haiku', label: 'Haiku (alias)' },
  { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
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
    },
    // `claude` has no list-models subcommand. Prefer local mmd/MMS routes
    // when present so proxy-backed Claude-compatible models appear in the
    // picker, then keep the built-in aliases as fallback hints.
    fallbackModels: CLAUDE_FALLBACK_MODELS,
    fetchModels: async (_resolvedBin, env) => loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS),
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
      // Explicit `--mcp-config` instead of relying on Claude Code's auto-discovery of `.mcp.json`
      // from cwd (which this def's `externalMcpInjection: 'claude-mcp-json'` was written to lean
      // on). Confirmed live (2026-07-30): auto-discovery requires an interactive trust prompt for
      // an untrusted project's MCP config, which a headless daemon-spawned child has no TTY to ever
      // answer — the MCP server connection sat at `"pending"` forever and none of its tools ever
      // reached the model, even though the daemon-side HTTP routes it proxies were confirmed
      // working. Passing the same config explicitly connected immediately. `--strict-mcp-config`
      // is paired with it deliberately, not just for symmetry: it also means Claude Code loads
      // ONLY this config, not whatever else an interactive user's own global/project `.mcp.json`
      // or `~/.claude.json` happens to define — closing the separate "spawned CLI inherits the
      // interactive developer's full MCP tool surface" leak this repo's own docs already flagged.
      // `runtimeContext.mcpJsonPath` is set only when `agent-executor.ts` is actually about to
      // write that file for this run (see its own doc) — absent otherwise, so a host that never
      // configured `mcpJsonInjection` sees no change in behavior.
      if (typeof runtimeContext.mcpJsonPath === 'string' && runtimeContext.mcpJsonPath) {
        args.push('--strict-mcp-config', '--mcp-config', runtimeContext.mcpJsonPath);
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
    resumesSessionViaCli: true,
} satisfies RuntimeAgentDef;
