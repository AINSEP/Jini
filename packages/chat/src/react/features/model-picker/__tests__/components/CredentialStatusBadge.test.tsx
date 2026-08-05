import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CredentialStatusBadge } from '../../components/CredentialStatusBadge.js';
import { I18nContext } from '../../../../hooks/context.js';

describe('CredentialStatusBadge', () => {
  it('renders the passthrough label for each status', () => {
    const { rerender } = render(<CredentialStatusBadge status="configured" />);
    expect(screen.getByText('Configured')).toBeInTheDocument();
    rerender(<CredentialStatusBadge status="available" />);
    expect(screen.getByText('Available')).toBeInTheDocument();
    rerender(<CredentialStatusBadge status="unconfigured" />);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('sets a data-status attribute and status-scoped class for host styling', () => {
    render(<CredentialStatusBadge status="configured" />);
    const badge = screen.getByText('Configured');
    expect(badge).toHaveAttribute('data-status', 'configured');
    expect(badge.className).toContain('model-picker-status-badge--configured');
  });

  it('appends a supplied className', () => {
    render(<CredentialStatusBadge status="configured" className="extra" />);
    expect(screen.getByText('Configured').className).toContain('extra');
  });

  /**
   * Proves the i18n wiring actually works — mounts under a real translated
   * dictionary rather than only exercising the unconfigured passthrough
   * case, per the i18n policy in
   * `foundry/docs/jini-port/god-components-extraction-plan.md`.
   */
  it('renders translated copy when an I18nAdapter with a real dictionary is wired in', () => {
    const dict: Record<string, string> = { Configured: 'Konfiguriert' };
    render(
      <I18nContext.Provider value={{ locale: 'de', t: (key) => dict[key] ?? key }}>
        <CredentialStatusBadge status="configured" />
      </I18nContext.Provider>,
    );
    expect(screen.getByText('Konfiguriert')).toBeInTheDocument();
    expect(screen.queryByText('Configured')).not.toBeInTheDocument();
  });
});
