import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { cursorAgentDef, parseCursorAgentModels } from '../cursor-agent.js';

afterEach(() => {
  agentCapabilities.delete('cursor-agent');
});

describe('cursorAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(cursorAgentDef.id).toBe('cursor-agent');
    expect(cursorAgentDef.bin).toBe('cursor-agent');
    expect(cursorAgentDef.streamFormat).toBe('json-event-stream');
    expect(cursorAgentDef.eventParser).toBe('cursor-agent');
    expect(cursorAgentDef.authProbe).toEqual({ args: ['status'], timeoutMs: 5000 });
    expect(cursorAgentDef.fallbackModels.map((m) => m.id)).toEqual([
      'default',
      'auto',
      'sonnet-4',
      'sonnet-4-thinking',
      'gpt-5',
    ]);
  });
});

describe('parseCursorAgentModels', () => {
  it('returns null for empty/whitespace-only stdout', () => {
    expect(parseCursorAgentModels('')).toBeNull();
    expect(parseCursorAgentModels('   \n  \n')).toBeNull();
  });

  it('skips a leading "Available models" / "models" header line, case-insensitively', () => {
    const result = parseCursorAgentModels('Available Models\nauto\nmodels\nsonnet-4');
    expect(result?.map((m) => m.id)).toEqual(['default', 'auto', 'sonnet-4']);
  });

  it('skips blank lines and comment lines', () => {
    const result = parseCursorAgentModels('\n# a comment\nauto\n\n');
    expect(result?.map((m) => m.id)).toEqual(['default', 'auto']);
  });

  it('parses "<id> - <label>" lines, trimming the label', () => {
    const result = parseCursorAgentModels('sonnet-4 -   Sonnet 4  ');
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'sonnet-4', label: 'Sonnet 4' },
    ]);
  });

  it('uses the id as the label when no " - label" suffix is present', () => {
    const result = parseCursorAgentModels('gpt-5');
    expect(result?.find((m) => m.id === 'gpt-5')).toEqual({ id: 'gpt-5', label: 'gpt-5' });
  });

  it('de-duplicates repeated ids, keeping the first occurrence', () => {
    const result = parseCursorAgentModels('auto - Auto\nauto - Auto again');
    expect(result?.filter((m) => m.id === 'auto')).toHaveLength(1);
    expect(result?.find((m) => m.id === 'auto')?.label).toBe('Auto');
  });

  it('skips lines that do not match the id pattern at all', () => {
    const result = parseCursorAgentModels('!!! not-a-valid-id-start\nauto');
    expect(result?.map((m) => m.id)).toEqual(['default', 'auto']);
  });

  it('returns null when every line is filtered out (only the synthetic default would remain)', () => {
    expect(parseCursorAgentModels('models\nAvailable models')).toBeNull();
  });
});

describe('cursorAgentDef.listModels.parse', () => {
  it('returns null when the CLI reports no models available for this account', () => {
    const result = cursorAgentDef.listModels!.parse('No models available for this account.');
    expect(result).toBeNull();
  });

  it('returns null for blank stdout', () => {
    expect(cursorAgentDef.listModels!.parse('   ')).toBeNull();
  });

  it('returns null for empty-string stdout (exercises the `stdout || \'\'` fallback)', () => {
    expect(cursorAgentDef.listModels!.parse('')).toBeNull();
  });

  it('delegates to parseCursorAgentModels for real output', () => {
    const result = cursorAgentDef.listModels!.parse('auto\nsonnet-4');
    expect(result?.map((m) => m.id)).toEqual(['default', 'auto', 'sonnet-4']);
  });
});

describe('cursorAgentDef.buildArgs', () => {
  it('produces the base argv with no --trust, no --workspace, no --model', () => {
    const args = cursorAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual(['--print', '--output-format', 'stream-json', '--stream-partial-output', '--force']);
  });

  it('adds --trust only when the capability probe recorded it', () => {
    agentCapabilities.set('cursor-agent', { trust: true });
    const args = cursorAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--trust');
  });

  it('omits --trust when the capability probe has not recorded it', () => {
    agentCapabilities.set('cursor-agent', { trust: false });
    const args = cursorAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--trust');
  });

  it('omits --trust when no capability entry exists at all for this agent id', () => {
    const args = cursorAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--trust');
  });

  it('omits --force entirely when permissionMode is "restricted"', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--force');
    expect(args).toEqual(['--print', '--output-format', 'stream-json', '--stream-partial-output']);
  });

  it('omits --trust in restricted mode even when the capability probe recorded it', () => {
    agentCapabilities.set('cursor-agent', { trust: true });
    const args = cursorAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--trust');
    expect(args).not.toContain('--force');
  });

  it('still emits --force (and --trust when probed) when permissionMode is explicitly "bypass"', () => {
    agentCapabilities.set('cursor-agent', { trust: true });
    const args = cursorAgentDef.buildArgs('hi', [], [], { permissionMode: 'bypass' });
    expect(args).toContain('--force');
    expect(args).toContain('--trust');
  });

  it('still adds --workspace and --model after omitting the bypass flags in restricted mode', () => {
    const args = cursorAgentDef.buildArgs(
      'hi',
      [],
      [],
      { permissionMode: 'restricted', model: 'gpt-5' },
      { cwd: '/proj' },
    );
    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--workspace',
      '/proj',
      '--model',
      'gpt-5',
    ]);
  });

  it('adds --workspace <cwd> when runtimeContext.cwd is set', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], {}, { cwd: '/proj' });
    expect(args).toContain('--workspace');
    expect(args[args.indexOf('--workspace') + 1]).toBe('/proj');
  });

  it('omits --workspace when runtimeContext.cwd is absent', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('--workspace');
  });

  it('adds --model <id> for a concrete model selection', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], { model: 'gpt-5' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5');
  });

  it('omits --model for the "default" sentinel', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--model');
  });

  it('omits --model when falsy', () => {
    const args = cursorAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--model');
  });

  it('defaults options and runtimeContext when omitted entirely', () => {
    expect(() => cursorAgentDef.buildArgs('hi', [], [])).not.toThrow();
  });
});