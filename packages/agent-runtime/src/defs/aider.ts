/** Ported from OD's `apps/daemon/src/runtimes/defs/aider.ts` (one de-branded comment; see `source-map.md`). */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const aiderAgentDef = {
    id: 'aider',
    name: 'Aider',
    bin: 'aider',
    versionArgs: ['--version'],
    // Aider proxies to whatever LLM the user configures via `--model` and
    // routes through LiteLLM, so any concrete fallback list is necessarily
    // partial. These are the commonly recommended starting points from
    // aider.chat/docs; users can paste anything else through the custom-
    // model input. The id strings follow LiteLLM provider/model spelling
    // so Aider parses them without an extra `--provider` flag.
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'sonnet', label: 'sonnet' },
      // `gpt-4o` is stale — OpenAI's GPT-5.6 family replaced the old flagship/mini/nano naming
      // with named tiers (sol/terra/luna); `sol` is the flagship `gpt-4o` mapped to, bare (no
      // `openai/` prefix) to match this list's existing LiteLLM-provider-default spelling. See
      // `packages/ui/src/features/execution/constants.ts`'s OpenAI preset and
      // `scripts/check-model-fallback-freshness.ts`.
      { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
      { id: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
      { id: 'gemini/gemini-2.0-flash', label: 'gemini/gemini-2.0-flash' },
    ],
    // Asserted against `packages/ui/src/features/execution/constants.ts`'s current OpenAI preset
    // (gpt-5.6-sol/terra/luna). See `RuntimeAgentDef.fallbackModelsAssertedAt` and
    // `scripts/check-model-fallback-freshness.ts`.
    fallbackModelsAssertedAt: '2026-09-16',
    // Aider's one-shot mode requires the prompt as `--message <text>` on
    // argv; neither `--message` nor `--message-file` accept `-` as a stdin
    // sentinel (it is treated as a literal filename), so we cannot pipe
    // the prompt in the way qwen/gemini do. Mirror the DeepSeek TUI
    // pattern: ship the prompt as argv with a conservative byte budget so
    // the /api/chat spawn path emits an actionable error before hitting
    // Windows' ~32 KB CreateProcess limit or Linux MAX_ARG_STRLEN.
    //
    // The suppression flags are all there to keep aider runnable without
    // a TTY:
    //   --yes-always                       — skip per-action confirmation
    //   --no-pretty                        — strip ANSI so stdout parses as plain text
    //   --no-stream                        — left as default (streaming on)
    //   --no-git / --no-auto-commits       — the host spawns aider inside a
    //                                        managed project workspace that
    //                                        is not the user's git repo, so
    //                                        the commit machinery has
    //                                        nothing useful to do here
    //   --no-suggest-shell-commands        — avoids a follow-up interactive prompt
    //   --no-show-model-warnings           — suppresses model-compat banners
    //                                        that would otherwise prefix every
    //                                        run with noise
    buildArgs: (prompt, _imagePaths, _extra, options = {}) => {
      const args = [
        // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
        // behavior) unless a caller explicitly opts into a restricted run. Without
        // `--yes-always` aider asks for confirmation instead of auto-approving; on the
        // daemon's non-TTY stdin that fails the action closed rather than performing it,
        // which is the conservative outcome restricted mode is asking for.
        ...(options.permissionMode !== 'restricted' ? ['--yes-always'] : []),
        '--no-pretty',
        '--no-git',
        '--no-auto-commits',
        '--no-suggest-shell-commands',
        '--no-show-model-warnings',
      ];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      args.push('--message', prompt);
      return args;
    },
    maxPromptArgBytes: 30_000,
    streamFormat: 'plain',
    installUrl: 'https://aider.chat/docs/install.html',
    docsUrl: 'https://aider.chat',
    // No `externalMcpInjection`: Aider has no native MCP client. Its published
    // config reference (aider.chat/docs) documents no MCP options as of mid-2026,
    // and the upstream MCP-support pull requests were closed unmerged — there is
    // no `--mcp-config`-equivalent surface to write into. It proxies to whatever
    // LiteLLM-routed model the user configures for chat completions only; there
    // is nowhere for a bridged tool call to land. Revisit if upstream ships a
    // client.
} satisfies RuntimeAgentDef;
