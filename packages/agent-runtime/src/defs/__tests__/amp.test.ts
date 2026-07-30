import { describe, expect, it } from 'vitest';
import { ampAgentDef } from '../amp.js';

describe('ampAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(ampAgentDef.id).toBe('amp');
    expect(ampAgentDef.bin).toBe('amp');
    expect(ampAgentDef.promptViaStdin).toBe(true);
    expect(ampAgentDef.streamFormat).toBe('claude-stream-json');
    expect(ampAgentDef.supportsCustomModel).toBe(false);
    expect(ampAgentDef.fallbackModels.map((m) => m.id)).toEqual(['default', 'smart', 'deep', 'rush']);
  });
});

describe('ampAgentDef.buildArgs', () => {
  it('omits --mode when no options are passed at all', () => {
    const args = ampAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual(['-x', '--stream-json', '--dangerously-allow-all']);
  });

  it('omits --mode when options.model is the synthetic "default" sentinel', () => {
    const args = ampAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--mode');
  });

  it('omits --mode when options.model is falsy', () => {
    const args = ampAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--mode');
  });

  it('omits --mode when options.model is not one of the recognized Amp modes', () => {
    const args = ampAgentDef.buildArgs('hi', [], [], { model: 'not-a-real-mode' });
    expect(args).not.toContain('--mode');
  });

  it.each(['smart', 'deep', 'rush'])('includes --mode %s for a recognized mode', (mode) => {
    const args = ampAgentDef.buildArgs('hi', [], [], { model: mode });
    expect(args).toContain('--mode');
    expect(args[args.indexOf('--mode') + 1]).toBe(mode);
  });

  it('ignores prompt/imagePaths/extraAllowedDirs (all delivered via stdin or unused)', () => {
    const args = ampAgentDef.buildArgs('the actual prompt', ['/img.png'], ['/extra/dir'], { model: 'deep' });
    expect(args).not.toContain('the actual prompt');
    expect(args).not.toContain('/img.png');
    expect(args).not.toContain('/extra/dir');
  });

  it('defaults extraAllowedDirs and options when omitted entirely', () => {
    expect(() => ampAgentDef.buildArgs('hi', [])).not.toThrow();
  });

  it('omits --dangerously-allow-all entirely when permissionMode is "restricted"', () => {
    const args = ampAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--dangerously-allow-all');
    expect(args).toEqual(['-x', '--stream-json']);
  });

  it('still emits --dangerously-allow-all when permissionMode is explicitly "bypass"', () => {
    expect(ampAgentDef.buildArgs('hi', [], [], { permissionMode: 'bypass' })).toEqual([
      '-x',
      '--stream-json',
      '--dangerously-allow-all',
    ]);
  });

  it('still maps a recognized mode onto --mode after omitting the bypass flag in restricted mode', () => {
    const args = ampAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted', model: 'deep' });
    expect(args).toEqual(['-x', '--stream-json', '--mode', 'deep']);
  });
});
