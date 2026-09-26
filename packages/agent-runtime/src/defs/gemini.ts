/**
 * @module defs/gemini
 *
 * Google's Gemini CLI (`gemini`, npm `@google/gemini-cli`). Checked against an installed
 * `gemini` 0.58.0 (`gemini --help` and the bundled headless code path) and the upstream headless
 * docs (<https://geminicli.com/docs/cli/headless>):
 *
 *   - Headless mode starts whenever stdin is not a TTY; the whole piped stdin becomes the prompt
 *     (`-p` is only needed to pass the prompt in argv, and would be "appended to input on stdin").
 *     So the prompt goes over stdin, like the Qwen Code fork, which avoids Windows `spawn
 *     ENAMETOOLONG` on large composed prompts.
 *   - `--output-format stream-json` emits the JSONL `init` / `message` / `tool_use` /
 *     `tool_result` / `error` / `result` events that `json-event-stream.ts`'s `gemini` parser
 *     already reads.
 *   - `--approval-mode yolo` auto-approves every tool (the `--yolo` alias does the same).
 *   - Since folder trust landed, a headless run in an untrusted directory exits with "Gemini CLI
 *     is not running in a trusted directory. To proceed, either use `--skip-trust`, …". The host
 *     already chose the run's cwd, so the def trusts it for this session only. Older builds
 *     reject unknown flags, so `--skip-trust` is gated on the `--help` capability probe.
 *   - `--include-directories` (repeatable) widens the workspace to dirs outside the cwd.
 *
 * Auth: since 2026-06-18 Google no longer serves Gemini CLI's "Login with Google" for free /
 * Google AI Pro / Ultra individual accounts (the run dies with `IneligibleTierError: This client
 * is no longer supported for Gemini Code Assist for individuals`). A Gemini API key, Vertex AI,
 * or a Gemini Code Assist license still works. There is no side-effect-free auth-status
 * subcommand, so no `authProbe`; `auth.ts#classifyAgentAuthFailure` turns the failure text into
 * setup guidance instead.
 */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import { agentCapabilities } from '../capabilities.js';
import type { RuntimeAgentDef } from '../types.js';

const SKIP_TRUST_FLAG = '--skip-trust';

export const geminiAgentDef = {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    // A cold `gemini --version` took 4.7 s on the dev machine (warm ~2 s), past the 3 s default.
    versionProbeTimeoutMs: 10_000,
    helpArgs: ['--help'],
    capabilityFlags: {
      [SKIP_TRUST_FLAG]: 'skipTrust',
    },
    // No `models` subcommand. `auto` and the concrete ids below are the ones the installed
    // 0.58.0 bundle and the upstream model docs name; any other id can still be typed in.
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'auto', label: 'auto' },
      { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
      { id: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
      { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    ],
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}) => {
      const args = ['--output-format', 'stream-json'];
      if (agentCapabilities.get('gemini')?.skipTrust) {
        args.push(SKIP_TRUST_FLAG);
      }
      // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
      // behavior) unless a caller explicitly opts into a restricted run.
      if (options.permissionMode !== 'restricted') {
        args.push('--approval-mode', 'yolo');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      for (const d of dirs) args.push('--include-directories', d);
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'gemini',
    // No `externalMcpInjection` yet: Gemini CLI reads `mcpServers` from `settings.json` (user,
    // project `.gemini/settings.json`, or a system file named by
    // `GEMINI_CLI_SYSTEM_SETTINGS_PATH`), with no per-run `--mcp-config` flag. A run-scoped
    // system-settings file is the likely strategy, but it is not wired or verified live.
} satisfies RuntimeAgentDef;
