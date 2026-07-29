import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { opencodeAgentDef } from '../opencode.js';
import { DEFAULT_MODEL_OPTION, parseLineSeparatedModels } from '../shared.js';

afterEach(() => {
  agentCapabilities.delete('opencode');
});

describe('opencodeAgentDef.buildArgs', () => {
  it('builds the base run/json argv with no capability flags, resume id, or model', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(['run', '--format', 'json']);
  });

  it('defaults options and runtimeContext to {} when omitted entirely', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [])).toEqual(['run', '--format', 'json']);
  });

  it('adds the skip-permissions flag when the capability is recorded as enabled', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, {})).toEqual([
      'run',
      '--format',
      'json',
      '--dangerously-skip-permissions',
    ]);
  });

  it('does not add the skip-permissions flag when permissionMode is "restricted", even if the CLI supports it', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    expect(opencodeAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' }, {})).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('does not add the skip-permissions flag when the capability is recorded as disabled', () => {
    agentCapabilities.set('opencode', { skipPermissions: false });
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(['run', '--format', 'json']);
  });

  it('does not add the skip-permissions flag when no capabilities were ever recorded for opencode', () => {
    expect(agentCapabilities.has('opencode')).toBe(false);
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(['run', '--format', 'json']);
  });

  it('adds -s <id> when runtimeContext.resumeSessionId is a non-empty string', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'ses_123' })).toEqual([
      'run',
      '--format',
      'json',
      '-s',
      'ses_123',
    ]);
  });

  it('omits -s when resumeSessionId is an empty string', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: '' })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('omits -s when resumeSessionId is null', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: null })).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('omits -s when resumeSessionId is undefined', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], {}, {})).toEqual(['run', '--format', 'json']);
  });

  it('adds -m <model> when a non-default model is selected', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], { model: 'openai/gpt-5' }, {})).toEqual([
      'run',
      '--format',
      'json',
      '-m',
      'openai/gpt-5',
    ]);
  });

  it('omits -m when the model is the literal string "default"', () => {
    expect(opencodeAgentDef.buildArgs('hi', [], [], { model: 'default' }, {})).toEqual([
      'run',
      '--format',
      'json',
    ]);
  });

  it('composes all optional flags together in order', () => {
    agentCapabilities.set('opencode', { skipPermissions: true });
    const args = opencodeAgentDef.buildArgs(
      'hi',
      [],
      [],
      { model: 'openai/gpt-5' },
      { resumeSessionId: 'ses_abc' },
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
    expect(opencodeAgentDef.listModels?.parse).toBe(parseLineSeparatedModels);
    expect(opencodeAgentDef.promptViaStdin).toBe(true);
    expect(opencodeAgentDef.resumesSessionViaCli).toBe(true);
    expect(opencodeAgentDef.capturesSessionIdFromStream).toBe(true);
    expect(opencodeAgentDef.streamFormat).toBe('json-event-stream');
    expect(opencodeAgentDef.eventParser).toBe('opencode');
    expect(opencodeAgentDef.externalMcpInjection).toBe('opencode-env-content');
  });
});
