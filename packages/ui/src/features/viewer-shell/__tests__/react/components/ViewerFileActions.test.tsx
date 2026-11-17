import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type useT } from '../../../../i18n/index.js';
import { ViewerFileActions } from '../../../react/components/ViewerFileActions.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('ViewerFileActions', () => {
  it('renders nothing when neither url is given', () => {
    const { container } = render(<ViewerFileActions />);
    expect(container.firstChild).toBeNull();
  });

  it('renders only the download link when openUrl is omitted', () => {
    render(<ViewerFileActions downloadUrl="/f.png" fileName="f.png" />);
    expect(screen.getByText('Download')).toHaveAttribute('href', '/f.png');
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('renders only the open link when downloadUrl is omitted', () => {
    render(<ViewerFileActions openUrl="/f.png?open" />);
    expect(screen.getByText('Open')).toHaveAttribute('href', '/f.png?open');
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('renders both links with correct attributes', () => {
    render(<ViewerFileActions downloadUrl="/f.png" openUrl="/f.png?open" fileName="f.png" />);
    const download = screen.getByText('Download');
    expect(download).toHaveAttribute('download', 'f.png');
    const open = screen.getByText('Open');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('translates its labels through I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { Download: 'Télécharger', Open: 'Ouvrir' } }} initialLocale="fr">
        <ViewerFileActions downloadUrl="/f.png" openUrl="/f.png?open" />
      </I18nProvider>,
    );
    expect(screen.getByText('Télécharger')).toBeInTheDocument();
    expect(screen.getByText('Ouvrir')).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<ViewerFileActions downloadUrl="/f.png" openUrl="/f.png?open" useTHook={useQuotingT} />);
    expect(screen.getByText('«Download»')).toBeInTheDocument();
    expect(screen.getByText('«Open»')).toBeInTheDocument();
  });
});
