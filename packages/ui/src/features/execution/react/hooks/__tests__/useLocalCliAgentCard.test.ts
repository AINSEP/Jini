import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_MODEL_SENTINEL } from '../../../constants.js';
import type { AgentCliEnvFieldSpec, AgentTestState, DetectedAgent } from '../../../types.js';
import { useLocalCliAgentCard, type UseLocalCliAgentCardInput } from '../useLocalCliAgentCard.js';

const agent: DetectedAgent = { id: 'local', label: 'Local CLI', installed: true };
const binaryField: AgentCliEnvFieldSpec = {
  agentId: agent.id, envKey: 'LOCAL_BIN', label: 'Binary', kind: 'binPath',
};

function renderCard(input: Partial<UseLocalCliAgentCardInput>, _options = {}) {
  const props: UseLocalCliAgentCardInput = {
    agent,
    config: { agentId: agent.id },
    agentTest: { status: 'idle' },
    cliEnvFields: [],
    onModelChange: vi.fn<(agentId: string, model: string) => void>(),
    onReasoningChange: vi.fn<(agentId: string, reasoning: string) => void>(),
    t: (key) => `translated:${key}`,
    ...input,
  };
  return { ...renderHook(() => useLocalCliAgentCard(props)), props };
}

afterEach(() => vi.restoreAllMocks());

describe('useLocalCliAgentCard characterization', () => {
  it.each([
    { source: 'live' as const, label: 'Live from CLI', hint: "Model list comes from this CLI. Default uses the CLI's own config." },
    { source: 'fallback' as const, label: 'Built-in list', hint: 'Showing built-in defaults. Click Rescan to pull live models from the CLI.' },
  ])('translates both source claims for $source', ({ source, label, hint }) => {
    const t = vi.fn((key: string) => `translated:${key}`);
    const { result } = renderCard({ agent: { ...agent, modelsSource: source }, t });
    expect(result.current.source).toBe(source);
    expect(result.current.sourceLabel).toBe(`translated:${label}`);
    expect(result.current.sourceHint).toBe(`translated:${hint}`);
    expect(t.mock.calls).toEqual([[label], [hint]]);
  });

  it('makes no provenance claim or translation call when the host omits the source', () => {
    const t = vi.fn((key: string) => key);
    const { result } = renderCard({ t });
    expect(result.current.source).toBeUndefined();
    expect(result.current.sourceLabel).toBe('');
    expect(result.current.sourceHint).toBe('');
    expect(t).not.toHaveBeenCalled();
  });

  const probeCases: { name: string; state: AgentTestState; testing: boolean; verdict: boolean }[] = [
    { name: 'idle', state: { status: 'idle' }, testing: false, verdict: false },
    { name: 'own pending probe', state: { status: 'testing', agentId: agent.id }, testing: true, verdict: false },
    { name: 'other pending probe', state: { status: 'testing', agentId: 'other' }, testing: false, verdict: false },
    { name: 'own success', state: { status: 'ok', agentId: agent.id }, testing: false, verdict: true },
    { name: 'other success', state: { status: 'ok', agentId: 'other' }, testing: false, verdict: false },
    { name: 'own failure', state: { status: 'error', agentId: agent.id, message: 'Unavailable' }, testing: false, verdict: true },
    { name: 'other failure', state: { status: 'error', agentId: 'other', message: 'Unavailable' }, testing: false, verdict: false },
  ];
  it.each(probeCases)('scopes the $name to this card', ({ state, testing, verdict }) => {
    const { result } = renderCard({ agentTest: state });
    expect(result.current.testing).toBe(testing);
    expect(result.current.result).toBe(verdict ? state : null);
    expect(result.current.hasSettings).toBe(verdict);
    expect(result.current.repair).toBeNull();
    expect(result.current.repairField).toBeNull();
  });

  it.each(['fallback-invalid', 'fallback-failed'] as const)('offers repair for a successful %s probe', (usedExecutableSource) => {
    const { result } = renderCard({
      agentTest: { status: 'ok', agentId: agent.id, usedExecutableSource, detectedExecutablePath: ' /opt/local/bin/agent ' },
      cliEnvFields: [binaryField, { ...binaryField, envKey: 'SECOND_BIN' }],
    });
    expect(result.current.repair).toEqual({ detectedPath: '/opt/local/bin/agent', canUseDetected: true });
    expect(result.current.repairField).toBe(binaryField);
  });

  const noRepairCases: { name: string; state: AgentTestState }[] = [
    { name: 'primary binary', state: { status: 'ok', agentId: agent.id, usedExecutableSource: 'primary', detectedExecutablePath: '/opt/agent' } },
    { name: 'unknown binary source', state: { status: 'ok', agentId: agent.id, detectedExecutablePath: '/opt/agent' } },
    { name: 'missing detected path', state: { status: 'ok', agentId: agent.id, usedExecutableSource: 'fallback-invalid' } },
    { name: 'blank detected path', state: { status: 'ok', agentId: agent.id, usedExecutableSource: 'fallback-failed', detectedExecutablePath: '  ' } },
    { name: 'other agent fallback', state: { status: 'ok', agentId: 'other', usedExecutableSource: 'fallback-invalid', detectedExecutablePath: '/opt/agent' } },
  ];
  it.each(noRepairCases)('offers no repair for $name', ({ state }) => {
    const { result } = renderCard({ agentTest: state, cliEnvFields: [binaryField] });
    expect(result.current.repair).toBeNull();
    expect(result.current.repairField).toBeNull();
  });

  it('keeps repair evidence but has no repair field without this agent’s binary override catalog', () => {
    const { result } = renderCard({
      agentTest: { status: 'ok', agentId: agent.id, usedExecutableSource: 'fallback-invalid', detectedExecutablePath: '/opt/agent' },
      cliEnvFields: [{ ...binaryField, agentId: 'other' }, { ...binaryField, kind: undefined }],
    });
    expect(result.current.repair).toEqual({ detectedPath: '/opt/agent', canUseDetected: true });
    expect(result.current.repairField).toBeNull();
  });

  it.each([
    { name: 'models', input: { agent: { ...agent, models: [{ id: 'model', label: 'Model' }] } } },
    { name: 'reasoning', input: { agent: { ...agent, reasoningOptions: [{ id: 'high', label: 'High' }] } } },
    { name: 'test button', input: { onTest: vi.fn() } },
    { name: 'own env field', input: { cliEnvFields: [binaryField] } },
  ])('shows settings for $name alone', ({ input }) => {
    const { result } = renderCard(input);
    expect(result.current.hasSettings).toBe(true);
  });

  it('ignores another agent’s env fields when deciding whether settings are empty', () => {
    const { result } = renderCard({ cliEnvFields: [{ ...binaryField, agentId: 'other' }] });
    expect(result.current.hasSettings).toBe(false);
  });

  it('opens diagnostic links with opener and referrer isolation and passes through rescan', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onRescan = vi.fn();
    const { result } = renderCard({
      agent: { ...agent, installUrl: 'https://example.test/install', docsUrl: 'https://example.test/docs' }, onRescan,
    });
    expect(result.current.diagnosticHandlers.onRescan).toBe(onRescan);
    result.current.diagnosticHandlers.onOpenInstall?.();
    result.current.diagnosticHandlers.onOpenDocs?.();
    expect(open.mock.calls).toEqual([
      ['https://example.test/install', '_blank', 'noopener,noreferrer'],
      ['https://example.test/docs', '_blank', 'noopener,noreferrer'],
    ]);
  });

  it('forwards an unchecked diagnostic URL scheme (reported, not fixed)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderCard({ agent: { ...agent, docsUrl: 'javascript:void(0)' } });
    result.current.diagnosticHandlers.onOpenDocs?.();
    expect(open).toHaveBeenCalledWith('javascript:void(0)', '_blank', 'noopener,noreferrer');
  });

  it('omits diagnostic handlers for absent or empty links', () => {
    const { result } = renderCard({ agent: { ...agent, installUrl: '', docsUrl: undefined } });
    expect(result.current.diagnosticHandlers).toEqual({ onRescan: undefined, onOpenInstall: undefined, onOpenDocs: undefined });
  });

  it('keeps the URL guard when an already-created handler sees a removed link', () => {
    const mutableAgent = { ...agent, installUrl: 'https://example.test/install' };
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderCard({ agent: mutableAgent });
    mutableAgent.installUrl = '';
    result.current.diagnosticHandlers.onOpenInstall?.();
    expect(open).not.toHaveBeenCalled();
  });

  it('enters Custom mode without persisting the sentinel and exits on a catalog pick', () => {
    const { result, props } = renderCard({ agent: { ...agent, models: [{ id: 'model', label: 'Model' }] } });
    expect(result.current.reasoning.customActive).toBe(false);
    act(() => result.current.selectModel(CUSTOM_MODEL_SENTINEL));
    expect(props.onModelChange).toHaveBeenLastCalledWith(agent.id, '');
    expect(result.current.reasoning.customActive).toBe(true);
    expect(result.current.reasoning.customModelInputValue).toBe('');
    act(() => result.current.selectModel('model'));
    expect(props.onModelChange).toHaveBeenLastCalledWith(agent.id, 'model');
    expect(result.current.reasoning.customActive).toBe(false);
  });

  it('persists flat reasoning independently', () => {
    const { result, props } = renderCard({ agent: { ...agent, reasoningOptions: [{ id: 'high', label: 'High' }] } });
    act(() => result.current.selectReasoning('high'));
    expect(props.onReasoningChange).toHaveBeenCalledTimes(1);
    expect(props.onReasoningChange).toHaveBeenLastCalledWith(agent.id, 'high');
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('routes suffix reasoning and base-model changes through the model callback', () => {
    const { result, props } = renderCard({
      agent: {
        ...agent,
        models: [{ id: 'base-low', label: 'Base (Low)' }, { id: 'base-high', label: 'Base (High)' }, { id: 'next-high', label: 'Next (High)' }],
        reasoningInModelId: { levels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] },
      },
      config: { agentId: agent.id, modelByAgentId: { [agent.id]: 'base-high' } },
    });
    act(() => result.current.selectReasoning('low'));
    expect(props.onModelChange).toHaveBeenLastCalledWith(agent.id, 'base-low');
    act(() => result.current.selectModel('next'));
    expect(props.onModelChange).toHaveBeenLastCalledWith(agent.id, 'next-high');
    expect(props.onReasoningChange).not.toHaveBeenCalled();
  });
});
