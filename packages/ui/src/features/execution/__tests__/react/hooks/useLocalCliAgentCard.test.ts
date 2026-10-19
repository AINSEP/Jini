// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTestState, DetectedAgent } from '../../../types.js';
import { useLocalCliAgentCard, type UseLocalCliAgentCardInput } from '../../../react/hooks/useLocalCliAgentCard.js';

const AGENT: DetectedAgent = { id: 'claude', label: 'Claude Code', installed: true };
const IDLE: AgentTestState = { status: 'idle' };

function input(overrides: Partial<UseLocalCliAgentCardInput> = {}): UseLocalCliAgentCardInput {
  return {
    agent: AGENT,
    config: { agentId: 'claude' },
    agentTest: IDLE,
    cliEnvFields: [],
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
    t: (key) => `t:${key}`,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLocalCliAgentCard — model-list provenance', () => {
  it('labels a live list and explains it comes from the CLI', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agent: { ...AGENT, modelsSource: 'live' } })));
    expect(result.current).toMatchObject({
      source: 'live',
      sourceLabel: 't:Live from CLI',
      sourceHint: "t:Model list comes from this CLI. Default uses the CLI's own config.",
    });
  });

  it('labels a fallback list and points at Rescan', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agent: { ...AGENT, modelsSource: 'fallback' } })));
    expect(result.current).toMatchObject({
      source: 'fallback',
      sourceLabel: 't:Built-in list',
      sourceHint: 't:Showing built-in defaults. Click Rescan to pull live models from the CLI.',
    });
  });

  it('makes no provenance claim when the host did not say where the list came from', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input()));
    expect(result.current).toMatchObject({ source: undefined, sourceLabel: '', sourceHint: '' });
  });
});

describe('useLocalCliAgentCard — test state scoping', () => {
  it('reports testing only for the agent being probed', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agentTest: { status: 'testing', agentId: 'codex' } })));
    expect(result.current.testing).toBe(false);
  });

  it('drops a verdict that belongs to another agent', () => {
    const { result } = renderHook(() =>
      useLocalCliAgentCard(input({ agentTest: { status: 'error', agentId: 'codex', message: 'nope' } })),
    );
    expect(result.current.result).toBeNull();
  });

  it('keeps this agent\'s own verdict', () => {
    const agentTest: AgentTestState = { status: 'error', agentId: 'claude', message: 'nope' };
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agentTest })));
    expect(result.current.result).toEqual(agentTest);
  });
});

describe('useLocalCliAgentCard — diagnostic fix actions', () => {
  it('opens the install URL in a new, opener-free tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agent: { ...AGENT, installUrl: 'https://example.test/install' } })));
    result.current.diagnosticHandlers.onOpenInstall?.();
    expect(open).toHaveBeenCalledWith('https://example.test/install', '_blank', 'noopener,noreferrer');
  });

  it('opens the docs URL in a new, opener-free tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agent: { ...AGENT, docsUrl: 'https://example.test/docs' } })));
    result.current.diagnosticHandlers.onOpenDocs?.();
    expect(open).toHaveBeenCalledWith('https://example.test/docs', '_blank', 'noopener,noreferrer');
  });

  it('offers no open action for a URL the agent does not have', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input()));
    expect(result.current.diagnosticHandlers).toEqual({ onRescan: undefined, onOpenInstall: undefined, onOpenDocs: undefined });
  });
});

describe('useLocalCliAgentCard — stale reasoning pick', () => {
  it('clears a persisted effort the agent no longer offers, under this agent\'s id', () => {
    const onReasoningChange = vi.fn();
    renderHook(() =>
      useLocalCliAgentCard(
        input({
          agent: { ...AGENT, reasoningOptions: [{ id: 'high', label: 'High' }] },
          config: { agentId: 'claude', reasoningByAgentId: { claude: 'xhigh' } },
          onReasoningChange,
        }),
      ),
    );
    expect(onReasoningChange).toHaveBeenCalledWith('claude', '');
  });
});

describe('useLocalCliAgentCard — settings strip presence', () => {
  it('has nothing to show for a CLI with no models, effort, Test, verdict or env fields', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input()));
    expect(result.current.hasSettings).toBe(false);
  });

  it('shows the strip for a Test button alone', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input({ onTest: vi.fn() })));
    expect(result.current.hasSettings).toBe(true);
  });

  it('shows the strip for this agent\'s verdict alone', () => {
    const { result } = renderHook(() => useLocalCliAgentCard(input({ agentTest: { status: 'ok', agentId: 'claude' } })));
    expect(result.current.hasSettings).toBe(true);
  });

  it('shows the strip for this agent\'s env fields alone', () => {
    const { result } = renderHook(() =>
      useLocalCliAgentCard(input({ cliEnvFields: [{ agentId: 'claude', envKey: 'ANTHROPIC_BASE_URL', label: 'Base URL' }] })),
    );
    expect(result.current.hasSettings).toBe(true);
  });
});
