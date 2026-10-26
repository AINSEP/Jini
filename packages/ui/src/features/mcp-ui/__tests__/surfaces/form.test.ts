import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildFormSurface, renderFormDocument, type FormSurfaceSpec } from '../../surfaces/form.js';
import { MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '../../resource.js';
import { SURFACE_NOT_PENDING_ERROR_CODE } from '../../surfaces/document.js';
import { mountSurface } from './mount-surface.js';

const SPEC: FormSurfaceSpec = {
  title: 'Schedule this post',
  description: 'Pick when it goes live.',
  details: [{ label: 'Post', value: 'Hello world' }],
  fields: [
    { kind: 'string', name: 'note', label: 'Note', value: 'draft note' },
    { kind: 'number', name: 'delayHours', label: 'Delay (hours)', value: 2 },
    { kind: 'boolean', name: 'notify', label: 'Notify subscribers', value: true },
    { kind: 'enum', name: 'visibility', label: 'Visibility', value: 'public', options: [{ value: 'public' }, { value: 'private' }] },
  ],
  submitLabel: 'Schedule',
  toolName: 'content_post_schedule',
  baseParams: { id: 'p1', confirmationToken: 'tok' },
  cancel: { label: 'Cancel' },
};

describe('renderFormDocument credential autofill guard', () => {
  // Chrome ignores autocomplete="off" on password fields and fills a saved website login into them
  // (the database-transfer destination form's password field, 2026-09-28). Every masked input a
  // form surface emits must say new-password; this is the HTML-string half of host's
  // credential-input-autocomplete guard.
  it('gives every type="password" input autocomplete="new-password", never off', () => {
    const html = renderFormDocument({
      ...SPEC,
      fields: [
        ...SPEC.fields,
        { kind: 'string', name: 'password', label: 'Password', secret: true },
        { kind: 'string', name: 'apiKey', label: 'API key', secret: true },
      ],
    });
    const { doc } = mountSurface(html);
    const masked = [...doc.querySelectorAll('input[type="password"]')];
    expect(masked.map((input) => input.getAttribute('name'))).toEqual(['password', 'apiKey']);
    for (const input of masked) expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(html).not.toMatch(/autocomplete="off"/);
  });
});

describe('renderFormDocument', () => {
  it('requires a token until the explicit local choice, updating accessibility and allowing a blank submit', () => {
    const surface = mountSurface(renderFormDocument({ ...SPEC, baseParams: {}, fields: [
      { kind: 'string', name: 'token', label: 'Token', secret: true, required: true, requiredUnless: { field: 'auth', equals: 'none' }, hint: 'Choose "No authentication" only for a local collector.' },
      { kind: 'enum', name: 'auth', label: 'Authentication', value: 'token', options: [{ value: 'token', label: 'Token' }, { value: 'none', label: 'No authentication (local collector, advanced)' }] },
    ] }));
    const token = surface.doc.querySelector<HTMLInputElement>('input[name="token"]')!;
    const auth = surface.doc.querySelector<HTMLSelectElement>('select[name="auth"]')!;
    expect(token.required).toBe(true);
    surface.submit();
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('Token is required. Choose "No authentication" only for a local collector.');
    auth.value = 'none';
    auth.dispatchEvent(new Event('change', { bubbles: true }));
    expect(token.required).toBe(false);
    expect(token.getAttribute('aria-required')).toBe('false');
    expect(token.labels![0]!.querySelector<HTMLElement>('.mcpui-required')!.hidden).toBe(true);
    auth.value = 'token';
    auth.dispatchEvent(new Event('change', { bubbles: true }));
    expect(token.required).toBe(true);
    auth.value = 'none';
    auth.dispatchEvent(new Event('change', { bubbles: true }));
    surface.submit();
    expect(surface.api.callTool).toHaveBeenCalledWith(SPEC.toolName, { token: '', auth: 'none' });
  });

  it('reveals and re-masks a multiline secret without changing its value or calling a tool', () => {
    const surface = mountSurface(renderFormDocument({
      ...SPEC,
      fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline: true }],
    }));
    const textarea = surface.doc.querySelector<HTMLTextAreaElement>('textarea[name="credential"]')!;
    const toggle = surface.doc.querySelector<HTMLButtonElement>('button[data-mcpui-secret-toggle]')!;
    const credential = '-----BEGIN KEY-----\n  abc+123==\n\n-----END KEY-----\n';
    textarea.value = credential;
    expect(textarea.getAttribute('autocomplete')).toBe('off');
    expect(textarea.getAttribute('spellcheck')).toBe('false');
    expect(textarea.getAttribute('style')).toBe('-webkit-text-security: disc;');
    const click = () => surface.asUser(() => toggle.dispatchEvent(new Event('click', { bubbles: true })));

    click();
    expect(toggle.getAttribute('aria-label')).toBe('Hide Credential');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(textarea.getAttribute('style')).toBe('-webkit-text-security: none;');
    expect(textarea.value).toBe(credential);
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.api.requestTeardown).not.toHaveBeenCalled();

    click();
    expect(toggle.getAttribute('aria-label')).toBe('Show Credential');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(textarea.getAttribute('style')).toBe('-webkit-text-security: disc;');
    expect(textarea.value).toBe(credential);
    expect(surface.api.callTool).not.toHaveBeenCalled();
  });

  it('gives a single-line secret an eye toggle that unmasks it without submitting, and re-masks after a save', async () => {
    const surface = mountSurface(renderFormDocument({
      ...SPEC,
      fields: [{ kind: 'string', name: 'token', label: 'Token', secret: true, required: true }],
      baseParams: {},
    }));
    const input = surface.doc.querySelector<HTMLInputElement>('input[name="token"]')!;
    const toggle = surface.doc.querySelector<HTMLButtonElement>('button[data-mcpui-secret-toggle]')!;
    expect(input.type).toBe('password');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-controls')).toBe(input.id);
    expect(toggle.getAttribute('aria-label')).toBe('Show Token');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    input.value = 'sk-live-123';
    surface.asUser(() => toggle.dispatchEvent(new Event('click', { bubbles: true })));
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(toggle.getAttribute('aria-label')).toBe('Hide Token');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(surface.api.callTool).not.toHaveBeenCalled();
    // A script-dispatched click is not a person: it must not unmask anything.
    toggle.dispatchEvent(new Event('click', { bubbles: true }));
    expect(input.type).toBe('text');
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ token: 'sk-live-123' });
    surface.calls[0]!.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show Token');
  });

  it('keeps Enter for multiline secret entry and submits every newline and space unchanged', () => {
    const surface = mountSurface(renderFormDocument({
      ...SPEC,
      fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline: true, required: true }],
      baseParams: {},
    }));
    const textarea = surface.doc.querySelector<HTMLTextAreaElement>('textarea[name="credential"]')!;
    const credential = '\n  first line \n\nsecond line\n';
    textarea.value = credential;
    surface.pressEnter(textarea);
    expect(surface.api.callTool).not.toHaveBeenCalled();
    surface.submit();
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
    expect(surface.calls[0]?.params).toEqual({ credential });
    expect(new TextEncoder().encode(surface.calls[0]!.params.credential as string))
      .toEqual(new TextEncoder().encode(credential));
  });

  it('uses localized show and hide labels from the form text contract throughout the toggle cycle', () => {
    const surface = mountSurface(renderFormDocument({
      ...SPEC,
      fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline: true }],
      text: { showSecret: 'Afficher <clé>', hideSecret: 'Masquer "clé"' },
    }));
    const toggle = surface.doc.querySelector<HTMLButtonElement>('button[data-mcpui-secret-toggle]')!;
    const click = () => surface.asUser(() => toggle.dispatchEvent(new Event('click', { bubbles: true })));
    expect(toggle.getAttribute('aria-label')).toBe('Afficher <clé> Credential');
    // Only the two decorative eye glyphs: host text never becomes markup.
    expect([...toggle.children].map((child) => child.tagName.toLowerCase())).toEqual(['svg', 'svg']);
    click();
    expect(toggle.getAttribute('aria-label')).toBe('Masquer "clé" Credential');
    click();
    expect(toggle.getAttribute('aria-label')).toBe('Afficher <clé> Credential');
    expect(surface.api.callTool).not.toHaveBeenCalled();
  });

  it('preserves clipboard CRLF, CR and LF bytes across repeated pastes and reveal toggles', () => {
    const surface = mountSurface(renderFormDocument({ ...SPEC, fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline: true }], baseParams: {} }));
    const textarea = surface.doc.querySelector<HTMLTextAreaElement>('textarea')!;
    function paste(text: string) {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? text : '' } });
      surface.asUser(() => textarea.dispatchEvent(event));
    }
    const credential = '  first\r\nsecond\rthird\n\n';
    paste(credential);
    expect(textarea.value).toBe('  first\nsecond\nthird\n\n');
    textarea.setSelectionRange(8, 14);
    paste('replacement\r\nline');
    const expected = '  first\r\nreplacement\r\nline\rthird\n\n';
    const toggle = surface.doc.querySelector<HTMLButtonElement>('button[data-mcpui-secret-toggle]')!;
    surface.asUser(() => toggle.dispatchEvent(new Event('click', { bubbles: true })));
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ credential: expected });
    expect(new TextEncoder().encode(surface.calls[0]!.params.credential as string)).toEqual(new TextEncoder().encode(expected));
  });

  it('uses the newly edited textarea value instead of an obsolete clipboard snapshot', () => {
    const surface = mountSurface(renderFormDocument({ ...SPEC, fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline: true }], baseParams: {} }));
    const textarea = surface.doc.querySelector<HTMLTextAreaElement>('textarea')!;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'first\r\nsecond' } });
    surface.asUser(() => textarea.dispatchEvent(event));
    textarea.value = 'edited\nvalue';
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ credential: 'edited\nvalue' });
  });

  it('renders one control per field inside a real form', () => {
    const { doc } = mountSurface(renderFormDocument(SPEC));
    const form = doc.querySelector('form')!;
    expect(form.hasAttribute('novalidate')).toBe(true);
    expect(form.querySelector('input[name="note"]')).not.toBeNull();
    expect(form.querySelector('input[name="delayHours"]')?.getAttribute('type')).toBe('number');
    expect(form.querySelector('input[name="notify"]')?.getAttribute('type')).toBe('checkbox');
    expect(form.querySelector('select[name="visibility"]')).not.toBeNull();
    expect(doc.querySelector('.mcpui-description')?.textContent).toBe('Pick when it goes live.');
    expect(doc.querySelector('dd')?.textContent).toBe('Hello world');
  });

  it('coerces each value by its declared kind before calling the tool, and merges base params underneath', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.submit();
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_schedule', {
      id: 'p1',
      confirmationToken: 'tok',
      note: 'draft note',
      // A number, not the string "2" the DOM hands back.
      delayHours: 2,
      notify: true,
      visibility: 'public',
    });
  });

  it('lets a field shadow a base param of the same name, never the other way round', () => {
    const surface = mountSurface(
      renderFormDocument({
        ...SPEC,
        fields: [{ kind: 'string', name: 'note', label: 'Note', value: 'from-field' }],
        baseParams: { note: 'from-base' },
      }),
    );
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ note: 'from-field' });
  });

  it('sends null for a blank number rather than NaN or an empty string', () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, fields: [{ kind: 'number', name: 'n', label: 'N' }], baseParams: {} }),
    );
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ n: null });
  });

  it('blocks submission and names every unfilled required field', () => {
    const surface = mountSurface(
      renderFormDocument({
        ...SPEC,
        fields: [
          { kind: 'string', name: 'note', label: 'Note', required: true },
          { kind: 'number', name: 'delayHours', label: 'Delay (hours)', required: true },
          { kind: 'boolean', name: 'ack', label: 'I understand', required: true },
          { kind: 'enum', name: 'visibility', label: 'Visibility', required: true, options: [{ value: 'public' }] },
        ],
      }),
    );
    surface.submit();
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('Please complete: Note, Delay (hours), I understand, Visibility');
    expect(surface.statusState()).toBe('invalid');
    // Not disabled — the human has to be able to fix the form and try again.
    expect(surface.disabledActions()).toEqual([false, false]);
  });

  it('accepts a required checkbox only when it is checked', () => {
    const surface = mountSurface(
      renderFormDocument({
        ...SPEC,
        fields: [{ kind: 'boolean', name: 'ack', label: 'I understand', required: true, value: true }],
        baseParams: {},
      }),
    );
    surface.submit();
    expect(surface.calls[0]?.params).toEqual({ ack: true });
  });

  it('rejects a non-numeric entry in a required number field', () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, fields: [{ kind: 'number', name: 'n', label: 'N', required: true }] }),
    );
    surface.doc.querySelector<HTMLInputElement>('input[name="n"]')!.value = 'not-a-number';
    surface.submit();
    expect(surface.status()).toContain('Please complete: N');
  });

  it('reports success and asks to be torn down once the tool resolves', async () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.submit();
    expect(surface.status()).toBe('Working…');
    expect(surface.disabledActions()).toEqual([true, true]);
    await surface.settle('resolve', { scheduled: true });
    expect(surface.status()).toBe('Done.');
    expect(surface.api.requestTeardown).toHaveBeenCalledTimes(1);
  });

  it('re-enables the form and shows the reason when the tool rejects', async () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.submit();
    await surface.settle('reject', new Error('Schedule conflict'));
    expect(surface.status()).toBe('Failed: Schedule conflict');
    expect(surface.disabledActions()).toEqual([false, false]);
  });

  it('keeps a submitted form disabled, and Enter inert, once the host says the dialog expired', async () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.submit();
    await surface.settle('reject', Object.assign(new Error('gone'), { data: { code: SURFACE_NOT_PENDING_ERROR_CODE } }));
    expect(surface.status()).toBe('This dialog expired. Ask again.');
    expect(surface.statusState()).toBe('expired');
    expect(surface.disabledActions()).toEqual([true, true]);

    const input = surface.doc.querySelector('input[type="text"]')!;
    surface.pressEnter(input);
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
  });

  it('keeps the form disabled when a cancel tool reports the dialog expired', async () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon' } }),
    );
    surface.trustedClick('cancel');
    await surface.settle('reject', Object.assign(new Error('gone'), { data: { code: SURFACE_NOT_PENDING_ERROR_CODE } }));
    expect(surface.status()).toBe('This dialog expired. Ask again.');
    expect(surface.disabledActions()).toEqual([true, true]);
  });

  it('dismisses locally when cancel names no tool', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.trustedClick('cancel');
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('Dismissed.');
    expect(surface.api.requestTeardown).toHaveBeenCalledTimes(1);
  });

  it('calls the cancel tool when one is named, and reports its failure', async () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon', params: { id: 'p1' } } }),
    );
    surface.trustedClick('cancel');
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_abandon', { id: 'p1' });
    await surface.settle('resolve', null);
    expect(surface.status()).toBe('Dismissed.');

    const failing = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon' } }),
    );
    failing.trustedClick('cancel');
    expect(failing.api.callTool).toHaveBeenCalledWith('content_post_abandon', {});
    await failing.settle('reject', new Error('already gone'));
    expect(failing.status()).toBe('Failed: already gone');
    expect(failing.disabledActions()).toEqual([false, false]);
  });

  it('renders a lone submit button, no details and no warning, for a minimal spec', () => {
    const { doc } = mountSurface(
      renderFormDocument({ title: 'Rename', fields: [], submitLabel: 'Save', toolName: 'rename' }),
    );
    expect(doc.querySelectorAll('button[data-mcpui-action]')).toHaveLength(1);
    // NOT "submit" — a type="submit" button inside this <form> would trigger native form
    // submission on click, which the sandbox this document actually renders in (allow-scripts, no
    // allow-forms) blocks before the "submit" event is even dispatched. See the "does not depend on
    // the form's submit event" and "submits via a click" tests below for the behavior this guards.
    expect(doc.querySelector('button[data-mcpui-action="submit"]')?.getAttribute('type')).toBe('button');
    expect(doc.querySelector('.mcpui-details')).toBeNull();
    expect(doc.querySelector('.mcpui-description')).toBeNull();
    expect(doc.querySelector('.mcpui-warning')).toBeNull();
    expect(doc.querySelector('button[data-mcpui-action="submit"]')?.className).toContain('mcpui-button-primary');
  });

  it('submits via a click on the submit button, the only path the target sandbox permits', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.trustedClick('submit');
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_schedule', {
      id: 'p1',
      confirmationToken: 'tok',
      note: 'draft note',
      delayHours: 2,
      notify: true,
      visibility: 'public',
    });
  });

  it('does not depend on the form\'s submit event — this is the exact bug the click-based rewrite fixes', () => {
    // A sandboxed iframe with `allow-scripts` and no `allow-forms` never dispatches "submit" at all
    // (the WHATWG form-submission algorithm's sandboxed-forms check runs before that dispatch), so a
    // real regression here would show up as: production stays broken while this spec, if it drove
    // "submit" directly, stayed green. Firing "submit" here and asserting NOTHING happened is what
    // proves the surface script no longer relies on an event the real target environment never
    // sends — mount-surface.ts's `submit()` now drives the button's "click" for that same reason.
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.doc.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('');
  });

  it('submits on Enter in a single-line text field, restoring the parity a real <form> would have given away for free', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    const note = surface.doc.querySelector<HTMLInputElement>('input[name="note"]')!;
    surface.pressEnter(note);
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_schedule', {
      id: 'p1',
      confirmationToken: 'tok',
      note: 'draft note',
      delayHours: 2,
      notify: true,
      visibility: 'public',
    });
  });

  /**
   * `setBusy` disables the action buttons and nothing else, so the button path was already guarded
   * — but the Enter handler is bound to controls that stay enabled, and a held Enter key repeats.
   * Every repeat used to produce another `tools/call` against a still-pending one. The base params
   * here carry a `confirmationToken`, which would let a token-checking tool reject the extras; an
   * ordinary state-mutating tool has nothing to reject them with.
   */
  it('ignores repeated Enter while a call is in flight, and re-arms only once that call has failed', async () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    const note = surface.doc.querySelector<HTMLInputElement>('input[name="note"]')!;
    const pressEnter = () => surface.pressEnter(note);

    pressEnter();
    pressEnter();
    pressEnter();
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);

    // The button path shares the flag rather than relying on `disabled` alone.
    surface.submit();
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);

    // A rejected call did not happen, so the human must be able to retry — same reasoning as the
    // `setBusy(false)` on the failure branch.
    await surface.settle('reject', new Error('upstream down'));
    pressEnter();
    expect(surface.api.callTool).toHaveBeenCalledTimes(2);
  });

  it('does not let Enter submit on top of an in-flight cancel', () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon', params: { id: 'p1' } } }),
    );

    surface.trustedClick('cancel');
    surface.pressEnter(surface.doc.querySelector<HTMLInputElement>('input[name="note"]')!);

    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_abandon', { id: 'p1' });
  });

  it('does not submit on Enter in a checkbox, matching what native implicit submission would have done', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    const notify = surface.doc.querySelector<HTMLInputElement>('input[name="notify"]')!;
    surface.pressEnter(notify);
    expect(surface.api.callTool).not.toHaveBeenCalled();
  });

  it('does not submit on Enter in a multiline field, so a newline can still be typed', () => {
    const surface = mountSurface(
      renderFormDocument({
        ...SPEC,
        fields: [{ kind: 'string', name: 'note', label: 'Note', multiline: true }],
      }),
    );
    const note = surface.doc.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!;
    surface.pressEnter(note);
    expect(surface.api.callTool).not.toHaveBeenCalled();
  });

  it('renders the warning and the destructive variant when the form is itself a confirmation', () => {
    const { doc } = mountSurface(
      renderFormDocument({ ...SPEC, warning: 'This cannot be undone.', danger: true }),
    );
    expect(doc.querySelector('.mcpui-warning')?.textContent).toBe('This cannot be undone.');
    expect(doc.querySelector('button[data-mcpui-action="submit"]')?.className).toContain('mcpui-button-danger');
  });

  it('honors text, lang, tokens and app identity overrides', () => {
    const html = renderFormDocument({
      ...SPEC,
      text: { working: 'Envoi…' },
      lang: 'fr',
      tokens: { '--jini-mcpui-accent': '#00aa88' },
      app: { appName: 'host-schedule-form', appVersion: '9' },
    });
    const surface = mountSurface(html);
    expect(surface.doc.documentElement.getAttribute('lang')).toBe('fr');
    expect(html).toContain('--jini-mcpui-accent: #00aa88;');
    expect(html).toContain('"host-schedule-form"');
    surface.submit();
    expect(surface.status()).toBe('Envoi…');
  });
  describe('acts only on what a person does', () => {
    // element.click(), dispatchEvent and a synthetic keydown from any script produce isTrusted ===
    // false. A form's submit is a state-changing tool call, so the same rule as the confirmation.
    it('sends nothing for a synthetic click on submit', () => {
      const surface = mountSurface(renderFormDocument(SPEC));
      surface.click('submit');
      expect(surface.api.callTool).not.toHaveBeenCalled();
      expect(surface.status()).toBe('');
    });

    it('sends nothing for a synthetic Enter in a text field', () => {
      const surface = mountSurface(renderFormDocument(SPEC));
      surface.doc
        .querySelector<HTMLInputElement>('input[name="note"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(surface.api.callTool).not.toHaveBeenCalled();
      expect(surface.status()).toBe('');
    });

    it('sends nothing for a synthetic cancel click, with or without a cancel tool', () => {
      const withTool = mountSurface(
        renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon' } }),
      );
      withTool.click('cancel');
      expect(withTool.api.callTool).not.toHaveBeenCalled();
      expect(withTool.status()).toBe('');

      const dismissOnly = mountSurface(renderFormDocument(SPEC));
      dismissOnly.click('cancel');
      expect(dismissOnly.api.requestTeardown).not.toHaveBeenCalled();
      expect(dismissOnly.status()).toBe('');
      expect(dismissOnly.disabledActions()).toEqual([false, false]);
    });
  });
});

describe('buildFormSurface', () => {
  it('refuses a stored secret before creating an HTML resource with an error that never echoes it', () => {
    for (const multiline of [false, true]) {
      expect(() => buildFormSurface({
        ...SPEC,
        uri: 'ui://example-host/credentials/p1',
        fields: [{ kind: 'string', name: 'credential-sentinel-739', label: 'Credential', secret: true, multiline, value: 'credential-sentinel-739' }],
      })).toThrowError(new Error('Secret fields cannot have a pre-filled value. Omit value.'));
    }
  });

  it('rejects a hidden secret prefill in base params before emitting the script', () => {
    expect(() => buildFormSurface({
      ...SPEC, uri: 'ui://example-host/credentials/p1',
      fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true }],
      baseParams: { credential: 'credential-sentinel-739' },
    })).toThrowError(new Error('Secret fields cannot have a pre-filled value. Omit value.'));
  });

  it('requires secret values to be omitted even when the supplied prefill is empty', () => {
    for (const multiline of [false, true]) {
      expect(() => buildFormSurface({
        ...SPEC,
        uri: 'ui://example-host/credentials/p1',
        fields: [{ kind: 'string', name: 'credential', label: 'Credential', secret: true, multiline, value: '' }],
      })).toThrowError(new Error('Secret fields cannot have a pre-filled value. Omit value.'));
    }
  });

  it('wraps the document in a ui:// EmbeddedResource', () => {
    const resource = buildFormSurface({ ...SPEC, uri: 'ui://example-host/schedule/p1' });
    expect(resource.resource.uri).toBe('ui://example-host/schedule/p1');
    expect(resource.resource.text).toContain('Schedule this post');
    expect(resource.resource).not.toHaveProperty('_meta');
  });

  it('carries a preferred frame size when one is asked for', () => {
    const resource = buildFormSurface({ ...SPEC, uri: 'ui://example-host/schedule/p1', preferredFrameSize: ['500px', '600px'] });
    expect(resource.resource._meta).toEqual({ [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['500px', '600px'] });
  });
});

it('an alternative submit action collects checked fields and carries its own action without duplicating submission', () => {
  const surface = mountSurface(renderFormDocument({ ...SPEC,
    fields: [{ kind: 'multi-enum', name: 'selections', label: 'Plugins', value: ['theme'], options: [{ value: 'theme', label: 'Theme' }, { value: 'design', label: 'Design' }] }],
    baseParams: { pluginAction: 'use' }, submitLabel: 'Use',
    additionalSubmitActions: [{ id: 'auto', label: "Don't ask again", params: { pluginAction: 'auto' } }],
  }));
  const button = surface.doc.querySelector<HTMLButtonElement>('[data-mcpui-action="submit:auto"]')!;
  expect(button.textContent).toBe("Don't ask again");
  surface.asUser(() => button.dispatchEvent(new Event('click', { bubbles: true })));
  expect(surface.calls[0]?.params).toEqual({ pluginAction: 'auto', selections: ['theme'] });
  surface.asUser(() => button.dispatchEvent(new Event('click', { bubbles: true })));
  expect(surface.api.callTool).toHaveBeenCalledTimes(1);
});

// Exact hashes include the intended detail-layout fix (c4c19234) and shared requiredUnless script
// (4b31ffd20); all other emitted bytes stay pinned.
describe('renderFormDocument exact output', () => {
  const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const cases: ReadonlyArray<readonly [string, FormSurfaceSpec, string]> = [
    ['shared spec with an untargeted cancel', SPEC, '17c325fc582fa815dae74d03d892d4238ea2030e0eb6fc2619e6d9de54109c02'],
    ['minimal spec with no cancel', { title: 'T', fields: [], submitLabel: 'Go', toolName: 'tool' }, '824ceaac2d1d20e2427cc1efb6fc7e9f6cfbc7c8eba2d0ecf2cea2a037b021d7'],
    ['every option, with a tool-routed cancel', {
      ...SPEC, warning: 'Careful <now>', danger: true,
      fields: [...SPEC.fields, { kind: 'string', name: 'key', label: 'Key', secret: true, multiline: true }],
      additionalSubmitActions: [{ id: 'later', label: 'Later', params: { when: 'later' } }],
      cancel: { label: 'Stop', toolName: 'cancel_tool', params: { reason: 'x' } },
      text: { working: 'W', showSecret: 'Reveal' }, app: { appName: 'a', appVersion: '2' }, lang: 'fr', tokens: { '--jini-mcpui-bg': '#000' },
    }, '6bba77b10c0ce1cd1ccdb949efbc9374b31b49eedc204796252ef306797eb52a'],
    ['a cancel tool with no params', { ...SPEC, cancel: { label: 'Stop', toolName: 'cancel_tool' } }, '263df9e46bfe6675d1cb7fffe8d659dbcbc125ce469cda968a89f4872d8f42d9'],
  ];
  it.each(cases)('%s', (_name, spec, expected) => {
    expect(digest(renderFormDocument(spec))).toBe(expected);
  });

  it('pins the framed resource wrapper', () => {
    expect(digest(buildFormSurface({ ...SPEC, uri: 'ui://h/f/1', preferredFrameSize: ['1px', '2px'] }))).toBe('e9157df4b49bbfef5b062111e99b289b6b120540e0c7f147a766d29ee2a6c23d');
  });

  it('pins the unframed resource wrapper', () => {
    expect(digest(buildFormSurface({ ...SPEC, uri: 'ui://h/f/2' }))).toBe('26fdbd23f82850f8438ed2c2d5a4841ffa91c9b2a782005f8e66871afb5437db');
  });
});
