import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { lightColors } from './palette.fixture.js';
import { ConsentLookFields, type ConsentSettingsView } from '../index.js';

const view: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'Cookies', message: 'Choose cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Preferences' };

const tokenValues = () => ['Background', 'Text', 'Border'].map(label => (screen.getByLabelText(label) as HTMLInputElement).value);

it('shows the host-supplied light palette in unset colour tokens', () => {
  render(<ConsentLookFields value={view} onChange={() => undefined} lightColors={{ bg: '#010203', text: '#040506', border: '#070809' }} />);
  expect(tokenValues()).toEqual(['#010203', '#040506', '#070809']);
});

// The old default admin theme's light palette still comes out when the host supplies those colors:
// the fallbacks moved to the host without changing value.
it('keeps the previous fallback colours when the host supplies the default admin palette', () => {
  render(<ConsentLookFields value={view} onChange={() => undefined} lightColors={lightColors} />);
  expect(tokenValues()).toEqual(['#ffffff', '#202020', '#d9d9d9']);
});

it('lets a set token win over the host fallback', () => {
  render(<ConsentLookFields value={{ ...view, appearance: { backgroundColor: '#112233' } }} onChange={() => undefined} lightColors={{ bg: '#010203', text: '#040506', border: '#070809' }} />);
  expect(tokenValues()).toEqual(['#112233', '#040506', '#070809']);
});
