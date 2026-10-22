import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConsentSettingsPanel, type ConsentSettingsView } from '../index.js';

const view: ConsentSettingsView = { enabled: true, regionMode: 'auto', policyVersion: '3', privacyPolicyUrl: '/privacy', title: 'Cookies', message: 'Choose cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Preferences' };

it('serves the consent settings panel from the public react entry', () => {
  render(<ConsentSettingsPanel value={view} onChange={vi.fn()} loading={false} error={null} status="Saved." />);
  expect(screen.getByRole('switch', { name: 'Enable cookie consent on this site' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText('Policy version')).toHaveValue('3');
  expect(screen.getByRole('status')).toHaveTextContent('Saved.');
});
