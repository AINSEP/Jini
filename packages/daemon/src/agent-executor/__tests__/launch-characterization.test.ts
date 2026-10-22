import { describe, expect, it, vi } from 'vitest';
import { createAgentRuntimeState } from '@jini-ai/agent-runtime';
import { buildAgentBuildArgsOptions, computeRuntimeContext, resolveSystemPromptOverlayDelivery } from '../launch.js';

describe('launch characterization before W5 extraction', () => {
  it.each([undefined, null, '', 'resume'])('combines staged paths with session identity %s', resumeSessionId => {
    const cleanup = vi.fn(async () => {});
    expect(computeRuntimeContext({
      preparedPromptFile: { path: '/scratch/prompt', cleanup },
      preparedLogFile: { path: '/scratch/log', cleanup },
      mcpBridge: { kind: 'claude-mcp-json', mcpJsonPath: '/scratch/mcp', serverEntry: { command: 'bridge', args: [], env: { JINI_RUN_ID: 'run-w5', JINI_DAEMON_URL: 'http://localhost' } } },
    }, { ...(resumeSessionId === undefined ? {} : { resumeSessionId }), newSessionId: 'new' })).toEqual({
      promptFilePath: '/scratch/prompt', agentLogFilePath: '/scratch/log', mcpJsonPath: '/scratch/mcp',
      ...(resumeSessionId ? { resumeSessionId } : {}), newSessionId: 'new',
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each(['', undefined])('omits an empty new session identity %s', newSessionId => {
    expect(computeRuntimeContext({ preparedPromptFile: null, preparedLogFile: null, mcpBridge: { kind: 'acp-merge', mcpServers: [] } }, { ...(newSessionId === undefined ? {} : { newSessionId }) })).toBeUndefined();
  });

  it.each([
    { permissionMode: 'restricted' as const, nativeToolAccess: true, cliParity: true },
    { permissionMode: 'bypass' as const, nativeToolAccess: false, cliParity: true },
    { permissionMode: 'bypass' as const, nativeToolAccess: true, cliParity: false },
    { permissionMode: 'bypass' as const, nativeToolAccess: true, cliParity: true },
  ])('keeps option presence and parity restrictions: %j', policy => {
    const input = { ...policy, model: '', reasoning: '', nativeCapabilities: {}, disallowedTools: [], allowedTools: [], settingSources: [], settings: '' };
    const { cliParity: _cliParity, ...forwarded } = input;
    const expected = policy.permissionMode === 'bypass' && policy.nativeToolAccess && policy.cliParity;
    expect(buildAgentBuildArgsOptions({ input, systemPromptOverlay: '' })).toEqual({ ...forwarded, ...(expected ? { cliParity: true } : {}), systemPromptOverlay: '' });
  });

  it('rejects an invalid permission mode before returning options', () => {
    const input = JSON.parse('{"permissionMode":"invalid"}') as { permissionMode: 'restricted' };
    expect(() => buildAgentBuildArgsOptions({ input, systemPromptOverlay: undefined })).toThrow('permissionMode must be restricted or bypass');
  });

  const base = { defId: 'fixture', systemPromptDelivery: undefined, resumesSessionViaCli: undefined, resumesSessionViaAcpLoad: undefined, overlay: 'rules', prompt: 'question', resumeSessionId: undefined };
  it.each([false, true, undefined])('append flags honor only explicit capability denial: %s', capability => {
    const state = createAgentRuntimeState({});
    state.capabilities.set('fixture', { ...(capability === undefined ? {} : { appendSystemPrompt: capability }) });
    expect(resolveSystemPromptOverlayDelivery({ ...base, systemPromptDelivery: { strategy: 'append-flag', flag: '--rules', capabilityKey: 'appendSystemPrompt' } }, { state }))
      .toEqual({ promptPrefix: '', prompt: 'question', extraArgs: capability === false ? [] : ['--rules', 'rules'], envOverrides: {} });
  });
  it.each([undefined, null, ''])('does not deliver an absent overlay: %s', overlay => {
    expect(resolveSystemPromptOverlayDelivery({ ...base, overlay })).toEqual({ promptPrefix: '', prompt: 'question', extraArgs: [], envOverrides: {} });
  });
  it('keeps declared delivery distinct from a resumed-session prefix fallback', () => {
    expect(resolveSystemPromptOverlayDelivery({ ...base, systemPromptDelivery: { strategy: 'append-flag', flag: '--rules' } }).extraArgs).toEqual(['--rules', 'rules']);
    expect(resolveSystemPromptOverlayDelivery({ ...base, systemPromptDelivery: { strategy: 'env-var', varName: 'RULES' }, resumesSessionViaCli: true, resumeSessionId: 'prior' }))
      .toEqual({ promptPrefix: '', prompt: 'question', extraArgs: [], envOverrides: { RULES: 'rules' } });
    expect(resolveSystemPromptOverlayDelivery({ ...base, systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'CONFIG' } }))
      .toEqual({ promptPrefix: '', prompt: 'question', extraArgs: [], envOverrides: {} });
    expect(resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaAcpLoad: true, resumeSessionId: 'prior' }).prompt).toBe('question');
    expect(resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaCli: true, resumeSessionId: '' }).prompt).toBe('rules\n\n---\n\nquestion');
    expect(resolveSystemPromptOverlayDelivery(base).prompt).toBe('rules\n\n---\n\nquestion');
  });
});
