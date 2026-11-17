import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { recordingThemeKit } from '../../../react/shell/__tests__/theme-kit-fake.js';
import { ConsentLookFields, type ConsentSettingsView } from '../index.js';

const view: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'Cookies', message: 'Choose cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Preferences' };

/** A theme kit whose light palette is `light`; the shape every host's kit has. */
function kitWithLight(light: { bg: string; text: string; border: string }) {
  const base = recordingThemeKit().theme;
  const palette = { ...base.defaultAdminTheme.light, ...light };
  const theme = { ...base, defaultAdminTheme: { ...base.defaultAdminTheme, light: palette } };
  return () => theme;
}
const tokenValues = () => ['Background', 'Text', 'Border'].map(label => (screen.getByLabelText(label) as HTMLInputElement).value);

it('shows the injected kit\'s default-theme light palette in unset colour tokens', () => {
  render(<ConsentLookFields value={view} onChange={() => undefined} useThemeKit={kitWithLight({ bg: '#010203', text: '#040506', border: '#070809' })} />);
  expect(tokenValues()).toEqual(['#010203', '#040506', '#070809']);
});

// The six strings the module-level array used to hold (Jini's default admin theme, light palette) still come out
// when a host's kit carries that theme: the fallbacks moved from an import to the kit without changing value.
it('keeps the previous fallback colours when the kit carries the default admin theme', () => {
  render(<ConsentLookFields value={view} onChange={() => undefined} useThemeKit={kitWithLight({ bg: '#ffffff', text: '#202020', border: '#d9d9d9' })} />);
  expect(tokenValues()).toEqual(['#ffffff', '#202020', '#d9d9d9']);
});

it('lets a set token win over the kit fallback', () => {
  render(<ConsentLookFields value={{ ...view, appearance: { backgroundColor: '#112233' } }} onChange={() => undefined} useThemeKit={kitWithLight({ bg: '#010203', text: '#040506', border: '#070809' })} />);
  expect(tokenValues()).toEqual(['#112233', '#040506', '#070809']);
});
