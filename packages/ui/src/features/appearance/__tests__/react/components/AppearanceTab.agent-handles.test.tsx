import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppearanceTab } from '../../../react/components/AppearanceTab.js';

describe('AppearanceTab agent handles', () => {
  it('gives every accent swatch its own handle under the tab handle', () => {
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} accentSwatches={['#059669', '#2563eb']} agentHandle="appearance" />);
    const swatches = screen.getAllByRole('radio').filter((el) => el.getAttribute('data-agent-role') === 'button');
    const handles = swatches.map((el) => el.getAttribute('data-agent-element'));
    expect(handles).toHaveLength(2);
    expect(new Set(handles).size).toBe(2);
    for (const handle of handles) expect(handle).toMatch(/^appearance-swatch-/);
  });

  it('publishes no swatch handles without a tab handle', () => {
    render(<AppearanceTab theme="light" onThemeChange={() => {}} onAccentColorChange={() => {}} accentSwatches={['#059669']} />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toHaveAttribute('data-agent-element');
  });
});
