import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EmailTemplateEditor, editorStatus,
  type EmailTemplateEditorControl, type EmailTemplateEditorHooks, type EmailTemplateEditorKit, type EmailTemplateViewControl,
} from '../EmailTemplateEditor.js';
import { fakeEmailKit } from './email-fakes.js';

afterEach(cleanup);

type Device = 'wide' | 'narrow';

function controller(overrides: Partial<EmailTemplateEditorControl> = {}): EmailTemplateEditorControl {
  return {
    view: { kind: 'loaded', data: { subject: 'Welcome' } },
    html: '<p>Hi {{name}}</p>', setHtml: vi.fn(), dirty: false, values: {}, setValue: vi.fn(), fieldNames: ['name'],
    mode: 'admin', setMode: vi.fn(), preview: { data: { subject: 'Welcome', html: '<p>Hi</p>', missingFields: [], undeclaredFields: [] }, error: null, pending: false },
    saving: false, saveError: null, savedAt: null, save: vi.fn(async () => undefined),
    name: 'Welcome mail', setName: vi.fn(), commitName: vi.fn(async () => undefined), renameError: null,
    ...overrides,
  };
}

function setup(c: EmailTemplateEditorControl, extra: { locale?: string } = {}) {
  const view: EmailTemplateViewControl<Device> = { tab: 'preview', setTab: vi.fn(), device: 'wide', setDevice: vi.fn(), frameRef: () => undefined, paneWidth: 800 };
  const hooks: EmailTemplateEditorHooks<EmailTemplateEditorControl, EmailTemplateViewControl<Device>> = {
    useEditorHook: vi.fn(() => c),
    useAdminLocaleHook: vi.fn(() => 'admin-locale'),
    useEmailTemplateViewHook: () => view,
    useTabBarKeyboardHook: () => ({ onKeyDown: () => undefined }),
    useDirtyGuardHook: vi.fn(() => ({ confirmLeave: () => true })),
  };
  const base = fakeEmailKit();
  const kit: EmailTemplateEditorKit<Device> = {
    Icon: (p) => <span data-icon={p.name} />, Chip: base.Chip, Loaded: base.Loaded,
    DevicePreviewFrame: (p) => <div data-width={p.width}>{p.children}</div>,
    DevicePreviewToggle: (p) => <span data-device={p.device}>{p.t('Preview width')}</span>,
    devicePreviewWidths: { wide: 1200, narrow: 400 }, previewSandbox: 'allow-scripts',
    adminBase: '/admin', adminHref: ({ routePath }) => `/admin${routePath}`,
  };
  render(<EmailTemplateEditor id="tpl-1" hooks={hooks} kit={kit} resolveTabIndex={() => 0}
    copy={{ t: ({ key }) => key, pageEditorT: ({ locale, key }) => `page[${locale}]:${key}` }} {...extra} />);
  return { hooks };
}

describe('EmailTemplateEditor save state', () => {
  it('editorStatus order is saving, dirty, saved', () => {
    expect(editorStatus({ saving: true, dirty: true, savedAt: 'x' })).toBe('Saving…');
    expect(editorStatus({ saving: false, dirty: true, savedAt: 'x' })).toBe('Unsaved changes');
    expect(editorStatus({ saving: false, dirty: false, savedAt: 'x' })).toBe('Saved');
    expect(editorStatus({ saving: false, dirty: false, savedAt: null })).toBeNull();
  });

  it('preview never marks an unsaved template saved', () => {
    setup(controller({ dirty: true, savedAt: '2026-11-25T10:00:00Z' }));
    const iframe = document.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('srcdoc')).toBe('<p>Hi</p>');
    expect(screen.getByText('Unsaved changes').getAttribute('role')).toBe('status');
    expect(screen.queryByText('Saved')).toBeNull();
    expect(document.querySelector('.save-ok')).toBeNull();
  });

  it('the locale prop wins over the host locale, and the page translator uses it', () => {
    const { hooks } = setup(controller(), { locale: 'fr' });
    expect(hooks.useAdminLocaleHook).toHaveBeenCalled();
    expect(screen.getByText('page[fr]:Preview width')).toBeTruthy();
    expect(document.querySelector('[data-width="1200"]')).toBeTruthy();
  });

  it('Ctrl+S saves, and the back link goes through adminHref', () => {
    const c = controller({ dirty: true });
    setup(c);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(c.save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a.content-editor-back')?.getAttribute('href')).toBe('/admin/email?tab=templates');
  });
});
