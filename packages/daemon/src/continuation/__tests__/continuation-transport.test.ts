import { describe, expect, it } from 'vitest';
import { AGENT_DEFS } from '@jini-ai/agent-runtime';
import { resolveContinuationTransport } from '../continuation-transport.js';

const MCP_CALLBACK_IDS = [
  'claude',
  'codebuddy',
  'devin',
  'kilo',
  'opencode',
  'mimo',
  'kimi',
  'kiro',
  'trae-cli',
  'hermes',
  'vibe',
  'reasonix',
].sort();

const STDIN_INJECTION_ONLY_IDS: string[] = [];

describe('resolveContinuationTransport', () => {
  it("resolves every def declaring externalMcpInjection to 'mcp-callback', including claude/codebuddy which also declare stream-json stdin", () => {
    const resolved = AGENT_DEFS.filter((def) => resolveContinuationTransport(def) === 'mcp-callback')
      .map((def) => def.id)
      .sort();
    expect(resolved).toEqual(MCP_CALLBACK_IDS);
  });

  it("resolves no def to 'stdin-injection' as primary, since claude/codebuddy (the only stream-json+promptViaStdin defs) both also declare externalMcpInjection", () => {
    const resolved = AGENT_DEFS.filter((def) => resolveContinuationTransport(def) === 'stdin-injection').map((def) => def.id);
    expect(resolved).toEqual(STDIN_INJECTION_ONLY_IDS);
  });

  it("resolves every remaining def (plain/text-stdin/argv/ACP-without-mcp) to 'none'", () => {
    const noneCount = AGENT_DEFS.filter((def) => resolveContinuationTransport(def) === 'none').length;
    expect(noneCount).toBe(AGENT_DEFS.length - MCP_CALLBACK_IDS.length - STDIN_INJECTION_ONLY_IDS.length);
  });

  it('does not misroute amp.ts into stdin-injection despite sharing claude-stream-json as its output streamFormat', () => {
    const amp = AGENT_DEFS.find((def) => def.id === 'amp');
    expect(amp).toBeDefined();
    expect(amp?.streamFormat).toBe('claude-stream-json');
    expect(amp?.promptInputFormat).not.toBe('stream-json');
    expect(resolveContinuationTransport(amp!)).toBe('none');
  });

  it('resolves a synthetic def with only promptInputFormat: stream-json + promptViaStdin (no externalMcpInjection) to stdin-injection', () => {
    const synthetic = {
      id: 'synthetic',
      name: 'Synthetic',
      bin: 'synthetic-bin',
      versionArgs: ['--version'],
      fallbackModels: [],
      buildArgs: () => [],
      streamFormat: 'claude-stream-json',
      eventParser: 'claude',
      promptViaStdin: true,
      promptInputFormat: 'stream-json',
    } as const;
    expect(resolveContinuationTransport(synthetic as never)).toBe('stdin-injection');
  });

  it('resolves a def with neither field to none', () => {
    const plain = AGENT_DEFS.find((def) => def.id === 'aider');
    expect(plain).toBeDefined();
    expect(resolveContinuationTransport(plain!)).toBe('none');
  });
});
