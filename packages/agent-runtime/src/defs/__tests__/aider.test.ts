import { describe, expect, it } from 'vitest';
import { aiderAgentDef } from '../aider.js';

describe('aiderAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(aiderAgentDef.id).toBe('aider');
    expect(aiderAgentDef.bin).toBe('aider');
    expect(aiderAgentDef.streamFormat).toBe('plain');
    expect(aiderAgentDef.maxPromptArgBytes).toBe(30_000);
    expect(Array.isArray(aiderAgentDef.fallbackModels)).toBe(true);
    expect(aiderAgentDef.fallbackModels.some((m) => m.id === 'default')).toBe(true);
  });
});

describe('aiderAgentDef.buildArgs', () => {
  it('omits --model when no options are passed at all', () => {
    const args = aiderAgentDef.buildArgs('hello world', [], []);
    expect(args).not.toContain('--model');
    expect(args).toEqual([
      '--yes-always',
      '--no-pretty',
      '--no-git',
      '--no-auto-commits',
      '--no-suggest-shell-commands',
      '--no-show-model-warnings',
      '--message',
      'hello world',
    ]);
  });

  it('omits --model when options.model is the synthetic "default" sentinel', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--model');
  });

  it('omits --model when options.model is falsy (empty string)', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--model');
  });

  it('includes --model <id> when a concrete model is selected', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('always appends --message <prompt> as the final two argv entries', () => {
    const args = aiderAgentDef.buildArgs('the prompt text', [], [], { model: 'gpt-4o' });
    expect(args.slice(-2)).toEqual(['--message', 'the prompt text']);
  });

  it('ignores imagePaths and extraAllowedDirs (unused positional args)', () => {
    const args = aiderAgentDef.buildArgs('hi', ['/img.png'], ['/extra/dir'], { model: 'sonnet' });
    expect(args).not.toContain('/img.png');
    expect(args).not.toContain('/extra/dir');
  });

  it('omits --yes-always entirely when permissionMode is "restricted"', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--yes-always');
    expect(args).toEqual([
      '--no-pretty',
      '--no-git',
      '--no-auto-commits',
      '--no-suggest-shell-commands',
      '--no-show-model-warnings',
      '--message',
      'hi',
    ]);
  });

  it('still emits --yes-always when permissionMode is explicitly "bypass"', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { permissionMode: 'bypass' });
    expect(args).toContain('--yes-always');
  });

  it('still adds --model and --message after omitting --yes-always in restricted mode', () => {
    const args = aiderAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted', model: 'sonnet' });
    expect(args).not.toContain('--yes-always');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args.slice(-2)).toEqual(['--message', 'hi']);
  });
});
