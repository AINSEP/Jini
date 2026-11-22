import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../features/i18n/index.js';
import { Notice } from '../../components/Notice.js';

describe('Notice', () => {
  it('renders a success outcome with the success class', () => {
    const { container } = render(<Notice outcome={{ ok: true, message: 'Installed' }} />);
    expect(container.firstChild).toHaveClass('jini-is-success');
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });

  it('renders an error outcome with the error class', () => {
    const { container } = render(<Notice outcome={{ ok: false, message: 'Failed' }} />);
    expect(container.firstChild).toHaveClass('is-error');
  });

  it('omits the warning line when there are no warnings', () => {
    render(<Notice outcome={{ ok: true, message: 'Installed' }} />);
    expect(screen.queryByText(/warning/)).not.toBeInTheDocument();
  });

  it('singularizes the warning count when exactly one', () => {
    render(<Notice outcome={{ ok: true, message: 'Installed', warnings: ['missing icon'] }} />);
    expect(screen.getByText('1 warning')).toBeInTheDocument();
  });

  it('pluralizes the warning count for more than one', () => {
    render(
      <Notice outcome={{ ok: true, message: 'Installed', warnings: ['a', 'b', 'c'] }} />,
    );
    expect(screen.getByText('3 warnings')).toBeInTheDocument();
  });

  it('renders a collapsible log with every line when present', () => {
    render(
      <Notice outcome={{ ok: true, message: 'Installed', log: ['step 1', 'step 2'] }} />,
    );
    expect(screen.getByText('Install log')).toBeInTheDocument();
    expect(screen.getByText('step 1')).toBeInTheDocument();
    expect(screen.getByText('step 2')).toBeInTheDocument();
  });

  it('omits the log details when there is no log', () => {
    render(<Notice outcome={{ ok: true, message: 'Installed' }} />);
    expect(screen.queryByText('Install log')).not.toBeInTheDocument();
  });

  it('uses a caller-supplied logLabel over the default', () => {
    render(
      <Notice outcome={{ ok: true, message: 'Installed', log: ['x'] }} logLabel="Details" />,
    );
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.queryByText('Install log')).not.toBeInTheDocument();
  });

  it('appends a caller-supplied className', () => {
    const { container } = render(
      <Notice outcome={{ ok: true, message: 'Installed' }} className="extra" />,
    );
    expect(container.firstChild).toHaveClass('extra');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{ fr: { '{n} warning': '{n} avertissement', 'Install log': "Journal d'installation" } }}
        initialLocale="fr"
      >
        <Notice outcome={{ ok: true, message: 'Installed', warnings: ['x'], log: ['step'] }} />
      </I18nProvider>,
    );
    expect(screen.getByText('1 avertissement')).toBeInTheDocument();
    expect(screen.getByText("Journal d'installation")).toBeInTheDocument();
  });
});
