import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsentSettingsPanel, type ConsentSettingsView } from '../ConsentSettingsPanel.js';

const initial: ConsentSettingsView = { enabled: false, regionMode: 'auto', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'Cookies', message: 'Choose cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Preferences' };

describe('cookie consent settings panel', () => {
  it('offers a labeled OFF switch and keyboard-editable copy, region mode and policy version', async () => {
    const changes: unknown[] = [];
    function Host() {
      const [value, setValue] = useState(initial);
      return <ConsentSettingsPanel value={value} onChange={({ patch }) => { changes.push(patch); setValue(current => ({ ...current, ...patch })); }} loading={false} error={null} status="Changes save automatically." />;
    }
    const user = userEvent.setup();
    render(<Host />);
    const toggle = screen.getByRole('switch', { name: 'Enable cookie consent on this site' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    toggle.focus(); await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'true'); expect(changes[0]).toEqual({ enabled: true });
    await user.selectOptions(screen.getByLabelText('Region mode'), 'opt-out');
    expect(changes[1]).toEqual({ regionMode: 'opt-out' });
    const version = screen.getByLabelText('Policy version');
    await user.clear(version); await user.type(version, '2');
    expect(version).toHaveValue('2');
    expect(screen.getByLabelText('Privacy policy page URL')).toHaveValue('/privacy');
    expect(screen.getByLabelText('Banner message')).toHaveValue('Choose cookies.');
    expect(screen.getByText('Provides the consent mechanism, not legal advice. Review your texts, categories, and privacy policy for your site.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Changes save automatically.');
  });
  it('disables fields during loading and exposes the actual server error', () => {
    render(<ConsentSettingsPanel value={initial} onChange={() => { throw new Error('Disabled controls must not write.'); }} loading={true} error="Permission denied: settings.workspace.write" status="Loading…" />);
    expect(screen.getByRole('switch')).toBeDisabled(); expect(screen.getByLabelText('Region mode')).toBeDisabled(); expect(screen.getByLabelText('Banner title')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied: settings.workspace.write');
  });
});


it('keeps invalid policy-version drafts out of autosave and autosaves a valid replacement before blur', async () => {
  const changes: unknown[] = [];
  const user = userEvent.setup();
  render(<ConsentSettingsPanel value={initial} onChange={({ patch }) => changes.push(patch)} loading={false} error={null} status="Ready" />);
  const input = screen.getByLabelText('Policy version');
  await user.clear(input); await user.tab();
  expect(input).toBeInvalid(); expect(changes).toEqual([]);
  await user.type(input, '2');
  expect(changes).toEqual([{ policyVersion: '2' }]);
  await user.tab();
  expect(input).toBeValid(); expect(changes).toEqual([{ policyVersion: '2' }]);
});
it('accepts host translations for panel copy, native labels and region options', () => {
  render(<ConsentSettingsPanel value={initial} onChange={() => undefined} loading={false} error={null} status="Prêt" dictionary={{ 'Site cookie consent': 'Cookies du site', 'Policy version': 'Version de politique', 'Region mode': 'Région', 'Opt-out everywhere (California)': 'Refus possible (Californie)' }} />);
  expect(screen.getByText('Cookies du site')).toBeInTheDocument(); expect(screen.getByLabelText('Version de politique')).toHaveValue('1'); expect(screen.getByLabelText('Région')).toHaveValue('auto'); expect(screen.getByRole('option', { name: 'Refus possible (Californie)' })).toHaveValue('opt-out');
});

it('keeps a valid policy edit when navigation unmounts the focused input', async () => {
  let saved = initial;
  const user = userEvent.setup();
  const view = render(<ConsentSettingsPanel value={saved} onChange={({ patch }) => { saved = { ...saved, ...patch }; }} loading={false} error={null} status="Ready" />);
  await user.clear(screen.getByLabelText('Policy version'));
  await user.type(screen.getByLabelText('Policy version'), '2');
  view.unmount();
  expect(saved.policyVersion).toBe('2');
});
