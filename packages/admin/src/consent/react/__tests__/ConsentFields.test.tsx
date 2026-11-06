import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsentBannerFields, ConsentLookFields, ConsentPreviewFrame, ConsentRulesFields, type ConsentSettingsView } from '../index.js';
import { pixelInputValue, withAppearanceToken } from '../settings-panel.hooks.js';

const initial: ConsentSettingsView = { enabled: true, regionMode: 'opt-in', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'Cookies', message: 'Choose cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Preferences' };

/** A controlled host that records every patch, like a real page's autosave controller. */
function host(Section: typeof ConsentBannerFields, extra: Record<string, unknown> = {}, start: ConsentSettingsView = initial) {
  const patches: Partial<ConsentSettingsView>[] = [];
  function Host() {
    const [value, setValue] = useState(start);
    return <Section value={value} onChange={({ patch }) => { patches.push(patch); setValue(current => ({ ...current, ...patch })); }} {...extra} />;
  }
  render(<Host />);
  return patches;
}

describe('ConsentBannerFields', () => {
  it('offers modes only when the host supplies them, without changing older hosts', () => {
    const { unmount } = render(<ConsentBannerFields value={initial} onChange={() => undefined} />);
    expect(screen.queryByRole('radio')).toBeNull();
    unmount();
    host(ConsentBannerFields, { bannerModes: ['jini', 'headless', 'off'] });
    expect(screen.getByRole('radio', { name: 'Jini banner' })).toBeChecked();
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual(['jini', 'headless', 'off']);
  });

  it('uses native keyboard choices and patches only the mode, preserving the enabled switch', async () => {
    const patches = host(ConsentBannerFields, { bannerModes: ['jini', 'headless', 'off'] });
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Jini banner' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'My own' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Banner mode' })).toHaveAccessibleDescription('Your banner calls window.jiniConsent.set(...)');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
    expect(patches).toEqual([{ bannerMode: 'headless' }, { bannerMode: 'off' }]);
  });

  it('honors the saved mode, supplied options, translations and conflict/loading disabled state', () => {
    render(<ConsentBannerFields value={{ ...initial, bannerMode: 'off' }} onChange={() => undefined} disabled
      bannerModes={['headless', 'off']} dictionary={{ 'My own': 'La mienne', 'None': 'Aucune', 'Banner mode': 'Mode de bannière' }} />);
    expect(screen.getByRole('group', { name: 'Mode de bannière' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Jini banner' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'La mienne' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Aucune' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Aucune' })).toBeChecked();
  });

  it('keeps two hosts radio selections independent', async () => {
    const first = host(ConsentBannerFields, { bannerModes: ['jini', 'headless'] });
    const second = host(ConsentBannerFields, { bannerModes: ['jini', 'headless'] });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('radio', { name: 'My own' })[1]!);
    expect(screen.getAllByRole('radio', { name: 'Jini banner' })[0]).toBeChecked();
    expect(screen.getAllByRole('radio', { name: 'My own' })[1]).toBeChecked();
    expect(first).toEqual([]);
    expect(second).toEqual([{ bannerMode: 'headless' }]);
  });

  it('edits copy and both links as plain-text patches, using host limits', async () => {
    const patches = host(ConsentBannerFields, { limits: { title: 12 } });
    const user = userEvent.setup();
    expect(screen.getByLabelText('Banner title')).toHaveAttribute('maxlength', '12');
    expect(screen.getByLabelText('Accept button text')).toHaveAttribute('maxlength', '2000');
    await user.type(screen.getByLabelText('Second link text'), 'T');
    await user.type(screen.getByLabelText('Second link URL'), '/');
    await user.type(screen.getByLabelText('Banner message'), '!');
    expect(patches).toEqual([{ secondaryLinkLabel: 'T' }, { secondaryLinkUrl: '/' }, { message: 'Choose cookies.!' }]);
    expect(screen.getByLabelText('Banner message').tagName).toBe('TEXTAREA');
  });

  it('shows each problem under the field it names, marks only that field invalid, and leaves the label clean', () => {
    render(<ConsentBannerFields value={initial} onChange={() => undefined} problems={[
      { code: 'PRIVACY_LINK_REQUIRED', field: 'privacyPolicyUrl', message: 'Link a published privacy page.' },
      { code: 'RECEIPT_STORAGE_UNAVAILABLE', message: 'Storage is down.' },
    ]} />);
    const privacy = screen.getByLabelText('Privacy policy page URL');
    expect(privacy).toHaveAttribute('aria-invalid', 'true');
    expect(privacy).toHaveAccessibleDescription('Link a published privacy page.');
    expect(screen.getByLabelText('Banner title')).not.toHaveAttribute('aria-invalid');
    // A field-less problem is the host's to place; the section never shows it.
    expect(screen.queryByText('Storage is down.')).toBeNull();
  });

  it('disables every control while the host is loading', () => {
    render(<ConsentBannerFields value={initial} onChange={() => { throw new Error('must not write'); }} disabled />);
    expect(screen.getByLabelText('Banner title')).toBeDisabled();
    expect(screen.getByLabelText('Second link URL')).toBeDisabled();
  });

  it('translates labels through the host dictionary', () => {
    render(<ConsentBannerFields value={initial} onChange={() => undefined} dictionary={{ 'Banner title': 'Titre' }} />);
    expect(screen.getByLabelText('Titre')).toHaveValue('Cookies');
  });
});

describe('ConsentRulesFields', () => {
  it('retires the dynamic code switch and help even when the legacy flag is saved', () => {
    const patches = host(ConsentRulesFields as typeof ConsentBannerFields, {}, { ...initial, allowUnsafeEval: true });
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Enable cookie consent on this site' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('switch', { name: 'Allow dynamic code (unsafe-eval)' })).toBeNull();
    // The retired help trigger was independently focusable outside its switch; neither remains.
    expect(screen.queryByRole('button', { name: 'About dynamic code' })).toBeNull();
    expect(screen.queryByText(/weakens the site's script protection/)).toBeNull();
    expect(patches).toEqual([]);
  });

  it('preserves a legacy dynamic code value through ordinary region and policy edits', async () => {
    const before = Object.freeze({ ...initial, allowUnsafeEval: true });
    let current: ConsentSettingsView = before;
    const patches: Partial<ConsentSettingsView>[] = [];
    render(<ConsentRulesFields value={current} onChange={({ patch }) => { patches.push(patch); current = { ...current, ...patch }; }} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Region mode'), 'auto');
    fireEvent.change(screen.getByLabelText('Policy version'), { target: { value: '2' } });
    expect(patches).toEqual([{ regionMode: 'auto' }, { policyVersion: '2' }]);
    expect(current).toEqual({ ...initial, regionMode: 'auto', policyVersion: '2', allowUnsafeEval: true });
    expect(before).toEqual({ ...initial, allowUnsafeEval: true });
    expect(screen.queryByRole('button', { name: 'About dynamic code' })).toBeNull();
  });

  it('keeps the retired control absent when enabling consent without clearing the saved value', async () => {
    const before = { ...initial, enabled: false, allowUnsafeEval: true };
    const patches = host(ConsentRulesFields as typeof ConsentBannerFields, {}, before);
    expect(screen.queryByRole('switch', { name: 'Allow dynamic code (unsafe-eval)' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Enable cookie consent on this site' }));
    expect(screen.queryByRole('switch', { name: 'Allow dynamic code (unsafe-eval)' })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(patches).toEqual([{ enabled: true }]);
    expect({ ...before, ...patches[0] }).toEqual({ ...initial, allowUnsafeEval: true });
  });

  it('keeps normal controls disabled while loading and never offers retired dynamic code edits', async () => {
    const patches = host(ConsentRulesFields as typeof ConsentBannerFields, { disabled: true });
    const toggle = screen.getByRole('switch', { name: 'Enable cookie consent on this site' });
    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText('Region mode')).toBeDisabled();
    expect(screen.getByLabelText('Policy version')).toBeDisabled();
    expect(screen.queryByRole('switch', { name: 'Allow dynamic code (unsafe-eval)' })).toBeNull();
    await userEvent.setup().click(toggle);
    expect(patches).toEqual([]);
  });

  it('toggles consent and offers only the region modes the host allows', async () => {
    const patches = host(ConsentRulesFields as typeof ConsentBannerFields, { regionModes: ['opt-in', 'opt-out'], limits: { policyVersion: 64 } });
    const user = userEvent.setup();
    expect(screen.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['opt-in', 'opt-out']);
    await user.click(screen.getByRole('switch', { name: 'Enable cookie consent on this site' }));
    await user.selectOptions(screen.getByLabelText('Region mode'), 'opt-out');
    expect(patches).toEqual([{ enabled: false }, { regionMode: 'opt-out' }]);
    expect(screen.getByLabelText('Policy version')).toHaveAttribute('maxlength', '64');
  });

  it('keeps showing a stored mode the host no longer offers instead of silently changing it', () => {
    render(<ConsentRulesFields value={{ ...initial, regionMode: 'auto' }} onChange={() => undefined} regionModes={['opt-in']}
      problems={[{ field: 'regionMode', message: 'Automatic needs a trusted region header.' }]} />);
    expect(screen.getByLabelText('Region mode')).toHaveValue('auto');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByLabelText('Region mode')).toHaveAccessibleDescription('Automatic needs a trusted region header.');
  });
});

describe('ConsentLookFields', () => {
  it('changes placement and sets, then resets, a color token', async () => {
    const patches = host(ConsentLookFields as typeof ConsentBannerFields, { placements: ['bottom-bar', 'top-bar', 'corner-x'] });
    const user = userEvent.setup();
    expect(screen.getByLabelText('Position')).toHaveValue('bottom-bar');
    expect(screen.getByRole('option', { name: 'corner-x' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Position'), 'top-bar');
    expect(screen.queryByRole('button', { name: 'Default: Background' })).toBeNull();
    fireEvent.input(screen.getByLabelText('Background'), { target: { value: '#112233' } });
    await user.click(screen.getByRole('button', { name: 'Default: Background' }));
    expect(patches).toEqual([{ placement: 'top-bar' }, { appearance: { backgroundColor: '#112233' } }, { appearance: {} }]);
  });

  it('writes pixel tokens as Npx with the engine bounds, and clearing one unsets it', () => {
    const patches = host(ConsentLookFields as typeof ConsentBannerFields, {}, { ...initial, placement: 'bottom-left', appearance: { padding: '12px', textColor: '#000000' } });
    const padding = screen.getByLabelText('Padding (px)');
    expect(padding).toHaveValue(12);
    expect(padding).toHaveAttribute('min', '8');
    expect(padding).toHaveAttribute('max', '32');
    fireEvent.change(screen.getByLabelText('Text size (px)'), { target: { value: '18' } });
    fireEvent.change(padding, { target: { value: '' } });
    expect(patches).toEqual([{ appearance: { padding: '12px', textColor: '#000000', fontSize: '18px' } }, { appearance: { textColor: '#000000', fontSize: '18px' } }]);
  });

  it('edits custom CSS and shows the engine appearance problems under it', async () => {
    const patches: Partial<ConsentSettingsView>[] = [];
    render(<ConsentLookFields value={{ ...initial, customCss: '' }} onChange={({ patch }) => patches.push(patch)} problems={[{ code: 'contrast', field: 'appearance', message: 'Banner text and background must have at least 4.5:1 contrast.' }]} />);
    const css = screen.getByLabelText('Custom CSS');
    expect(css).toHaveAccessibleDescription('Banner text and background must have at least 4.5:1 contrast.');
    fireEvent.change(css, { target: { value: '#jini-consent{padding:12px}' } });
    expect(patches).toEqual([{ customCss: '#jini-consent{padding:12px}' }]);
  });
});

describe('ConsentPreviewFrame', () => {
  it('puts the HTML only in srcdoc of an iframe with an empty sandbox, never in the host DOM', () => {
    const html = '<p id="leak">Banner</p><script>parent.x=1</script>';
    const view = render(<ConsentPreviewFrame html={html} />);
    const frame = screen.getByTitle('Banner preview');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(html);
    expect(frame.getAttribute('allow')).toBeNull();
    expect(view.container.querySelector('#leak')).toBeNull();
  });

  it('switches between phone (320px) and desktop widths', async () => {
    const user = userEvent.setup();
    render(<ConsentPreviewFrame html="<p>x</p>" dictionary={{ Phone: 'Téléphone' }} />);
    expect(screen.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Téléphone' }));
    expect(screen.getByRole('button', { name: 'Téléphone' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Banner preview')).toHaveStyle({ width: '320px' });
  });

  it('shows the host status instead of a frame while there is no HTML', () => {
    render(<ConsentPreviewFrame html={null} status="Loading preview…" initialWidth="phone" />);
    expect(screen.queryByTitle('Banner preview')).toBeNull();
    expect(screen.getByText('Loading preview…')).toBeInTheDocument();
  });
});

describe('appearance helpers', () => {
  it('returns a new token object and never mutates the one it was given', () => {
    const before = { padding: '12px' };
    expect(withAppearanceToken({ appearance: before, key: 'fontSize', value: '18px' })).toEqual({ padding: '12px', fontSize: '18px' });
    expect(withAppearanceToken({ key: 'padding', value: '' })).toEqual({});
    expect(before).toEqual({ padding: '12px' });
  });

  it('reads only Npx values into a number input', () => {
    expect(pixelInputValue({ value: '12.5px' })).toBe('12.5');
    expect(pixelInputValue({ value: '1em' })).toBe('');
    expect(pixelInputValue({ value: undefined })).toBe('');
  });
});
