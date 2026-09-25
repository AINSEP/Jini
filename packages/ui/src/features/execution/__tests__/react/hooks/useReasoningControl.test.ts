import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_MODEL_SENTINEL } from '../../../constants.js';
import type { DetectedAgent, LocalCliConfig } from '../../../types.js';
import { useReasoningControl } from '../../../react/hooks/useReasoningControl.js';

const AGY_MODELS = [
  { id: 'default', label: 'Default (CLI config)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

const REASONING_IN_MODEL_ID = {
  levels: [
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' },
  ],
};

function agyAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    id: 'antigravity',
    label: 'Antigravity',
    installed: true,
    supportsCustomModel: false,
    models: AGY_MODELS,
    modelsSource: 'live',
    reasoningInModelId: REASONING_IN_MODEL_ID,
    ...overrides,
  };
}

// Mirrors codex-cli 0.153.4's live shape (see `RuntimeModelOption.reasoning`'s doc in
// `@jini-ai/agent-runtime`): `gpt-6-astra` offers a full ladder, `gpt-5.5` stops at `high`,
// `gpt-legacy` explicitly reports none, and `gpt-unlisted` says nothing model-specific at all.
const CODEX_MODELS = [
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    reasoning: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra High' },
    ],
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    reasoning: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
  },
  { id: 'gpt-legacy', label: 'GPT Legacy', reasoning: [] },
  { id: 'gpt-unlisted', label: 'GPT Unlisted' },
];

function codexAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    id: 'codex',
    label: 'Codex',
    installed: true,
    models: CODEX_MODELS,
    // Agent-wide union across every model this def has ever seen — today's pre-narrowing behavior,
    // now the fallback for a model with nothing model-specific to say (`gpt-unlisted`).
    reasoningOptions: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra High' },
    ],
    ...overrides,
  };
}

function claudeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-opus-4-6', label: 'Claude 3.7 Opus' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
    ],
    ...overrides,
  };
}

describe('useReasoningControl — flat reasoning options (flag-based)', () => {
  it('derives flat reasoning options and preserves models directly', () => {
    const agent = claudeAgent();
    const config: LocalCliConfig = { agentId: 'claude', reasoningByAgentId: { claude: 'high' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.modelGroups).toBeNull();
    expect(result.current.activeGroup).toBeNull();
    expect(result.current.activeLevel).toBeNull();
    expect(result.current.hasReasoning).toBe(true);
    expect(result.current.reasoningOptions).toEqual(agent.reasoningOptions);
    expect(result.current.reasoningValue).toBe('high');
    expect(result.current.reasoningDisabled).toBe(false);
    expect(result.current.allowCustomModel).toBe(true);
    expect(result.current.modelChoices).toEqual(agent.models);
    expect(result.current.selectValue).toBe('claude-sonnet-4-6');
    expect(result.current.resolveNextModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(result.current.resolveReasoningModelId('high')).toBeNull();
  });

  it('supports positional arguments (agent, config, explicitCustomMode)', () => {
    const agent = claudeAgent();
    const config: LocalCliConfig = { agentId: 'claude' };
    const { result } = renderHook(() => useReasoningControl(agent, config));

    expect(result.current.hasReasoning).toBe(true);
    expect(result.current.selectValue).toBe('claude-sonnet-4-6');
  });

  it('handles custom model mode for flag-based agents', () => {
    const agent = claudeAgent();
    const config: LocalCliConfig = { agentId: 'claude', modelByAgentId: { claude: 'custom-model-1' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config, explicitCustomMode: true }));

    expect(result.current.customActive).toBe(true);
    expect(result.current.selectValue).toBe(CUSTOM_MODEL_SENTINEL);
    expect(result.current.customModelInputValue).toBe('custom-model-1');
  });
});

describe('useReasoningControl — suffix-in-model-id reasoning', () => {
  it('groups models by base and strips qualifiers from base labels', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-high' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.modelGroups).not.toBeNull();
    expect(result.current.activeGroup?.baseId).toBe('gemini-3.1-pro');
    expect(result.current.activeLevel).toBe('high');
    expect(result.current.selectValue).toBe('gemini-3.1-pro');
    expect(result.current.hasReasoning).toBe(true);
    expect(result.current.reasoningOptions.map((opt) => opt.id)).toEqual(['high', 'low']);
    expect(result.current.reasoningValue).toBe('high');
    expect(result.current.allowCustomModel).toBe(false);

    const baseLabels = result.current.modelChoices.map((choice) => choice.label);
    expect(baseLabels).toEqual([
      'Default (CLI config)',
      'Gemini 3.8 Flash',
      'Gemini 3.1 Pro',
      'Claude Sonnet 4.6 (Thinking)',
      'GPT-OSS 120B',
    ]);
  });

  it('hides reasoning control for base model with no variants', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'claude-sonnet-4-6' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.activeGroup?.levels).toEqual([]);
    expect(result.current.hasReasoning).toBe(false);
    expect(result.current.reasoningOptions).toEqual([]);
  });

  it('disables reasoning control for base model with exactly one variant', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'gpt-oss-120b-medium' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.hasReasoning).toBe(true);
    expect(result.current.reasoningOptions.map((opt) => opt.id)).toEqual(['medium']);
    expect(result.current.reasoningDisabled).toBe(true);
    expect(result.current.reasoningValue).toBe('medium');
  });

  it('carries active level over to new base model when supported', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-low' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.resolveNextModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-low');
  });

  it('falls back to a valid level on the target base when current level is not supported', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.8-flash-medium' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    // gemini-3.1-pro has only high and low; carrying medium must fall back to high, not compose gemini-3.1-pro-medium
    expect(result.current.resolveNextModelId('gemini-3.1-pro')).toBe('gemini-3.1-pro-high');
  });

  it('resolves model ID when reasoning level is picked', () => {
    const agent = agyAgent();
    const config: LocalCliConfig = { agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-high' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.resolveReasoningModelId('low')).toBe('gemini-3.1-pro-low');
  });
});

describe('useReasoningControl — per-model reasoning narrowing (flat reasoning options)', () => {
  it('falls back to the agent-wide union when the selected model reports no per-model data (undefined)', () => {
    const agent = codexAgent();
    const config: LocalCliConfig = { agentId: 'codex', modelByAgentId: { codex: 'gpt-unlisted' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    // A model whose catalog row carries no `reasoning` field at all is NOT the same as one that
    // reports zero levels — this is the one case that must still show every level the agent-level
    // union declares, or every pre-existing Claude/Codex-fallback agent would regress to nothing.
    expect(result.current.reasoningOptions).toEqual(agent.reasoningOptions);
    expect(result.current.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(result.current.hasReasoning).toBe(true);
  });

  it('hides the control when the selected model explicitly reports zero reasoning levels', () => {
    const agent = codexAgent();
    const config: LocalCliConfig = { agentId: 'codex', modelByAgentId: { codex: 'gpt-legacy' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    // If an explicit `[]` fell back to the union like `undefined` does, this model would still show
    // every level the agent has ever offered — the exact bug this narrowing exists to fix, one layer
    // down. `toEqual([])` (not just falsy/empty-ish) proves the model's own list, not some default,
    // won.
    expect(result.current.reasoningOptions).toEqual([]);
    expect(result.current.hasReasoning).toBe(false);
  });

  it("narrows to the selected model's own, smaller reasoning list", () => {
    const agent = codexAgent();
    const config: LocalCliConfig = { agentId: 'codex', modelByAgentId: { codex: 'gpt-5.5' } };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    // A test that only checked "some options render" would pass even if the union leaked through —
    // asserting the exact narrowed set, and that the agent-wide-only `xhigh` is absent, is what
    // actually proves narrowing happened rather than a coincidental non-empty list.
    expect(result.current.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high']);
    expect(result.current.reasoningOptions.map((option) => option.id)).not.toContain('xhigh');
    expect(result.current.hasReasoning).toBe(true);
  });

  it('falls back to the agent-wide union (not a hidden control) when the agent has no model list at all', () => {
    // `agent.reasoningOptions` alone (no `models`) is an existing, still-supported shape — an agent
    // with a reasoning axis but nothing to narrow by. Per-model narrowing must not regress it: with no
    // model to look up, `selectedModelReasoning` is `undefined`, which reads as "unknown" and falls
    // back to the union, exactly like it did before this field existed.
    const agent = codexAgent({ models: [] });
    const config: LocalCliConfig = { agentId: 'codex' };
    const { result } = renderHook(() => useReasoningControl({ agent, config }));

    expect(result.current.hasModels).toBe(false);
    expect(result.current.reasoningOptions).toEqual(agent.reasoningOptions);
    expect(result.current.hasReasoning).toBe(true);
  });

  it('re-derives reasoning options when the selected model changes', () => {
    const agent = codexAgent();
    const initialConfig: LocalCliConfig = { agentId: 'codex', modelByAgentId: { codex: 'gpt-6-astra' } };
    const { result, rerender } = renderHook(
      ({ config }: { config: LocalCliConfig }) => useReasoningControl({ agent, config }),
      { initialProps: { config: initialConfig } },
    );

    expect(result.current.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high', 'xhigh']);

    rerender({ config: { agentId: 'codex', modelByAgentId: { codex: 'gpt-legacy' } } });

    expect(result.current.reasoningOptions).toEqual([]);
    expect(result.current.hasReasoning).toBe(false);
  });

  it('clears an unsupported persisted effort when switching to a model that does not support it', () => {
    const agent = codexAgent();
    const onReasoningChange = vi.fn();
    const initialConfig: LocalCliConfig = {
      agentId: 'codex',
      modelByAgentId: { codex: 'gpt-6-astra' },
      reasoningByAgentId: { codex: 'xhigh' },
    };
    const { result, rerender } = renderHook(
      ({ config }: { config: LocalCliConfig }) => useReasoningControl({ agent, config, onReasoningChange }),
      { initialProps: { config: initialConfig } },
    );

    expect(result.current.reasoningValue).toBe('xhigh');
    expect(onReasoningChange).not.toHaveBeenCalled();

    rerender({
      config: {
        agentId: 'codex',
        modelByAgentId: { codex: 'gpt-5.5' },
        // The persisted pick is left as-is on the config passed in — proving the CLEAR is something
        // this hook actively requests via `onReasoningChange`, not something that happens by itself.
        reasoningByAgentId: { codex: 'xhigh' },
      },
    });

    expect(onReasoningChange).toHaveBeenCalledTimes(1);
    expect(onReasoningChange).toHaveBeenCalledWith('');
    // Even before a host applies that clear and re-renders with it, the stale id must never be what
    // actually renders as selected — a test that stopped at "onReasoningChange was called" would
    // still pass if the `<select>` kept showing the unsupported value in the meantime.
    expect(result.current.reasoningValue).not.toBe('xhigh');
    expect(result.current.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high']);
  });

  it('does not clear anything when the persisted effort is still supported after the model change', () => {
    const agent = codexAgent();
    const onReasoningChange = vi.fn();
    const initialConfig: LocalCliConfig = {
      agentId: 'codex',
      modelByAgentId: { codex: 'gpt-6-astra' },
      reasoningByAgentId: { codex: 'medium' },
    };
    const { rerender } = renderHook(
      ({ config }: { config: LocalCliConfig }) => useReasoningControl({ agent, config, onReasoningChange }),
      { initialProps: { config: initialConfig } },
    );

    rerender({
      config: {
        agentId: 'codex',
        modelByAgentId: { codex: 'gpt-5.5' },
        reasoningByAgentId: { codex: 'medium' },
      },
    });

    expect(onReasoningChange).not.toHaveBeenCalled();
  });
});
