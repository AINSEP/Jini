import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { codebuddyAgentDef } from '../codebuddy.js';

afterEach(() => {
  agentCapabilities.delete('codebuddy');
});

describe('codebuddyAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(codebuddyAgentDef.id).toBe('codebuddy');
    expect(codebuddyAgentDef.bin).toBe('codebuddy');
    expect(codebuddyAgentDef.fallbackBins).toEqual(['cbc']);
    expect(codebuddyAgentDef.promptViaStdin).toBe(true);
    expect(codebuddyAgentDef.promptInputFormat).toBe('stream-json');
    expect(codebuddyAgentDef.streamFormat).toBe('claude-stream-json');
    expect(codebuddyAgentDef.externalMcpInjection).toBe('claude-mcp-json');
    expect(codebuddyAgentDef.resumesSessionViaCli).toBe(true);
    expect(codebuddyAgentDef.reasoningOptions?.map((r) => r.id)).toEqual([
      'default',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(codebuddyAgentDef.fallbackModels[0]?.id).toBe('default');
  });
});

describe('codebuddyAgentDef.buildArgs', () => {
  it('produces the base argv with no capability flags, no model, no reasoning, no dirs, no session', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('adds --include-partial-messages only when the capability probe recorded partialMessages', () => {
    agentCapabilities.set('codebuddy', { partialMessages: true });
    const args = codebuddyAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--include-partial-messages');
  });

  it('omits --include-partial-messages when there is no capability entry at all', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('adds --model <id> for a concrete model selection', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], { model: 'glm-5.1-ioa' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('glm-5.1-ioa');
  });

  it('omits --model for the "default" sentinel and when falsy', () => {
    expect(codebuddyAgentDef.buildArgs('hi', [], [], { model: 'default' })).not.toContain('--model');
    expect(codebuddyAgentDef.buildArgs('hi', [], [], { model: '' })).not.toContain('--model');
  });

  it('adds --effort <level> for a concrete reasoning selection', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], { reasoning: 'high' });
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('omits --effort for the "default" sentinel and when falsy', () => {
    expect(codebuddyAgentDef.buildArgs('hi', [], [], { reasoning: 'default' })).not.toContain('--effort');
    expect(codebuddyAgentDef.buildArgs('hi', [], [], { reasoning: '' })).not.toContain('--effort');
    expect(codebuddyAgentDef.buildArgs('hi', [], [], {})).not.toContain('--effort');
  });

  it('adds --add-dir with all non-empty string dirs by default', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], ['/a', '', '/b']);
    const idx = args.indexOf('--add-dir');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['/a', '/b']);
  });

  it('omits --add-dir entirely when the filtered dirs list is empty', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], ['']);
    expect(args).not.toContain('--add-dir');
  });

  it('tolerates an explicit null extraAllowedDirs (the `|| []` fallback, distinct from the default param)', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], null as unknown as string[]);
    expect(args).not.toContain('--add-dir');
  });

  it('omits --add-dir when the capability probe explicitly recorded addDir: false, even with dirs present', () => {
    agentCapabilities.set('codebuddy', { addDir: false });
    const args = codebuddyAgentDef.buildArgs('hi', [], ['/a']);
    expect(args).not.toContain('--add-dir');
  });

  it('uses --resume <id> when runtimeContext.resumeSessionId is a non-empty string', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123');
    expect(args).not.toContain('--session-id');
  });

  it('uses --session-id <id> when resumeSessionId is absent but newSessionId is present', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], {}, { newSessionId: 'new-456' });
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('new-456');
  });

  it('emits neither --resume nor --session-id when both are absent', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('treats an empty-string resumeSessionId as absent', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: '' });
    expect(args).not.toContain('--resume');
  });

  it('treats an empty-string newSessionId as absent', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], {}, { newSessionId: '' });
    expect(args).not.toContain('--session-id');
  });

  it('always appends --permission-mode bypassPermissions as the trailing flag', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], { model: 'gpt-5.5' }, { resumeSessionId: 'x' });
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  it('omits --permission-mode bypassPermissions entirely when permissionMode is "restricted"', () => {
    const args = codebuddyAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('bypassPermissions');
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    expect(() => codebuddyAgentDef.buildArgs('hi', [])).not.toThrow();
  });
});
