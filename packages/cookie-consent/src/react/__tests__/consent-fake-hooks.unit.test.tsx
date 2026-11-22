import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lightColors } from './palette.fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsentBannerFields, ConsentLookFields, ConsentRulesFields, PolicyVersionInput } from '../ConsentFields.js';
import { ConsentPreviewFrame } from '../ConsentPreviewFrame.js';
import type { ConsentSettingsView } from '../ConsentSettingsPanel.js';
import type { useConsentPreviewWidth, useConsentSettingsPanel, usePolicyVersionInput } from '../settings-panel.hooks.js';

/**
 * @file One fake-hook output test per consent component that takes its hook as a prop (hook-injection
 * rule). Each fake handler reports a patch the real handlers can never produce, so receiving it at
 * `onChange` proves the injected hook ran and the real one did not. A fake returns only the fields
 * its component reads, hence the single `as` in `fake`. The `jini-` class-prefix loop applies
 * when a component moves, so it is not asserted here.
 */
afterEach(cleanup);

const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);
const VALUE: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'T', message: 'M', acceptLabel: 'A', rejectLabel: 'R', preferencesLabel: 'P' };
const panel = (patch: Record<string, unknown>) => {
  const handler = vi.fn();
  const text = () => () => handler(patch);
  const hook = fake<typeof useConsentSettingsPanel>({
    toggle: () => handler(patch), bannerMode: () => () => handler(patch), region: () => handler(patch), placement: () => handler(patch), text, token: () => () => handler(patch),
  });
  return { hook, handler };
};

describe('consent components render from their injected hooks', () => {
  it('ConsentBannerFields routes text edits and its banner-mode radios to the fake handlers hook', () => {
    const { hook, handler } = panel({ title: 'FAKE-PATCH' });
    render(<ConsentBannerFields value={VALUE} onChange={vi.fn()} bannerModes={['jini', 'off']} useConsentSettingsPanelHook={hook} />);
    fireEvent.change(screen.getByLabelText('Banner title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('None'));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith({ title: 'FAKE-PATCH' });
  });

  it('ConsentRulesFields routes the switch to the fake handlers hook', () => {
    const { hook, handler } = panel({ enabled: 'FAKE' });
    render(<ConsentRulesFields value={VALUE} onChange={vi.fn()} useConsentSettingsPanelHook={hook} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(handler).toHaveBeenCalledWith({ enabled: 'FAKE' });
  });

  it('ConsentLookFields routes the position select to the fake handlers hook', () => {
    const { hook, handler } = panel({ placement: 'FAKE' });
    render(<ConsentLookFields lightColors={lightColors} value={VALUE} onChange={vi.fn()} useConsentSettingsPanelHook={hook} />);
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'top-bar' } });
    expect(handler).toHaveBeenCalledWith({ placement: 'FAKE' });
  });

  it('PolicyVersionInput shows the draft of the fake hook and routes edits and blur to it', () => {
    const change = vi.fn(), blur = vi.fn();
    const hook = fake<typeof usePolicyVersionInput>({ draft: 'FAKE-DRAFT', change, blur });
    render(<PolicyVersionInput value="real" onChange={vi.fn()} maxLength={9} aria={{ 'aria-label': 'version' }} usePolicyVersionInputHook={hook} />);
    const input = screen.getByLabelText('version') as HTMLInputElement;
    expect(input.value).toBe('FAKE-DRAFT');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    expect(change).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
  });

  it('ConsentPreviewFrame marks the width of the fake hook and routes the buttons to its setter', () => {
    const setWidth = vi.fn();
    const hook = fake<typeof useConsentPreviewWidth>({ width: 'phone', setWidth });
    render(<ConsentPreviewFrame html="<p>x</p>" useConsentPreviewWidthHook={hook} />);
    expect(screen.getByText('Phone').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Desktop'));
    expect(setWidth).toHaveBeenCalledWith('desktop');
  });
});
