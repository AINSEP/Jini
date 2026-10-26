import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/agentic';
import { I18nProvider } from '../../../../i18n/index.js';
import type { PrivacyConsentState } from '../../../types.js';
import { PrivacyTab } from '../../../react/components/PrivacyTab.js';

const NOW = 1_700_000_000_000;

function undecidedState(): PrivacyConsentState {
  return { telemetry: {}, installationId: null, privacyDecisionAt: null };
}

function decidedState(overrides: Partial<PrivacyConsentState> = {}): PrivacyConsentState {
  return {
    telemetry: { metrics: true, content: false },
    installationId: 'abc-123',
    privacyDecisionAt: NOW - 1000,
    ...overrides,
  };
}

describe('PrivacyTab', () => {
  it('shows the two choices once, as toggles that start off, before a decision is made', () => {
    render(<PrivacyTab state={undecidedState()} onChange={() => {}} now={() => NOW} />);
    expect(screen.getByRole('button', { name: /Anonymous metrics/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Conversation and tool content/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByText('Feature usage and performance data, with no personal content.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: "Don't share" })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share usage' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Installation ID')).not.toBeInTheDocument();
  });

  it('shows the toggles and installation id once a decision has been made', () => {
    render(<PrivacyTab state={decidedState()} onChange={() => {}} now={() => NOW} />);
    expect(screen.getByLabelText('Installation ID')).toHaveValue('abc-123');
    expect(screen.getByRole('button', { name: /Anonymous metrics/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Conversation and tool content/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the first toggle records the decision and generates an installation id', async () => {
    const onChange = vi.fn();
    render(<PrivacyTab state={undecidedState()} onChange={onChange} now={() => NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /Anonymous metrics/ }));
    const next = onChange.mock.calls[0]![0] as PrivacyConsentState;
    expect(next.telemetry).toEqual({ metrics: true });
    expect(next.installationId).toBeTruthy();
    expect(next.privacyDecisionAt).toBe(NOW);
  });

  it('turning the last category off clears the installation id', async () => {
    const onChange = vi.fn();
    render(<PrivacyTab state={decidedState()} onChange={onChange} now={() => NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /Anonymous metrics/ }));
    const next = onChange.mock.calls[0]![0] as PrivacyConsentState;
    expect(next.telemetry).toEqual({ metrics: false, content: false });
    expect(next.installationId).toBeNull();
  });

  it('toggling the content category calls onChange with the patched telemetry', async () => {
    const onChange = vi.fn();
    render(<PrivacyTab state={decidedState()} onChange={onChange} now={() => NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /Conversation and tool content/ }));
    const next = onChange.mock.calls[0]![0] as PrivacyConsentState;
    expect(next.telemetry.content).toBe(true);
  });

  it('toggling the metrics category calls onChange with the patched telemetry', async () => {
    const onChange = vi.fn();
    render(<PrivacyTab state={decidedState()} onChange={onChange} now={() => NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /Anonymous metrics/ }));
    const next = onChange.mock.calls[0]![0] as PrivacyConsentState;
    expect(next.telemetry.metrics).toBe(false);
  });

  it('"Delete my data" rotates the installation id', async () => {
    const onChange = vi.fn();
    render(<PrivacyTab state={decidedState()} onChange={onChange} now={() => NOW} />);
    await userEvent.click(screen.getByRole('button', { name: /Delete my data/ }));
    const next = onChange.mock.calls[0]![0] as PrivacyConsentState;
    expect(next.installationId).not.toBe('abc-123');
    expect(next.telemetry).toEqual({ metrics: false, content: false });
  });

  it('shows the opted-out label instead of a raw id when installationId is null', () => {
    render(<PrivacyTab state={decidedState({ installationId: null })} onChange={() => {}} now={() => NOW} />);
    expect(screen.getByLabelText('Installation ID')).toHaveValue('Not sharing');
  });

  it('renders host-supplied labels instead of the built-in defaults', () => {
    render(
      <PrivacyTab
        state={decidedState()}
        onChange={() => {}}
        now={() => NOW}
        labels={{
          consentKicker: 'Custom kicker',
          consentLead: 'Custom lead',
          consentFooter: 'Custom footer',
          metricsLabel: 'Custom metrics',
          metricsHint: 'Custom metrics hint',
          contentLabel: 'Custom content',
          contentHint: 'Custom content hint',
          installationIdLabel: 'Custom id label',
          installationIdHint: 'Custom id hint',
          optedOutLabel: 'Custom opted out',
          deleteMyDataLabel: 'Custom delete',
        }}
      />,
    );
    expect(screen.getByText('Custom kicker')).toBeInTheDocument();
    expect(screen.getByText('Custom lead')).toBeInTheDocument();
    expect(screen.getByText('Custom footer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom metrics/ })).toBeInTheDocument();
    expect(screen.getAllByText('Custom metrics hint').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Custom content/ })).toBeInTheDocument();
    expect(screen.getAllByText('Custom content hint').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Custom id label')).toBeInTheDocument();
    expect(screen.getByText('Custom id hint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom delete/ })).toBeInTheDocument();
  });

  it('uses the custom opted-out label from host-supplied labels when installationId is null', () => {
    render(
      <PrivacyTab
        state={decidedState({ installationId: null })}
        onChange={() => {}}
        now={() => NOW}
        labels={{ optedOutLabel: 'Custom opted out' }}
      />,
    );
    expect(screen.getByLabelText('Installation ID')).toHaveValue('Custom opted out');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Anonymous metrics': 'Mesures anonymes' } }} initialLocale="fr">
        <PrivacyTab state={undecidedState()} onChange={() => {}} now={() => NOW} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: /Mesures anonymes/ })).toBeInTheDocument();
  });

  describe('agentHandle', () => {
    it('publishes no data-agent-* markup at all when omitted — additive by default', () => {
      const { container } = render(<PrivacyTab state={decidedState()} onChange={() => {}} now={() => NOW} />);
      expect(container.querySelectorAll(`[${AGENT_ELEMENT_ATTRIBUTE}]`)).toHaveLength(0);
    });

    it('derives one distinct handle per control from the single base the host passes', () => {
      render(<PrivacyTab state={decidedState()} onChange={() => {}} now={() => NOW} agentHandle="settings-privacy" />);
      expect(screen.getByRole('button', { name: /Anonymous metrics/ })).toHaveAttribute(
        AGENT_ELEMENT_ATTRIBUTE,
        'settings-privacy-metrics-toggle',
      );
      expect(screen.getByRole('button', { name: /Conversation and tool content/ })).toHaveAttribute(
        AGENT_ELEMENT_ATTRIBUTE,
        'settings-privacy-content-toggle',
      );
      expect(screen.getByLabelText('Installation ID')).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'settings-privacy-installation-id');
      expect(screen.getByRole('button', { name: /Delete my data/ })).toHaveAttribute(
        AGENT_ELEMENT_ATTRIBUTE,
        'settings-privacy-delete-my-data',
      );
    });
  });
});
