/** The provider settings card rendered to static markup with a recording kit: subtitle per store,
 * re-entry notices, field wiring (ids, handles, effective values, required rule), the saved-key
 * action, the error line, and the footer. Handlers are invoked through the props the kit received. */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PluginProviderSettingsDialog, type ProviderSettingsButtonProps, type ProviderSettingsCard, type ProviderSettingsController,
  type ProviderSettingsDialogFrameProps, type ProviderSettingFieldShape, type ProviderSettingFieldViewProps,
} from '../PluginProviderSettingsDialog.js';

const t = (key: string) => `«${key}»`;
const field = (patch: Partial<ProviderSettingFieldShape> & { name: string }): ProviderSettingFieldShape => ({ label: patch.name, secret: false, required: false, saved: false, ...patch });
const card = (patch: Partial<ProviderSettingsCard> = {}): ProviderSettingsCard => ({
  pluginId: 'maps', store: 'site', appliesAt: 'now', usedByThisSite: true, usedBy: [], fields: [], ...patch,
});

function render(controller: Partial<ProviderSettingsController>) {
  const buttons: ProviderSettingsButtonProps[] = [];
  const fields: ProviderSettingFieldViewProps[] = [];
  const dialogs: ProviderSettingsDialogFrameProps[] = [];
  const events: unknown[] = [];
  const requiredCalls: unknown[] = [];
  const focusCalls: unknown[] = [];
  const full: ProviderSettingsController = {
    card: null, values: {}, setValue: (input) => { events.push(['set', input]); }, save: async () => true, useSavedKey: async () => true,
    saving: false, error: null, t, ...controller,
  };
  const html = renderToStaticMarkup(
    <PluginProviderSettingsDialog
      plugin={{ id: 'maps', name: 'Maps' }} agentHandleBase="plugin-maps" legacyCredentialKey="Legacy key notice"
      onClose={() => events.push('close')} onSaved={() => events.push('saved')}
      useSettings={({ pluginId }) => { events.push(['use', pluginId]); return full; }}
      useProviderSettingsFocusHook={(input) => { focusCalls.push(input); }}
      providerSettingRequiredHere={(input) => { requiredCalls.push(input); return input.field.name === 'apiKey'; }}
      kit={{
        Button: (props) => { buttons.push(props); return <button>{props.children}</button>; },
        Dialog: (props) => { dialogs.push(props); return <dialog>{props.children}</dialog>; },
        ProviderSettingField: (props) => { fields.push(props); return <input id={props.id} />; },
      }}
    />,
  );
  return { html, buttons, fields, dialogs, events, requiredCalls, focusCalls };
}

/** The form element the dialog rendered as its child, to drive its submit handler. */
function formOf(children: ReactNode): ReactElement<{ onSubmit: (event: { preventDefault(): void }) => void }> {
  const found = (Array.isArray(children) ? children : [children]).find((child) => isValidElement(child) && child.type === 'form');
  if (!isValidElement<{ onSubmit: (event: { preventDefault(): void }) => void }>(found)) throw new Error('no form rendered');
  return found;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PluginProviderSettingsDialog', () => {
  it('before the card loads: titled dialog, no subtitle, no fields, Save disabled, focus hook told there is no card', () => {
    const { html, buttons, dialogs, fields, events, focusCalls } = render({});
    expect(events).toEqual([['use', 'maps']]);
    expect(dialogs[0]).toMatchObject({ open: true, title: '«{name} settings»'.replace('{name}', 'Maps'), pending: false, className: 'settings-dialog jini-domain-dialog provider-settings-dialog' });
    expect(html).not.toContain('provider-settings-subtitle');
    expect(fields).toEqual([]);
    expect(buttons.map((b) => [b.variant, b.disabled, b.type])).toEqual([['secondary', false, undefined], ['primary', true, 'submit']]);
    expect(buttons[0]!.attrs).toEqual({ 'data-agent-element': 'plugin-maps-settings-close', 'data-agent-role': 'button', 'data-agent-label': 'Close Maps settings' });
    expect(buttons[1]!.attrs).toEqual({ 'data-agent-element': 'plugin-maps-settings-save', 'data-agent-role': 'button', 'data-agent-label': 'Save Maps settings' });
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0]).toMatchObject({ card: null });
  });

  it.each([
    [card({ store: 'site' }), '«Saved for this site»'],
    [card({ store: 'site', projectAvailable: true }), '«Saved for this site only»'],
    [card({ store: 'project', usedBy: ['alpha', 'beta'] }), '«Used by alpha, beta»'],
    [card({ store: 'project' }), '«Saved to your project — not used by any site yet»'],
  ])('subtitles the store the values are sealed in (%#)', (loaded, text) => {
    expect(render({ card: loaded }).html).toContain(`<p class="provider-settings-subtitle">${text}</p>`);
  });

  it('shows both re-entry notices when the card reports them, and neither otherwise', () => {
    const both = render({ card: card({ unreadable: true, legacyCredential: true }) }).html;
    expect(both).toContain("«Saved keys for this plugin can&#x27;t be read on this machine. Enter them again here and save.»");
    expect(both).toContain('«Legacy key notice»');
    const none = render({ card: card() }).html;
    expect(none).not.toContain('provider-settings-notice');
  });

  it('wires each field with its id, handle words, value, and the required rule fed entered and effective values', () => {
    const fields = [
      field({ name: 'apiKey', secret: true, saved: true }),
      field({ name: 'region', default: 'eu' }),
      field({ name: 'base_URL' }),
    ];
    const rendered = render({ card: card({ fields }), values: { region: '  us  ', base_URL: '   ' } });
    expect(rendered.fields.map((f) => [f.handle, f.value, f.field.required, f.pluginName])).toEqual([
      ['plugin-maps-setting-api-key', '', true, 'Maps'],
      ['plugin-maps-setting-region', '  us  ', false, 'Maps'],
      ['plugin-maps-setting-base-url', '   ', false, 'Maps'],
    ]);
    const ids = rendered.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.map((id) => id.slice(id.lastIndexOf('-') + 1))).toEqual(['apiKey', 'region', 'base_URL']);
    expect(rendered.requiredCalls[0]).toEqual({
      field: fields[0], fields, entered: { region: '  us  ', base_URL: '   ' },
      values: { apiKey: 'saved', region: 'us', base_URL: '' },
    });
    expect(rendered.buttons.find((b) => b.type === 'submit')!.disabled).toBe(false);
    rendered.fields[1]!.onChange('ap');
    expect(rendered.events).toContainEqual(['set', { name: 'region', value: 'ap' }]);
  });

  it('offers the saved project key only when this site does not use it yet, and confirms an accepted switch', async () => {
    expect(render({ card: card({ store: 'project', keyId: 'k1', usedByThisSite: true }) }).html).not.toContain('Use the saved key');
    expect(render({ card: card({ store: 'site', keyId: 'k1', usedByThisSite: false }) }).html).not.toContain('Use the saved key');
    const accepted = render({ card: card({ store: 'project', keyId: 'k1', usedByThisSite: false }), useSavedKey: async () => true });
    const useKey = accepted.buttons.find((b) => b.children === '«Use the saved key for this site»')!;
    expect(useKey.disabled).toBe(false);
    useKey.onPress!({});
    await flush();
    expect(accepted.events).toContain('saved');
    const refused = render({ card: card({ store: 'project', keyId: 'k1', usedByThisSite: false }), useSavedKey: async () => false });
    refused.buttons.find((b) => b.children === '«Use the saved key for this site»')!.onPress!({});
    await flush();
    expect(refused.events).not.toContain('saved');
  });

  it('submits through save, hands off to onSaved only when accepted, and never lets the browser submit', async () => {
    for (const [accepted, expected] of [[true, ['saved']], [false, []]] as const) {
      const rendered = render({ card: card(), save: async () => accepted });
      let prevented = false;
      formOf(rendered.dialogs[0]!.children).props.onSubmit({ preventDefault: () => { prevented = true; } });
      await flush();
      expect(prevented).toBe(true);
      expect(rendered.events.filter((event) => event === 'saved')).toEqual(expected);
    }
  });

  it('while saving: pending dialog, disabled Cancel and saved-key action, spinner Save; shows the error line', () => {
    const rendered = render({ card: card({ store: 'project', keyId: 'k1', usedByThisSite: false }), saving: true, error: 'Bad key' });
    expect(rendered.dialogs[0]!.pending).toBe(true);
    expect(rendered.buttons.map((b) => b.disabled)).toEqual([true, true, false]);
    expect(rendered.buttons[2]!.pending).toBe(true);
    expect(rendered.html).toContain('<span class="provider-settings-spinner" aria-hidden="true"></span>«Saving…»');
    expect(rendered.html).toContain('<p class="save-error" role="alert">Bad key</p>');
  });

  it('Cancel and the dialog close both close the card', () => {
    const rendered = render({ card: card() });
    rendered.buttons[0]!.onPress!({});
    rendered.dialogs[0]!.onClose({});
    expect(rendered.events.filter((event) => event === 'close')).toHaveLength(2);
  });
});
