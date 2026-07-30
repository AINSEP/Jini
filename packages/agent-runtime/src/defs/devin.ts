/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/devin.ts` (import path adjusted only). See `source-map.md`. */
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const devinAgentDef = {
    id: 'devin',
    name: 'Devin for Terminal',
    bin: 'devin',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: [
          '--permission-mode',
          'dangerous',
          '--respect-workspace-trust',
          'false',
          'acp',
        ],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    // Fallback aliases from Devin for Terminal docs
    // (https://cli.devin.ai/docs/models): `adaptive` appears in the config example;
    // `opus`, `sonnet`, `swe`, `codex`, `gemini`, and `gpt` are documented
    // as short model-family names / recommended picks.
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'adaptive', label: 'adaptive' },
      { id: 'swe', label: 'swe' },
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'codex', label: 'codex' },
      { id: 'gpt', label: 'gpt' },
      { id: 'gemini', label: 'gemini' },
    ],
    // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
    // behavior) unless a caller explicitly opts into a restricted run. Restricted drops
    // both overrides rather than substituting a different `--permission-mode` value, so
    // the CLI falls back to its own built-in default mode and to respecting workspace
    // trust — the conservative side of each flag, without this def having to name a
    // safe-mode string it cannot verify against the installed `devin` build.
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) =>
      options.permissionMode === 'restricted'
        ? ['acp']
        : ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
} satisfies RuntimeAgentDef;
