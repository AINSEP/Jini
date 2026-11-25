import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsentBannerFields, type ConsentSettingsView } from '../index.js';

const value: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy' };
const modes = ['jini', 'headless', 'off'] as const;

/** The banner-mode radio for the built-in banner: it is the host's product that names it, so the
 * label must follow whichever product the host injects and never a product of Jini's own. */
function builtInLabel(props: Record<string, unknown>): string {
  const { unmount } = render(<ConsentBannerFields value={value} onChange={() => undefined} bannerModes={modes} {...props} />);
  const label = screen.getAllByRole('radio').map(radio => radio.closest('label')?.textContent ?? '')[0] ?? '';
  unmount();
  return label;
}

describe('built-in banner label (injected product copy)', () => {
  it('names the banner after each host\'s own product, translated through that host\'s dictionary', () => {
    expect(builtInLabel({ productName: 'Acme' })).toBe('Acme banner');
    expect(builtInLabel({ productName: 'Zeta' })).toBe('Zeta banner');
    expect(builtInLabel({ productName: 'Acme', dictionary: { 'Acme banner': 'Acme-Banner' } })).toBe('Acme-Banner');
    expect(builtInLabel({ productName: 'Zeta', dictionary: { 'Acme banner': 'Acme-Banner' } })).toBe('Zeta banner');
  });

  it('falls back to neutral copy that names no product when the host injects none', () => {
    const label = builtInLabel({});
    expect(label).toBe('Built-in banner');
    expect(label).not.toMatch(/jini/i);
  });
});
