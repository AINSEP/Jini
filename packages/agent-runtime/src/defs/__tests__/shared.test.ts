import { describe, expect, it } from 'vitest';
import {
  buildClaudeMcpConfigArgs,
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

describe('parseLineSeparatedModels', () => {
  it('returns just the default option for empty/nullish stdout', () => {
    expect(parseLineSeparatedModels({ stdout: '' })).toEqual([DEFAULT_MODEL_OPTION]);
    expect(parseLineSeparatedModels({ stdout: null as unknown as string })).toEqual([DEFAULT_MODEL_OPTION]);
    expect(parseLineSeparatedModels({ stdout: undefined as unknown as string })).toEqual([DEFAULT_MODEL_OPTION]);
  });

  it('parses one id per line, trims whitespace, skips blank lines and comment lines', () => {
    const stdout = 'anthropic/claude-sonnet-4-5\n# a comment\n\n  openai/gpt-5  \n';
    expect(parseLineSeparatedModels({ stdout: stdout })).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    ]);
  });

  it('de-dupes repeated ids while preserving first-seen order', () => {
    const stdout = 'a/b\nc/d\na/b';
    expect(parseLineSeparatedModels({ stdout: stdout })).toEqual([
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

  it('emits only --strict-mcp-config without a staged path when native tool access is off', () => {
    expect(buildClaudeMcpConfigArgs({}, { nativeToolAccess: false })).toEqual(['--strict-mcp-config']);
  });

  it('emits only --strict-mcp-config without a staged path when user MCP is locked', () => {
    expect(buildClaudeMcpConfigArgs({}, { nativeCapabilities: { userMcp: false } })).toEqual(['--strict-mcp-config']);
  });

  it('drops --strict-mcp-config for a trusted cli-parity bypass run with a staged path', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '/p/.mcp.json' }, { cliParity: true, permissionMode: 'bypass' })).toEqual(['--mcp-config', '/p/.mcp.json']);
  });

  it('keeps --strict-mcp-config for cli parity outside bypass mode', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '/p/.mcp.json' }, { cliParity: true, permissionMode: 'default' })).toEqual(['--strict-mcp-config', '--mcp-config', '/p/.mcp.json']);
  });

  it('keeps --strict-mcp-config for a cli-parity bypass run whose native tool access is off', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '/p/.mcp.json' }, { cliParity: true, permissionMode: 'bypass', nativeToolAccess: false })).toEqual(['--strict-mcp-config', '--mcp-config', '/p/.mcp.json']);
  });

  it('keeps --strict-mcp-config for a cli-parity bypass run whose user MCP is locked', () => {
    expect(buildClaudeMcpConfigArgs({ mcpJsonPath: '/p/.mcp.json' }, { cliParity: true, permissionMode: 'bypass', nativeCapabilities: { userMcp: false } })).toEqual(['--strict-mcp-config', '--mcp-config', '/p/.mcp.json']);
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
    const claudeArgs = claudeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: runtimeContext });
    const codebuddyArgs = codebuddyAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: runtimeContext });
    expect(mcpArgvOf(claudeArgs)).toEqual(buildClaudeMcpConfigArgs(runtimeContext));
    expect(mcpArgvOf(codebuddyArgs)).toEqual(mcpArgvOf(claudeArgs));
  });
});
