import { createAgentModelDiscovery } from '../model-discovery-native.js';
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const devinAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('devin', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => devinAgentDef.fallbackModels }),
    id: 'devin',
    name: 'Devin for Terminal',
    bin: 'devin',
    versionArgs: ['--version'],
    fetchModels: acpModelFetcher({ args: [
      '--permission-mode',
      'dangerous',
      '--respect-workspace-trust',
      'false',
      'acp',
    ] }),
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
    buildArgs: ({ prompt: _prompt, imagePaths: _imagePaths }, { extraAllowedDirs: _extra, options = {} } = {}) =>
      options.permissionMode === 'restricted'
        ? ['acp']
        : ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
