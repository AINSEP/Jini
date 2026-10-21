import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageTab } from '../react/components/LanguageTab.js';

const LOCALES = [{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }];

describe('LanguageTab agent handles', () => {
  it('gives each locale tile its own handle under the tab handle, labelled by the locale name', () => {
    render(<LanguageTab locales={LOCALES} selectedLocale="en" onSelectLocale={() => {}} agentHandle="language" />);
    const english = screen.getByRole('radio', { name: /English/ });
    const spanish = screen.getByRole('radio', { name: /Español/ });
    expect(english.getAttribute('data-agent-element')).toMatch(/^language-/);
    expect(spanish.getAttribute('data-agent-element')).toMatch(/^language-/);
    expect(english.getAttribute('data-agent-element')).not.toBe(spanish.getAttribute('data-agent-element'));
    expect(spanish).toHaveAttribute('data-agent-label', 'Español');
  });

  it('publishes no tile handles without a tab handle', () => {
    render(<LanguageTab locales={LOCALES} selectedLocale="en" onSelectLocale={() => {}} />);
    for (const tile of screen.getAllByRole('radio')) expect(tile).not.toHaveAttribute('data-agent-element');
  });
});
