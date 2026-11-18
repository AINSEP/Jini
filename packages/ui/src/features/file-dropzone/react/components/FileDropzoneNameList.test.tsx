// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDropzoneNameList } from './FileDropzoneNameList.js';
import { I18nProvider, type useT } from '../../../i18n/index.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('FileDropzoneNameList', () => {
  it('renders nothing for an empty names list', () => {
    const { container } = render(<FileDropzoneNameList names={[]} ariaLabel="Selections" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one chip per name, labeled by ariaLabel', () => {
    render(<FileDropzoneNameList names={['a.txt', 'b.txt']} ariaLabel="Local code selections" />);
    const list = screen.getByLabelText('Local code selections');
    expect(list).toHaveTextContent('a.txt');
    expect(list).toHaveTextContent('b.txt');
  });

  it('omits the remove button when onRemoveName is not supplied', () => {
    render(<FileDropzoneNameList names={['a.txt']} ariaLabel="Selections" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clicking a chip\'s remove button calls onRemoveName with that name', async () => {
    const onRemoveName = vi.fn();
    render(<FileDropzoneNameList names={['a.txt', 'b.txt']} onRemoveName={onRemoveName} ariaLabel="Selections" />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.txt' }));
    expect(onRemoveName).toHaveBeenCalledWith('b.txt');
  });

  it('translates the remove-button label end-to-end under I18nProvider', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Remove {name}': 'Retirer {name}' } }} initialLocale="fr">
        <FileDropzoneNameList names={['a.txt']} onRemoveName={vi.fn()} ariaLabel="Selections" />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Retirer a.txt' })).toBeInTheDocument();
  });

  it('renders the translator supplied through useTHook', () => {
    render(<FileDropzoneNameList names={['a.txt']} onRemoveName={vi.fn()} ariaLabel="Selections" useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Remove {name}»' })).toBeInTheDocument();
  });
});
