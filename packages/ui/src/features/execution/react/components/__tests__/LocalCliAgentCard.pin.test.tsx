import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { LocalCliAgentCard, type LocalCliAgentCardProps } from '../LocalCliAgentCard.js';

function cardProps(required: Partial<LocalCliAgentCardProps>, _options = {}): LocalCliAgentCardProps {
  return {
    agent: { id: 'other', label: 'Other CLI', installed: true }, config: { agentId: null },
    selected: false, onSelect: vi.fn(), onModelChange: vi.fn(), onReasoningChange: vi.fn(),
    onEnvChange: vi.fn(), cliEnvFields: [], agentTest: { status: 'idle' }, ...required,
  };
}

describe('LocalCliAgentCard characterization', () => {
  it('shows custom identity, badges, auth tooltip and saved model on an unselected card', () => {
    const props = cardProps({
      agent: { id: 'other', label: 'Other CLI', installed: true, description: 'Vendor CLI', badges: ['Fast', 'Local'],
        authStatus: 'missing', authMessage: 'Sign in first', models: [{ id: 'm', label: 'Model M' }] },
      config: { agentId: null, modelByAgentId: { other: 'm' } },
      renderIcon: () => <b>Mark</b>, agentHandle: 'settings-other', onTest: vi.fn(),
    });
    render(<LocalCliAgentCard {...props} />);
    const select = screen.getByTestId('jini-agent-select-other');
    expect(select).toHaveAttribute('aria-pressed', 'false');
    expect(within(select).getByText('Mark')).toBeInTheDocument();
    expect(within(select).getByText('Vendor CLI')).toBeInTheDocument();
    expect(within(select).getByText('Fast')).toBeInTheDocument();
    expect(within(select).getByText('Local')).toBeInTheDocument();
    expect(within(select).getByText('Model M')).toBeInTheDocument();
    expect(screen.getByText('Authentication required')).toHaveAttribute('title', 'Sign in first');
    expect(screen.queryByTestId('jini-agent-test-other')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jini-agent-settings-other')).not.toBeInTheDocument();
    fireEvent.click(select);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith('other');
  });

  it.each([{ badges: undefined }, { badges: [] }])('omits absent or empty badges, tagline and model summary ($badges)', ({ badges }) => {
    const props = cardProps({ agent: { id: 'other', label: 'Other CLI', installed: true, badges } });
    const { container } = render(<LocalCliAgentCard {...props} />);
    expect(container.querySelector('.jini-agent-card-icon')).toHaveTextContent('O');
    expect(container.querySelector('.jini-agent-card-tagline')).toBeNull();
    expect(container.querySelector('.jini-agent-card-badges')).toBeNull();
    expect(container.querySelector('.jini-agent-card-model-summary')).toBeNull();
    expect(screen.getByText('Installed')).not.toHaveAttribute('title');
  });

  it.each([undefined, ''])('defaults only a missing description, preserving an explicit blank (%s)', (description) => {
    const props = cardProps({ agent: { id: 'claude', label: 'Claude', installed: true, description } });
    const { container } = render(<LocalCliAgentCard {...props} />);
    expect(container.querySelector('.jini-agent-card-tagline')?.textContent ?? null)
      .toBe(description === undefined ? 'Anthropic official CLI' : null);
  });

  it('keeps the defensive empty-meta guard when a host translates Installed to blank', () => {
    const props = cardProps({});
    const { container } = render(<I18nProvider initialLocale="en" syncDocumentAttributes={false}
      dictionaries={{ en: { Installed: '' } }}><LocalCliAgentCard {...props} /></I18nProvider>);
    expect(container.querySelector('.jini-agent-card-meta')).toBeNull();
  });

  it('disables a missing CLI while keeping its diagnostics visible', () => {
    const props = cardProps({ agent: { id: 'other', label: 'Other CLI', installed: false,
      diagnostics: [{ reason: 'not-on-path', severity: 'error', message: 'Missing binary' }] } });
    render(<LocalCliAgentCard {...props} />);
    expect(screen.getByTestId('jini-agent-card-other')).toHaveClass('is-missing');
    expect(screen.getByTestId('jini-agent-select-other')).toBeDisabled();
    fireEvent.click(screen.getByTestId('jini-agent-select-other'));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Missing binary')).toBeInTheDocument();
  });

  it('shows selection without an empty settings box or compact summary', () => {
    const props = cardProps({ selected: true });
    const { container } = render(<LocalCliAgentCard {...props} />);
    expect(screen.getByTestId('jini-agent-card-other')).toHaveClass('is-selected', 'is-installed');
    expect(screen.getByTestId('jini-agent-select-other')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.jini-agent-card-check')).toHaveTextContent('✓');
    expect(screen.queryByTestId('jini-agent-settings-other')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jini-agent-test-other')).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps Test separate from selection and scopes loading (%s)', (testing) => {
    const props = cardProps({ selected: true, onTest: vi.fn(),
      agentTest: testing ? { status: 'testing', agentId: 'other' } : { status: 'idle' },
      agent: { id: 'other', label: 'Other CLI', installed: true, models: [{ id: 'm', label: 'Model M' }] } });
    const { container } = render(<LocalCliAgentCard {...props} />);
    const test = screen.getByTestId('jini-agent-test-other');
    expect(test).toHaveTextContent(testing ? 'Testing…' : 'Test');
    expect((test as HTMLButtonElement).disabled).toBe(testing);
    expect(test.classList.contains('is-loading')).toBe(testing);
    expect(screen.getByTestId('jini-agent-card-other')).toContainElement(screen.getByTestId('jini-agent-settings-other'));
    expect(container.querySelector('.jini-agent-card-model-summary')).toBeNull();
    fireEvent.click(test);
    expect(props.onTest).toHaveBeenCalledTimes(testing ? 0 : 1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
