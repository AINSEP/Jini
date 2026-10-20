import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { opencodeAgentDef } from '../opencode.js';
import { DEFAULT_MODEL_OPTION, parseLineSeparatedModels } from '../shared.js';
import { cliOutputDiscoveryDeps, discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';

afterEach(() => {
  agentCapabilities.delete('opencode');
});

describe('opencodeAgentDef.buildArgs', () => {
  it('builds the base run/json argv with no capability flags, resume id, or model', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(['run', '--format', 'json']);
  });

  it('defaults options and runtimeContext to {} when omitted entirely', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [] })).toEqual(['run', '--format', 'json']);
  });

  it('defaults every optional argument when the second argument is omitted', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] })).toEqual(['run', '--format', 'json']);
  });

  it('honors host-scoped options.capabilities over an empty compatibility cache', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { options: { capabilities: { skipPermissions: true } } })).toEqual(['run', '--format', 'json', '--dangerously-skip-permissions']);
  });

  it('lets host-scoped options.capabilities withhold the flag the compatibility cache would grant', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { options: { capabilities: { skipPermissions: false } } })).toEqual(['run', '--format', 'json']);
  });

  it('adds the skip-permissions flag when the capability is recorded as enabled', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual([
      'run',
      '--format',
      'json',
      '--dangerously-skip-permissions',
    ]);
  });

  it('does not add the skip-permissions flag when permissionMode is "restricted", even if the CLI supports it', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { permissionMode: 'restricted' }, runtimeContext: {} })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('does not add the skip-permissions flag when the capability is recorded as disabled', () => {
    agentCapabilities.set('opencode', { skipPermissions: false });
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(['run', '--format', 'json']);
  });

  it('does not add the skip-permissions flag when no capabilities were ever recorded for opencode', () => {
    expect(agentCapabilities.has('opencode')).toBe(false);
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(['run', '--format', 'json']);
  });

  it('adds -s <id> when runtimeContext.resumeSessionId is a non-empty string', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { resumeSessionId: 'ses_123' } })).toEqual([
      'run',
      '--format',
      'json',
      '-s',
      'ses_123',
    ]);
  });

  it('omits -s when resumeSessionId is an empty string', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { resumeSessionId: '' } })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('omits -s when resumeSessionId is null', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { resumeSessionId: null } })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('omits -s when resumeSessionId is undefined', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).toEqual(['run', '--format', 'json']);
  });

  it('adds -m <model> when a non-default model is selected', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'openai/gpt-5' }, runtimeContext: {} })).toEqual([
      'run',
      '--format',
      'json',
      '-m',
      'openai/gpt-5',
    ]);
  });

  it('omits -m when the model is the literal string "default"', () => {
    expect(opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'default' }, runtimeContext: {} })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('composes all optional flags together in order', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    const args = opencodeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: { model: 'openai/gpt-5' }, runtimeContext: { resumeSessionId: 'ses_abc' } }
    );
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--dangerously-skip-permissions',
      '-s',
      'ses_abc',
      '-m',
      'openai/gpt-5',
    ]);
  });
});

describe('opencodeAgentDef shape', () => {
  it('declares the expected static metadata', () => {
    expect(opencodeAgentDef.id).toBe('opencode');
    expect(opencodeAgentDef.bin).toBe('opencode-cli');
    expect(opencodeAgentDef.fallbackBins).toEqual(['opencode']);
    expect(opencodeAgentDef.fallbackModels).toContainEqual(DEFAULT_MODEL_OPTION);
    // Pins the Claude entry to the current generation (see `claude.ts`'s
    // `CLAUDE_FALLBACK_MODELS`, the source of truth for which Anthropic id is
    // current) so this fallback doesn't silently go stale the way
    // `claude-sonnet-4-5` did.
    expect(opencodeAgentDef.fallbackModels.map((m) => m.id)).toContain('anthropic/claude-sonnet-5');
    expect(opencodeAgentDef.listModels?.parse).toBe(parseLineSeparatedModels);
    expect(opencodeAgentDef.promptViaStdin).toBe(true);
    expect(opencodeAgentDef.resumesSessionViaCli).toBe(true);
    expect(opencodeAgentDef.capturesSessionIdFromStream).toBe(true);
    expect(opencodeAgentDef.streamFormat).toBe('json-event-stream');
    expect(opencodeAgentDef.eventParser).toBe('opencode');
    expect(opencodeAgentDef.externalMcpInjection).toBe('opencode-env-content');
  });
});

describe('opencodeAgentDef.discoverModels', () => {
  it('falls back to the def\'s fallbackModels (minus the synthetic default) when the CLI is offline', async () => {
    const catalog = await opencodeAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models.map((model) => model.id)).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-5', 'google/gemini-2.5-pro']);
  });

  it('parses `opencode models` output through the def\'s own listModels parser', async () => {
    const catalog = await opencodeAgentDef.discoverModels({ context: discoveryContext }, { deps: cliOutputDiscoveryDeps('provider/a\nprovider/a\nprovider/b\n') });
    expect(catalog.freshness).toBe('fresh');
    expect(catalog.models.map((model) => model.id)).toEqual(['provider/a', 'provider/b']);
  });
});
