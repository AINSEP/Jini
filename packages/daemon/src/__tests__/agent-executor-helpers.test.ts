import { describe, expect, it, vi } from 'vitest';
import {
  applyAgentTranslationSideEffects,
  buildAgentBuildArgsOptions,
  computeChildEnv,
  computeRuntimeContext,
  extractUsageTokens,
  isStdinDrivenFormat,
  resolveRunEnv,
  spawnAgentChildProcess,
  type McpBridgeDelivery,
} from '../agent-executor.js';

// Pure/near-pure helpers extracted from `translateUsagePayload`, `wireAcpLifecycle`, and `run()`
// during the complexity refactor that brought `run()` from cyclomatic 63 / cognitive 49 down to the
// ≤10 gate. `agent-executor.test.ts`'s existing 246 characterization tests already exercise these
// paths end-to-end through `executor.run()`; these tests instead pin each extracted decision
// directly against its own inputs, including edge cases (null vs. undefined, empty collections,
// mismatched mcpBridge kinds) that are awkward to provoke through a full spawn.

describe('extractUsageTokens', () => {
  it('returns undefined for an undefined usage object', () => {
    expect(extractUsageTokens(undefined)).toBeUndefined();
  });

  it('returns undefined when neither token count is present', () => {
    expect(extractUsageTokens({})).toBeUndefined();
  });

  it('returns undefined when both token fields are non-numeric', () => {
    expect(extractUsageTokens({ input_tokens: 'seven', output_tokens: null })).toBeUndefined();
  });

  it('includes only input_tokens when only it is present', () => {
    expect(extractUsageTokens({ input_tokens: 7 })).toEqual({ input_tokens: 7 });
  });

  it('includes only output_tokens when only it is present', () => {
    expect(extractUsageTokens({ output_tokens: 4 })).toEqual({ output_tokens: 4 });
  });

  it('includes both when both are present', () => {
    expect(extractUsageTokens({ input_tokens: 7, output_tokens: 4 })).toEqual({ input_tokens: 7, output_tokens: 4 });
  });

  it('tolerates zero as a real value, not a falsy-omit', () => {
    expect(extractUsageTokens({ input_tokens: 0 })).toEqual({ input_tokens: 0 });
  });
});

describe('applyAgentTranslationSideEffects', () => {
  it('reports a captured sessionId when present', () => {
    const onSessionId = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'status', label: 'x' },
      'sess-1',
      { onSessionId, onToolCall: vi.fn(), onUserVisibleOutput: vi.fn() },
    );
    expect(onSessionId).toHaveBeenCalledWith('sess-1');
  });

  it('does not call onSessionId when sessionId is undefined', () => {
    const onSessionId = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'status', label: 'x' },
      undefined,
      { onSessionId, onToolCall: vi.fn(), onUserVisibleOutput: vi.fn() },
    );
    expect(onSessionId).not.toHaveBeenCalled();
  });

  it('reports a tool call for a tool_use payload', () => {
    const onToolCall = vi.fn();
    const onUserVisibleOutput = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'tool_use', id: 'c1', name: 'Bash', input: null },
      undefined,
      { onSessionId: vi.fn(), onToolCall, onUserVisibleOutput },
    );
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onUserVisibleOutput).not.toHaveBeenCalled();
  });

  it('reports user-visible output for a non-empty text_delta', () => {
    const onUserVisibleOutput = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'text_delta', delta: 'hi' },
      undefined,
      { onSessionId: vi.fn(), onToolCall: vi.fn(), onUserVisibleOutput },
    );
    expect(onUserVisibleOutput).toHaveBeenCalledTimes(1);
  });

  it('reports user-visible output for a non-empty thinking_delta', () => {
    const onUserVisibleOutput = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'thinking_delta', delta: 'hmm' },
      undefined,
      { onSessionId: vi.fn(), onToolCall: vi.fn(), onUserVisibleOutput },
    );
    expect(onUserVisibleOutput).toHaveBeenCalledTimes(1);
  });

  it('does not report user-visible output for an empty text_delta', () => {
    const onUserVisibleOutput = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'text_delta', delta: '' },
      undefined,
      { onSessionId: vi.fn(), onToolCall: vi.fn(), onUserVisibleOutput },
    );
    expect(onUserVisibleOutput).not.toHaveBeenCalled();
  });

  it('does not report a tool call or user-visible output for an unrelated payload type', () => {
    const onToolCall = vi.fn();
    const onUserVisibleOutput = vi.fn();
    applyAgentTranslationSideEffects(
      { type: 'thinking_start' },
      undefined,
      { onSessionId: vi.fn(), onToolCall, onUserVisibleOutput },
    );
    expect(onToolCall).not.toHaveBeenCalled();
    expect(onUserVisibleOutput).not.toHaveBeenCalled();
  });
});

describe('resolveRunEnv', () => {
  it('uses the caller-supplied env escape hatch verbatim when present', () => {
    const env = resolveRunEnv({ env: { PATH: '/bin', SECRET: 'x' } }, { HOME: '/root' });
    expect(env).toEqual({ PATH: '/bin', SECRET: 'x' });
  });

  it('drops undefined-valued entries from the caller-supplied env', () => {
    const env = resolveRunEnv({ env: { PATH: '/bin', GONE: undefined } }, {});
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('falls back to the baseline allowlist plus credentialEnv when env is omitted', () => {
    const env = resolveRunEnv({ credentialEnv: { ANTHROPIC_API_KEY: 'sk-1' } }, { PATH: '/bin', HOME: '/root', UNRELATED: 'x' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/root', ANTHROPIC_API_KEY: 'sk-1' });
  });

  it('never leaks a host env var outside the baseline allowlist when env is omitted', () => {
    const env = resolveRunEnv({}, { PATH: '/bin', SECRET_TOKEN: 'leak-me' });
    expect(env).not.toHaveProperty('SECRET_TOKEN');
  });
});

describe('computeChildEnv', () => {
  const spawnEnv = { PATH: '/bin' };

  it('returns spawnEnv unchanged when mcpBridge is null', () => {
    expect(computeChildEnv(spawnEnv, null)).toBe(spawnEnv);
  });

  it("returns spawnEnv unchanged when mcpBridge's kind is not 'env-content'", () => {
    const bridge: McpBridgeDelivery = { kind: 'acp-merge', mcpServers: [] };
    expect(computeChildEnv(spawnEnv, bridge)).toBe(spawnEnv);
  });

  it("merges the serialized config into the named env var for an 'env-content' bridge", () => {
    const bridge: McpBridgeDelivery = {
      kind: 'env-content',
      envVarName: 'OPENCODE_CONFIG_CONTENT',
      serverEntry: { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'r1', JINI_DAEMON_URL: 'http://x' } },
    };
    const result = computeChildEnv(spawnEnv, bridge);
    expect(result.PATH).toBe('/bin');
    expect(result.OPENCODE_CONFIG_CONTENT).toBeDefined();
    const parsed = JSON.parse(result.OPENCODE_CONFIG_CONTENT!);
    expect(parsed.mcp.jini.command).toEqual(['jini-mcp']);
  });

  it('does not mutate the input spawnEnv object', () => {
    const bridge: McpBridgeDelivery = {
      kind: 'env-content',
      envVarName: 'OPENCODE_CONFIG_CONTENT',
      serverEntry: { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'r1', JINI_DAEMON_URL: 'http://x' } },
    };
    const before = { ...spawnEnv };
    computeChildEnv(spawnEnv, bridge);
    expect(spawnEnv).toEqual(before);
  });
});

describe('computeRuntimeContext', () => {
  it('returns undefined when nothing was staged and no claude-mcp-json bridge exists', () => {
    expect(computeRuntimeContext(null, null, null)).toBeUndefined();
  });

  it('returns undefined for an acp-merge bridge with nothing else staged', () => {
    const bridge: McpBridgeDelivery = { kind: 'acp-merge', mcpServers: [] };
    expect(computeRuntimeContext(null, null, bridge)).toBeUndefined();
  });

  it('includes promptFilePath when a prompt file was staged', () => {
    const cleanup = vi.fn(async () => {});
    expect(computeRuntimeContext({ path: '/tmp/p.md', cleanup }, null, null)).toEqual({ promptFilePath: '/tmp/p.md' });
  });

  it('includes agentLogFilePath when a log file was staged', () => {
    const cleanup = vi.fn(async () => {});
    expect(computeRuntimeContext(null, { path: '/tmp/a.log', cleanup }, null)).toEqual({ agentLogFilePath: '/tmp/a.log' });
  });

  it("includes mcpJsonPath for a 'claude-mcp-json' bridge", () => {
    const bridge: McpBridgeDelivery = {
      kind: 'claude-mcp-json',
      mcpJsonPath: '/work/.mcp.jini-r1.json',
      serverEntry: { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'r1', JINI_DAEMON_URL: 'http://x' } },
    };
    expect(computeRuntimeContext(null, null, bridge)).toEqual({ mcpJsonPath: '/work/.mcp.jini-r1.json' });
  });

  it('combines all three fields when all three are present', () => {
    const promptCleanup = vi.fn(async () => {});
    const logCleanup = vi.fn(async () => {});
    const bridge: McpBridgeDelivery = {
      kind: 'claude-mcp-json',
      mcpJsonPath: '/work/.mcp.jini-r1.json',
      serverEntry: { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'r1', JINI_DAEMON_URL: 'http://x' } },
    };
    expect(computeRuntimeContext({ path: '/tmp/p.md', cleanup: promptCleanup }, { path: '/tmp/a.log', cleanup: logCleanup }, bridge)).toEqual({
      promptFilePath: '/tmp/p.md',
      agentLogFilePath: '/tmp/a.log',
      mcpJsonPath: '/work/.mcp.jini-r1.json',
    });
  });
});

describe('buildAgentBuildArgsOptions', () => {
  it('returns undefined when nothing was selected at all', () => {
    expect(buildAgentBuildArgsOptions({}, undefined)).toBeUndefined();
  });

  it('returns undefined when the overlay is null (an explicit "no overlay" signal, not just absent)', () => {
    expect(buildAgentBuildArgsOptions({}, null)).toBeUndefined();
  });

  it('includes only model when only model is selected', () => {
    expect(buildAgentBuildArgsOptions({ model: 'gpt-5' }, undefined)).toEqual({ model: 'gpt-5' });
  });

  it('includes only reasoning when only reasoning is selected', () => {
    expect(buildAgentBuildArgsOptions({ reasoning: 'high' }, undefined)).toEqual({ reasoning: 'high' });
  });

  it('includes only permissionMode when only it is selected', () => {
    expect(buildAgentBuildArgsOptions({ permissionMode: 'restricted' }, undefined)).toEqual({ permissionMode: 'restricted' });
  });

  it('includes only systemPromptOverlay when only it is present', () => {
    expect(buildAgentBuildArgsOptions({}, 'extra instructions')).toEqual({ systemPromptOverlay: 'extra instructions' });
  });

  it('combines every field when all four are present', () => {
    expect(buildAgentBuildArgsOptions({ model: 'gpt-5', reasoning: 'high', permissionMode: 'bypass' }, 'overlay text')).toEqual({
      model: 'gpt-5',
      reasoning: 'high',
      permissionMode: 'bypass',
      systemPromptOverlay: 'overlay text',
    });
  });
});

describe('isStdinDrivenFormat', () => {
  it('is false for acp-json-rpc', () => {
    expect(isStdinDrivenFormat('acp-json-rpc')).toBe(false);
  });

  it('is false for pi-rpc', () => {
    expect(isStdinDrivenFormat('pi-rpc')).toBe(false);
  });

  it('is true for every stdout-tailing format', () => {
    for (const format of ['claude-stream-json', 'json-event-stream', 'copilot-stream-json', 'qoder-stream-json', 'plain'] as const) {
      expect(isStdinDrivenFormat(format)).toBe(true);
    }
  });
});

describe('spawnAgentChildProcess', () => {
  it("returns {kind:'ok', child} with the spawned child when spawn succeeds", () => {
    const fakeChild = { pid: 123 } as never;
    const spawn = vi.fn(() => fakeChild);
    const result = spawnAgentChildProcess(
      { cwd: '/work', childEnv: { PATH: '/bin' }, invocation: { command: 'claude', args: ['-p'], windowsVerbatimArguments: false } },
      { spawn },
    );
    expect(result).toEqual({ kind: 'ok', child: fakeChild });
    expect(spawn).toHaveBeenCalledWith('claude', ['-p'], {
      cwd: '/work',
      env: { PATH: '/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: false,
    });
  });

  it("returns {kind:'error', error} without throwing when spawn throws synchronously", () => {
    const boom = new Error('EACCES');
    const spawn = vi.fn(() => {
      throw boom;
    });
    const result = spawnAgentChildProcess(
      { cwd: '/work', childEnv: {}, invocation: { command: 'claude', args: [], windowsVerbatimArguments: false } },
      { spawn },
    );
    expect(result).toEqual({ kind: 'error', error: boom });
  });

  it('calls spawn exactly once and returns synchronously (no microtask delay) — see its own doc on why this matters', () => {
    // A regression here (e.g. re-wrapping this in an `async function`) would not be caught by a
    // type checker: both a plain object and a resolved Promise satisfy the same call-site `await`.
    // Asserting the return value is not a thenable is the direct way to pin "this never returns a
    // Promise" as an observable contract.
    const spawn = vi.fn(() => ({ pid: 1 }) as never);
    const result = spawnAgentChildProcess(
      { cwd: '/work', childEnv: {}, invocation: { command: 'claude', args: [], windowsVerbatimArguments: false } },
      { spawn },
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('then');
  });
});
