import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalCliAgentSettings, type LocalCliAgentSettingsProps } from '../LocalCliAgentSettings.js';
import { useLocalCliAgentCard } from '../../hooks/useLocalCliAgentCard.js';

function settingsProps(required: Partial<LocalCliAgentSettingsProps>, _options = {}): LocalCliAgentSettingsProps {
  const agent = { id: 'other', label: 'Other CLI', installed: true };
  const config = { agentId: 'other' };
  const onModelChange = vi.fn();
  const { result } = renderHook(() => useLocalCliAgentCard({ agent, config, onModelChange,
    agentTest: { status: 'idle' }, cliEnvFields: [], onReasoningChange: vi.fn(), t: (key) => key }));
  return { agent, config, card: result.current, onModelChange, onEnvChange: vi.fn(), cliEnvFields: [], ...required };
}

describe('LocalCliAgentSettings characterization', () => {
  it('renders an empty controls row without model, effort, result or repair affordances', () => {
    const props = settingsProps({});
    const { container } = render(<LocalCliAgentSettings {...props} />);
    expect(screen.getByRole('group', { name: 'Other CLI' })).toHaveAttribute('data-testid', 'jini-agent-settings-other');
    expect(container.querySelector('.jini-agent-settings-row')).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Use detected path')).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps source claims and the Custom option conditional (%s)', (enabled) => {
    const props = settingsProps({ agentHandle: enabled ? 'settings-other' : undefined });
    props.card = { ...props.card, source: enabled ? 'live' : undefined,
      sourceLabel: enabled ? 'Live from CLI' : '', sourceHint: enabled ? 'Host provenance' : '', selectModel: vi.fn(),
      reasoning: { ...props.card.reasoning, hasModels: true, allowCustomModel: enabled,
        modelChoices: [{ id: 'm', label: 'Model M' }], selectValue: 'm' } };
    render(<LocalCliAgentSettings {...props} />);
    expect(screen.queryByText('Live from CLI') !== null).toBe(enabled);
    expect(screen.queryByText('Host provenance') !== null).toBe(enabled);
    expect(screen.getByTestId('jini-agent-model-other').getAttribute('data-agent-element'))
      .toBe(enabled ? 'settings-other-model' : null);
    fireEvent.click(within(screen.getByTestId('jini-agent-model-other')).getByRole('combobox'));
    expect(screen.queryByText('Custom…') !== null).toBe(enabled);
    fireEvent.click(screen.getByRole('option', { name: 'Model M' }));
    expect(props.card.selectModel).toHaveBeenCalledTimes(1);
    expect(props.card.selectModel).toHaveBeenCalledWith('m');
  });

  it.each([false, true])('shows custom text and effort controls with disabled state %s', (disabled) => {
    const props = settingsProps({});
    props.card = { ...props.card, selectReasoning: vi.fn(), reasoning: { ...props.card.reasoning,
      customActive: true, customModelInputValue: 'saved', hasReasoning: true, reasoningDisabled: disabled,
      reasoningValue: 'low', reasoningOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] } };
    render(<LocalCliAgentSettings {...props} />);
    const custom = screen.getByTestId('jini-agent-model-custom-other');
    expect(custom).toHaveValue('saved');
    expect(custom).toHaveAttribute('spellcheck', 'false');
    fireEvent.change(custom, { target: { value: '  custom-id  ' } });
    expect(props.onModelChange).toHaveBeenCalledTimes(1);
    expect(props.onModelChange).toHaveBeenCalledWith('other', 'custom-id');
    const effort = screen.getByTestId('jini-agent-reasoning-other');
    expect((effort as HTMLSelectElement).disabled).toBe(disabled);
    expect(within(effort).getAllByRole('option').map((item) => item.textContent)).toEqual(['Low', 'High']);
    expect(effort).toHaveValue('low');
  });

  it('forwards an enabled effort choice to the existing card handler', () => {
    const props = settingsProps({});
    props.card = { ...props.card, selectReasoning: vi.fn(), reasoning: { ...props.card.reasoning,
      hasReasoning: true, reasoningDisabled: false,
      reasoningOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }], reasoningValue: 'low' } };
    render(<LocalCliAgentSettings {...props} />);
    fireEvent.change(screen.getByTestId('jini-agent-reasoning-other'), { target: { value: 'high' } });
    expect(props.card.selectReasoning).toHaveBeenCalledTimes(1);
    expect(props.card.selectReasoning).toHaveBeenCalledWith('high');
  });

  it.each<NonNullable<LocalCliAgentSettingsProps['card']['result']>>([
    { status: 'ok', agentId: 'other' },
    { status: 'ok', agentId: 'other', message: '' },
    { status: 'ok', agentId: 'other', message: 'Host verdict' },
    { status: 'error', agentId: 'other', message: 'Probe failed' },
  ] as const)('preserves result role, status class and message $status/$message', (result) => {
    const props = settingsProps({});
    props.card = { ...props.card, result };
    render(<LocalCliAgentSettings {...props} />);
    const verdict = screen.getByRole(result.status === 'ok' ? 'status' : 'alert');
    expect(verdict).toHaveClass(`is-${result.status}`);
    expect(verdict.textContent).toBe(result.message ?? 'Agent is ready.');
  });

  it.each([
    { repair: null, field: false, canUse: false, visible: false },
    { repair: { detectedPath: '/bin/agent', canUseDetected: true }, field: false, canUse: false, visible: false },
    { repair: { detectedPath: '/bin/agent', canUseDetected: false }, field: true, canUse: false, visible: true },
    { repair: { detectedPath: '/bin/agent', canUseDetected: true }, field: true, canUse: true, visible: true },
  ])('retains both repair prerequisites and the canUseDetected guard ($field/$canUse)', ({ repair, field, canUse, visible }) => {
    const props = settingsProps({});
    props.card = { ...props.card, repair, repairField: field
      ? { agentId: 'other', envKey: 'AGENT_BIN', label: 'Binary path', kind: 'binPath' } : null };
    render(<LocalCliAgentSettings {...props} />);
    expect(screen.queryByText('Use detected path') !== null).toBe(canUse);
    expect(screen.queryByText('Clear custom path') !== null).toBe(visible);
    if (!visible) return;
    fireEvent.click(screen.getByText('Clear custom path'));
    expect(props.onEnvChange).toHaveBeenCalledTimes(1);
    expect(props.onEnvChange).toHaveBeenCalledWith('other', 'AGENT_BIN', '');
    if (!canUse) return;
    fireEvent.click(screen.getByText('Use detected path'));
    expect(props.onEnvChange).toHaveBeenLastCalledWith('other', 'AGENT_BIN', '/bin/agent');
  });
});
