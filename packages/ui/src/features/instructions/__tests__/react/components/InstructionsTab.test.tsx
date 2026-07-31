import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { InstructionsTab } from '../../../react/components/InstructionsTab.js';

describe('InstructionsTab', () => {
  it('renders the bound value and calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(<InstructionsTab value="" onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'hi');
    expect(onChange).toHaveBeenCalledWith('h');
    expect(onChange).toHaveBeenCalledWith('i');
  });

  it('reports undefined (not an empty string) when the textarea is cleared', async () => {
    const onChange = vi.fn();
    render(<InstructionsTab value="a" onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.clear(textarea);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('reflects the current value', () => {
    render(<InstructionsTab value="Be concise." onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('Be concise.');
  });

  it('applies rows and maxLength', () => {
    render(<InstructionsTab value="" onChange={() => {}} rows={8} maxLength={100} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(8);
    expect(textarea.maxLength).toBe(100);
  });

  it('uses default rows=5 maxLength=5000 when omitted', () => {
    render(<InstructionsTab value="" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(5);
    expect(textarea.maxLength).toBe(5000);
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Custom instructions': 'Instructions personnalisées' } }} initialLocale="fr">
        <InstructionsTab value="" onChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('Instructions personnalisées')).toBeInTheDocument();
  });
});
