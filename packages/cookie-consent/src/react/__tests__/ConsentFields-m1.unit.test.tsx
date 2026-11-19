import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConsentBannerFields, type ConsentSettingsView } from '../index.js';

it('uses the host message limit and reports plain text without changing other fields', () => {
  const value: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy',
    title: 'Cookies', message: '', acceptLabel: 'Accept', rejectLabel: 'Reject', preferencesLabel: 'Preferences' };
  const before = { ...value };
  const patches: Partial<ConsentSettingsView>[] = [];
  render(<ConsentBannerFields value={value} limits={{ message: 37 }} onChange={({ patch }) => patches.push(patch)} />);
  const message = screen.getByLabelText('Banner message');
  expect(message).toHaveValue('');
  expect(message).toHaveAttribute('maxlength', '37');
  expect(message).toHaveAttribute('rows', '3');
  fireEvent.change(message, { target: { value: '<b>Choose</b>' } });
  expect(patches).toEqual([{ message: '<b>Choose</b>' }]);
  expect(value).toEqual(before);
});

it('keeps a missing stored banner message controlled and editable', () => {
  // Serialized settings from an older host may omit copy before the host merges its defaults.
  const value = JSON.parse('{"enabled":true,"regionMode":"opt-in","policyVersion":"1"}') as ConsentSettingsView;
  const patches: Partial<ConsentSettingsView>[] = [];
  render(<ConsentBannerFields value={value} onChange={({ patch }) => patches.push(patch)} />);
  const message = screen.getByLabelText('Banner message');
  expect(message).toHaveValue('');
  expect(message).toHaveAttribute('maxlength', '2000');
  fireEvent.change(message, { target: { value: 'Choose cookies' } });
  expect(patches).toEqual([{ message: 'Choose cookies' }]);
});
