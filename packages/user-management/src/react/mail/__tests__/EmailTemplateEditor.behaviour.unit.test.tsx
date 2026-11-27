import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailTemplateEditor,
  type EmailTemplateEditorControl, type EmailTemplateEditorHooks, type EmailTemplateEditorKit, type EmailTemplateViewControl,
} from '../EmailTemplateEditor.js';
import { fakeEmailKit } from './email-fakes.js';

type Device = 'wide' | 'narrow';
type View = EmailTemplateViewControl<Device>;

function controller(overrides: Partial<EmailTemplateEditorControl> = {}): EmailTemplateEditorControl {
  return {
    view: { kind: 'loaded', data: { subject: 'Welcome' } },
    html: '<p>Hi {{name}}</p>', setHtml: vi.fn(), dirty: false, values: { name: 'Ada' }, setValue: vi.fn(), fieldNames: ['name'],
    mode: 'admin', setMode: vi.fn(), preview: { data: { subject: 'Welcome', html: '<p>Hi</p>', missingFields: [], undeclaredFields: [] }, error: null, pending: false },
    saving: false, saveError: null, savedAt: null, save: vi.fn(async () => undefined),
    name: 'Welcome mail', setName: vi.fn(), commitName: vi.fn(async () => undefined), renameError: null,
    ...overrides,
  };
}

function setup(c: EmailTemplateEditorControl, extra: { view?: Partial<View>; confirmLeave?: () => boolean } = {}) {
  const view: View = { tab: 'preview', setTab: vi.fn(), device: 'narrow', setDevice: vi.fn(), frameRef: () => undefined, paneWidth: 800, ...extra.view };
  const tabBar: { onChange?: (id: string) => void } = {};
  const confirmLeave = vi.fn(extra.confirmLeave ?? (() => true));
  const hooks: EmailTemplateEditorHooks<EmailTemplateEditorControl, View> = {
    useEditorHook: () => c,
    useAdminLocaleHook: () => 'en',
    useEmailTemplateViewHook: () => view,
    useTabBarKeyboardHook: ({ onChange }) => { tabBar.onChange = onChange; return { onKeyDown: () => undefined }; },
    useDirtyGuardHook: vi.fn(() => ({ confirmLeave })),
  };
  const base = fakeEmailKit();
  const kit: EmailTemplateEditorKit<Device> = {
    Icon: (p) => <span data-icon={p.name} />, Chip: base.Chip, Loaded: base.Loaded,
    DevicePreviewFrame: (p) => <div data-testid="frame" data-width={p.width}>{p.children}</div>,
    DevicePreviewToggle: (p) => <span data-testid="device" data-device={p.device} />,
    devicePreviewWidths: { wide: 1200, narrow: 400 }, previewSandbox: 'allow-scripts',
    adminBase: '/admin', adminHref: ({ routePath }) => `/admin${routePath}`,
  };
  render(<EmailTemplateEditor id="tpl-1" hooks={hooks} kit={kit} resolveTabIndex={({ tab, activeId }) => (tab.id === activeId ? 0 : -1)}
    copy={{ t: ({ key }) => `t:${key}`, pageEditorT: ({ key }) => key }} />);
  return { view, hooks, tabBar, confirmLeave };
}

afterEach(cleanup);

describe('EmailTemplateEditor header', () => {
  it('edits the name, commits it on blur and on Enter, and shows the preview subject', () => {
    const c = controller({ preview: { data: { subject: 'Hello Ada', html: '<p/>', missingFields: [], undeclaredFields: [] }, error: null, pending: false } });
    setup(c);
    const name = screen.getByLabelText('t:Template name') as HTMLInputElement;
    expect([name.value, name.disabled]).toEqual(['Welcome mail', false]);
    fireEvent.change(name, { target: { value: 'Renamed' } });
    expect(c.setName).toHaveBeenCalledWith('Renamed');
    name.focus();
    fireEvent.keyDown(name, { key: 'a' });
    expect(c.commitName).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(c.commitName).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Hello Ada').textContent).toBe('Hello Ada');
  });

  it('falls back to the stored subject, and shows none and a disabled name before the template loads', () => {
    setup(controller({ preview: { data: null, error: null, pending: false } }));
    expect(screen.getByTitle('Welcome')).toBeTruthy();
    cleanup();
    setup(controller({ view: { kind: 'loading' }, preview: { data: null, error: null, pending: false } }));
    expect((screen.getByLabelText('t:Template name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('t:Subject')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('loading');
  });

  it('shows rename and save failures as alerts', () => {
    setup(controller({ renameError: 'Name taken', saveError: 'Save failed' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['t:Name taken', 't:Save failed']);
  });
});

describe('EmailTemplateEditor HTML tab', () => {
  it('edits the HTML and saves only a dirty template', () => {
    const c = controller({ dirty: true });
    const { view, tabBar } = setup(c, { view: { tab: 'html' } });
    const source = screen.getByLabelText('t:Template HTML') as HTMLTextAreaElement;
    expect(source.value).toBe('<p>Hi {{name}}</p>');
    fireEvent.change(source, { target: { value: '<p>Bye</p>' } });
    expect(c.setHtml).toHaveBeenCalledWith('<p>Bye</p>');
    fireEvent.click(screen.getByRole('button', { name: 't:Save' }));
    expect(c.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('device')).toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected'), tab.tabIndex])).toEqual([['HTML', 'true', 0], ['Preview', 'false', -1]]);
    fireEvent.click(tabs[1]!);
    expect(view.setTab).toHaveBeenCalledWith('preview');
    tabBar.onChange?.('html');
    expect(view.setTab).toHaveBeenLastCalledWith('html');
  });

  it('styles the Saved word as a success and other state words as hints', () => {
    setup(controller({ savedAt: '2026-11-01T00:00:00Z' }), { view: { tab: 'html' } });
    const saved = screen.getByText('t:Saved');
    expect([saved.className, saved.getAttribute('role')]).toEqual(['save-ok', 'status']);
    cleanup();
    setup(controller({ dirty: true }), { view: { tab: 'html' } });
    expect(screen.getByText('t:Unsaved changes').className).toBe('jini-field-hint');
  });

  it('keeps Save disabled for a clean or saving template', () => {
    setup(controller(), { view: { tab: 'html' } });
    expect((screen.getByRole('button', { name: 't:Save' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    setup(controller({ dirty: true, saving: true }), { view: { tab: 'html' } });
    expect((screen.getByRole('button', { name: 't:Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('EmailTemplateEditor preview tab', () => {
  it('renders the preview at the device width with fill-in values, flags and the As sent toggle', () => {
    const c = controller({ fieldNames: ['name', 'plan'], values: { name: 'Ada' },
      preview: { data: { subject: 'S', html: '<p>Hi Ada</p>', missingFields: ['plan'], undeclaredFields: ['name'] }, error: null, pending: false } });
    setup(c);
    expect(screen.getByTestId('frame').getAttribute('data-width')).toBe('400');
    expect(screen.getByTestId('device').getAttribute('data-device')).toBe('narrow');
    const frame = screen.getByTitle('t:Email preview');
    expect([frame.getAttribute('srcdoc'), frame.getAttribute('sandbox')]).toEqual(['<p>Hi Ada</p>', 'allow-scripts']);
    const name = document.getElementById('email-template-field-name') as HTMLInputElement;
    const plan = document.getElementById('email-template-field-plan') as HTMLInputElement;
    expect([name.value, name.getAttribute('aria-invalid'), plan.value, plan.getAttribute('aria-invalid')]).toEqual(['Ada', 'false', '', 'true']);
    expect(within(name.parentElement!).getByText('t:Not declared').getAttribute('data-tone')).toBe('warning');
    expect(within(plan.parentElement!).queryByText('t:Not declared')).toBeNull();
    fireEvent.change(plan, { target: { value: 'pro' } });
    expect(c.setValue).toHaveBeenCalledWith('plan', 'pro');
    const asSent = screen.getByRole('button', { name: 't:As sent' });
    expect(asSent.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(asSent);
    expect(c.setMode).toHaveBeenCalledWith('sent');
    expect(screen.queryByText("t:Mail apps don't run scripts, so they are removed when it sends.")).toBeNull();
  });

  it('in As sent mode explains the stripped scripts and toggles back to admin', () => {
    const c = controller({ mode: 'sent' });
    setup(c);
    expect(screen.getByText("t:Mail apps don't run scripts, so they are removed when it sends.")).toBeTruthy();
    const asSent = screen.getByRole('button', { name: 't:As sent' });
    expect([asSent.getAttribute('aria-pressed'), asSent.className]).toEqual(['true', 'is-active']);
    fireEvent.click(asSent);
    expect(c.setMode).toHaveBeenCalledWith('admin');
  });

  it('says how to add fields, shows a preview error, and says Updating while a preview is pending', () => {
    setup(controller({ fieldNames: [], preview: { data: null, error: 'Preview failed', pending: true } }));
    expect(screen.getByText('t:No fill-in fields. Add {{name}} to the HTML to make one.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('t:Preview failed');
    expect(screen.getByText('t:Loading…')).toBeTruthy();
    expect(screen.getByText('t:Updating…').getAttribute('role')).toBe('status');
  });

  it('invites writing HTML when there is nothing to preview and nothing pending', () => {
    setup(controller({ preview: { data: null, error: null, pending: false } }));
    expect(screen.getByText('t:Write some HTML to see it here.')).toBeTruthy();
    expect(screen.queryByText('t:Updating…')).toBeNull();
  });
});

describe('EmailTemplateEditor leave guard', () => {
  const outcomes: boolean[] = [];
  const record = (event: MouseEvent) => { outcomes.push(event.defaultPrevented); event.preventDefault(); };
  beforeEach(() => {
    outcomes.length = 0;
    window.history.pushState({}, '', '/admin/email-templates/tpl-1?tab=html');
    document.addEventListener('click', record);
  });
  afterEach(() => {
    document.removeEventListener('click', record);
    document.body.querySelectorAll('[data-test-link]').forEach((el) => el.remove());
  });

  function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = 'go';
    anchor.setAttribute('data-test-link', '');
    for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value);
    document.body.append(anchor);
    return anchor;
  }

  it('reads the dirty flag through the host guard with a locale-bound translator', () => {
    const { hooks } = setup(controller({ dirty: true }));
    expect(hooks.useDirtyGuardHook).toHaveBeenCalledWith({ current: true, original: false }, { host: window, translate: expect.any(Function) });
    const translate = vi.mocked(hooks.useDirtyGuardHook).mock.calls[0]?.[1].translate;
    expect(translate?.('Leave?')).toBe('t:Leave?');
    cleanup();
    const loading = setup(controller({ view: { kind: 'loading' } }));
    expect(loading.hooks.useDirtyGuardHook).toHaveBeenCalledWith({ current: false, original: null }, expect.anything());
  });

  it('blocks a plain in-app link to another admin route when the guard declines, and lets it through when it accepts', () => {
    let accept = false;
    const { confirmLeave } = setup(controller({ dirty: true }), { confirmLeave: () => accept });
    // A blocked click is cancelled and stopped before it reaches the page's own listeners.
    const blocked = [fireEvent.click(link('/admin/pages')), fireEvent.click(link('/admin', { target: '_self' }))];
    expect(blocked).toEqual([false, false]);
    expect(outcomes).toEqual([]);
    accept = true;
    fireEvent.click(link('/admin/email-templates/tpl-1?tab=preview'));
    expect(outcomes).toEqual([false]);
    expect(confirmLeave).toHaveBeenCalledTimes(3);
  });

  it('never asks for clicks that do not replace this editor', () => {
    const { confirmLeave } = setup(controller({ dirty: true }), { confirmLeave: () => false });
    fireEvent.click(link('/admin/email-templates/tpl-1?tab=html'));
    fireEvent.click(link('/blog/post'));
    fireEvent.click(link('/administrator'));
    fireEvent.click(link('https://elsewhere.example.test/admin/pages'));
    fireEvent.click(link('/admin/pages', { target: '_blank' }));
    fireEvent.click(link('/admin/pages', { download: '' }));
    fireEvent.click(link('/admin/pages'), { ctrlKey: true });
    fireEvent.click(link('/admin/pages'), { metaKey: true });
    fireEvent.click(link('/admin/pages'), { shiftKey: true });
    fireEvent.click(link('/admin/pages'), { altKey: true });
    fireEvent.click(link('/admin/pages'), { button: 1 });
    fireEvent.click(screen.getByRole('button', { name: 't:As sent' }));
    expect(confirmLeave).not.toHaveBeenCalled();
    expect(outcomes.slice(0, 11)).toEqual(Array.from({ length: 11 }, () => false));
  });

  it('leaves a click another handler already cancelled alone', () => {
    const cancel = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('click', cancel, true);
    try {
      const { confirmLeave } = setup(controller({ dirty: true }), { confirmLeave: () => false });
      fireEvent.click(link('/admin/pages'));
      expect(confirmLeave).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', cancel, true);
    }
  });

  it('stops listening once the editor unmounts', () => {
    const { confirmLeave } = setup(controller({ dirty: true }), { confirmLeave: () => false });
    cleanup();
    fireEvent.click(link('/admin/pages'));
    expect(confirmLeave).not.toHaveBeenCalled();
    expect(outcomes).toEqual([false]);
  });
});
