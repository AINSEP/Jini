import { describe, expect, it } from 'vitest';
import {
  buildClaudeMcpConfigArgs,
  clampCodexReasoning,
  parseLineSeparatedModels,
  detectAcpModels,
  parsePiModels,
  execAgentFile,
  DEFAULT_MODEL_OPTION,
} from '../shared.js';
import { claudeAgentDef } from '../claude.js';
import { codebuddyAgentDef } from '../codebuddy.js';

describe('shared re-exports', () => {
  it('re-exports the injected ports and helpers unchanged', () => {
    expect(typeof detectAcpModels).toBe('function');
    expect(typeof parsePiModels).toBe('function');
    expect(typeof execAgentFile).toBe('function');
    expect(DEFAULT_MODEL_OPTION).toEqual({ id: 'default', label: 'Default (CLI config)' });
  });
});

describe('clampCodexReasoning', () => {
  it('returns the effort unchanged (including falsy values) when effort is falsy', () => {
    expect(clampCodexReasoning('gpt-5.3', undefined)).toBeUndefined();
    expect(clampCodexReasoning('gpt-5.3', null)).toBeNull();
    expect(clampCodexReasoning('gpt-5.3', '')).toBe('');
  });

  it('treats a null/undefined modelId as the empty-id late-gpt5 family and clamps minimal to low', () => {
    expect(clampCodexReasoning(null, 'minimal')).toBe('low');
    expect(clampCodexReasoning(undefined, 'minimal')).toBe('low');
  });

  it('treats the literal "default" model id as the late-gpt5 family', () => {
    expect(clampCodexReasoning('default', 'minimal')).toBe('low');
  });

  it('strips a provider prefix before matching (e.g. "openai/gpt-5.2-foo")', () => {
    expect(clampCodexReasoning('openai/gpt-5.2-foo', 'minimal')).toBe('low');
  });

  it('clamps minimal to low for each late gpt-5.x family member (5.2 through 5.5)', () => {
    expect(clampCodexReasoning('gpt-5.2', 'minimal')).toBe('low');
    expect(clampCodexReasoning('gpt-5.3', 'minimal')).toBe('low');
    expect(clampCodexReasoning('gpt-5.4', 'minimal')).toBe('low');
    expect(clampCodexReasoning('gpt-5.5', 'minimal')).toBe('low');
  });

  it('does not clamp a late-family model when effort is not minimal', () => {
    expect(clampCodexReasoning('gpt-5.4', 'high')).toBe('high');
  });

  it('leaves a non-late-family, non-special model id untouched regardless of effort', () => {
    expect(clampCodexReasoning('gpt-4', 'minimal')).toBe('minimal');
    expect(clampCodexReasoning('gpt-5.1', 'minimal')).toBe('minimal');
  });

  it('promotes gpt-5.1 xhigh to high', () => {
    expect(clampCodexReasoning('gpt-5.1', 'xhigh')).toBe('high');
  });

  it('leaves gpt-5.1 with a non-xhigh effort untouched', () => {
    expect(clampCodexReasoning('gpt-5.1', 'high')).toBe('high');
    expect(clampCodexReasoning('gpt-5.1', 'low')).toBe('low');
  });

  it('caps gpt-5.1-codex-mini to high for high/xhigh effort', () => {
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'high')).toBe('high');
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'xhigh')).toBe('high');
  });

  it('caps gpt-5.1-codex-mini to medium for any other effort', () => {
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'medium')).toBe('medium');
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'low')).toBe('medium');
  });

  it('resolves gpt-5.1-codex-mini through a provider-prefixed id too', () => {
    expect(clampCodexReasoning('foo/gpt-5.1-codex-mini', 'high')).toBe('high');
  });
});

describe('parseLineSeparatedModels', () => {
  it('returns just the default option for empty/nullish stdout', () => {
    expect(parseLineSeparatedModels('')).toEqual([DEFAULT_MODEL_OPTION]);
    expect(parseLineSeparatedModels(null as unknown as string)).toEqual([DEFAULT_MODEL_OPTION]);
    expect(parseLineSeparatedModels(undefined as unknown as string)).toEqual([DEFAULT_MODEL_OPTION]);
  });

  it('parses one id per line, trims whitespace, skips blank lines and comment lines', () => {
    const stdout = 'anthropic/claude-sonnet-4-5\n# a comment\n\n  openai/gpt-5  \n';
    expect(parseLineSeparatedModels(stdout)).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    ]);
  });

  it('de-dupes repeated ids while preserving first-seen order', () => {
    const stdout = 'a/b\nc/d\na/b';
    expect(parseLineSeparatedModels(stdout)).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'a/b', label: 'a/b' },
      { id: 'c/d', label: 'c/d' },
    ]);
  });
});

describe('buildClaudeMcpConfigArgs', () => {
  it('emits --strict-mcp-config then --mcp-config <path> for a staged path', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '/work/proj/.mcp.json' })).toEqual([
      '--strict-mcp-config',
      '--mcp-config',
      '/work/proj/.mcp.json',
    ]);
  });

  it('emits nothing when no path was staged (the default for an unconfigured host)', () => {
    expect(buildClaudeMcpConfigArgs({})).toEqual([]);
  });

  it('emits nothing for an empty-string path rather than a dangling --mcp-config flag', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '' })).toEqual([]);
  });

  it('emits nothing for a non-string path a loosely-typed caller might pass', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: 42 as unknown as string })).toEqual([]);
  });

  // The point of extracting this helper: the two defs declaring `'claude-mcp-json'` must not drift
  // into two different MCP argv shapes. Asserting they emit identical MCP flags for identical input
  // is what makes a future copy-paste divergence fail here rather than in production.
  it('gives both claude-mcp-json defs byte-identical MCP argv for the same staged path', () => {
    const runtimeContext = { mcpJsonPath: '/work/proj/.mcp.json' };
    const mcpArgvOf = (args: string[]): string[] => args.slice(args.indexOf('--strict-mcp-config'));
    const claudeArgs = claudeAgentDef.buildArgs('hi', [], [], {}, runtimeContext);
    const codebuddyArgs = codebuddyAgentDef.buildArgs('hi', [], [], {}, runtimeContext);
    expect(mcpArgvOf(claudeArgs)).toEqual(buildClaudeMcpConfigArgs(runtimeContext));
    expect(mcpArgvOf(codebuddyArgs)).toEqual(mcpArgvOf(claudeArgs));
  });
});
