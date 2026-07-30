import { describe, expect, it } from 'vitest';
import { buildFormSurface, renderFormDocument, type FormSurfaceSpec } from '../../surfaces/form.js';
import { MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '../../resource.js';
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

describe('renderFormDocument', () => {
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

  it('dismisses locally when cancel names no tool', () => {
    const surface = mountSurface(renderFormDocument(SPEC));
    surface.click('cancel');
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('Dismissed.');
    expect(surface.api.requestTeardown).toHaveBeenCalledTimes(1);
  });

  it('calls the cancel tool when one is named, and reports its failure', async () => {
    const surface = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon', params: { id: 'p1' } } }),
    );
    surface.click('cancel');
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_abandon', { id: 'p1' });
    await surface.settle('resolve', null);
    expect(surface.status()).toBe('Dismissed.');

    const failing = mountSurface(
      renderFormDocument({ ...SPEC, cancel: { label: 'Cancel', toolName: 'content_post_abandon' } }),
    );
    failing.click('cancel');
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
    expect(doc.querySelector('button[data-mcpui-action="submit"]')?.getAttribute('type')).toBe('submit');
    expect(doc.querySelector('.mcpui-details')).toBeNull();
    expect(doc.querySelector('.mcpui-description')).toBeNull();
    expect(doc.querySelector('.mcpui-warning')).toBeNull();
    expect(doc.querySelector('button[data-mcpui-action="submit"]')?.className).toContain('mcpui-button-primary');
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
      app: { appName: 'tovu-schedule-form', appVersion: '9' },
    });
    const surface = mountSurface(html);
    expect(surface.doc.documentElement.getAttribute('lang')).toBe('fr');
    expect(html).toContain('--jini-mcpui-accent: #00aa88;');
    expect(html).toContain('"tovu-schedule-form"');
    surface.submit();
    expect(surface.status()).toBe('Envoi…');
  });
});

describe('buildFormSurface', () => {
  it('wraps the document in a ui:// EmbeddedResource', () => {
    const resource = buildFormSurface({ ...SPEC, uri: 'ui://tovu/schedule/p1' });
    expect(resource.resource.uri).toBe('ui://tovu/schedule/p1');
    expect(resource.resource.text).toContain('Schedule this post');
    expect(resource.resource).not.toHaveProperty('_meta');
  });

  it('carries a preferred frame size when one is asked for', () => {
    const resource = buildFormSurface({ ...SPEC, uri: 'ui://tovu/schedule/p1', preferredFrameSize: ['500px', '600px'] });
    expect(resource.resource._meta).toEqual({ [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['500px', '600px'] });
  });
});
