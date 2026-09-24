import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_DWELL_MS,
  buildConfirmationSurface,
  renderConfirmationDocument,
} from '../../surfaces/confirmation.js';
import { MCP_UI_ACTION_PLAN_META_KEY, MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '../../resource.js';
import { mountSurface } from './mount-surface.js';

const TOKEN = 'single-use-secret-token';

const DELETE_POST = {
  title: 'Delete this post?',
  description: 'This is a soft delete; the post is moved to the trash.',
  details: [
    { label: 'Title', value: 'Hello <world>' },
    { label: 'Slug', value: '/hello-world' },
    { label: 'Status', value: 'published' },
  ],
  warning: 'This post is currently published. Deleting it removes it from the public site immediately.',
  danger: true,
  confirm: {
    label: 'Delete post',
    toolName: 'content_post_delete',
    params: { id: 'p1', kind: 'post', confirmationToken: TOKEN, decision: 'confirm' },
  },
  cancel: {
    label: 'Cancel',
    toolName: 'content_post_delete',
    params: { id: 'p1', kind: 'post', confirmationToken: TOKEN, decision: 'cancel' },
  },
} as const;

type Surface = ReturnType<typeof mountSurface>;

/** What a person does: the dialog has been on screen for the full dwell, then a trusted click. */
function humanClick(surface: Surface, action: string): void {
  vi.advanceTimersByTime(CONFIRM_DWELL_MS);
  surface.trustedClick(action);
}

describe('renderConfirmationDocument', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title, description, every detail, and the warning', () => {
    const { doc } = mountSurface(renderConfirmationDocument(DELETE_POST));
    expect(doc.querySelector('h1')?.textContent).toBe('Delete this post?');
    expect(doc.querySelector('.mcpui-description')?.textContent).toContain('soft delete');
    expect([...doc.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
      'Hello <world>',
      '/hello-world',
      'published',
    ]);
    expect(doc.querySelector('.mcpui-warning')?.textContent).toContain('removes it from the public site');
  });

  it('styles the affirmative button as destructive only when danger is set', () => {
    const danger = mountSurface(renderConfirmationDocument(DELETE_POST));
    expect(danger.button('confirm').className).toContain('mcpui-button-danger');

    const safe = mountSurface(renderConfirmationDocument({ ...DELETE_POST, danger: false }));
    expect(safe.button('confirm').className).toContain('mcpui-button-primary');
  });

  it('keeps the confirmation token out of everything except the inline script', () => {
    const html = renderConfirmationDocument(DELETE_POST);
    const { doc } = mountSurface(html);
    // The security property this whole surface exists for. The token belongs in the inline script
    // and nowhere else — not in rendered text, not in the title, not in any attribute — because
    // those are the places a host may extract, log, or summarize back to the model.
    expect(doc.querySelector('main.mcpui-surface')?.textContent).not.toContain(TOKEN);
    expect(doc.title).not.toContain(TOKEN);
    for (const element of doc.querySelectorAll('main.mcpui-surface *')) {
      for (const attribute of element.attributes) expect(attribute.value).not.toContain(TOKEN);
    }
    const scripts = [...doc.querySelectorAll('script')].map((node) => node.textContent ?? '');
    expect(scripts.filter((script) => script.includes(TOKEN))).toHaveLength(1);
  });

  it('sends a JSON-RPC tools/call with the confirm params when the affirmative button is clicked', async () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    humanClick(surface, 'confirm');

    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_delete', {
      id: 'p1',
      kind: 'post',
      confirmationToken: TOKEN,
      decision: 'confirm',
    });
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
    expect(surface.status()).toBe('Working…');
    expect(surface.disabledActions()).toEqual([true, true]);

    await surface.settle('resolve', { ok: true });
    expect(surface.status()).toBe('Done.');
    expect(surface.statusState()).toBe('done');
    expect(surface.api.requestTeardown).toHaveBeenCalledTimes(1);
  });

  it('keeps the dwell at 800 ms', () => {
    expect(CONFIRM_DWELL_MS).toBe(800);
  });

  it('sends nothing for a synthetic (untrusted) confirm click, however late it lands', () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    vi.advanceTimersByTime(CONFIRM_DWELL_MS * 10);
    surface.click('confirm');

    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.api.requestTeardown).not.toHaveBeenCalled();
    expect(surface.status()).toBe('');
    expect(surface.disabledActions()).toEqual([false, false]);
  });

  it('sends nothing for a synthetic cancel click, with or without a cancel tool', () => {
    const withTool = mountSurface(renderConfirmationDocument(DELETE_POST));
    vi.advanceTimersByTime(CONFIRM_DWELL_MS);
    withTool.click('cancel');
    expect(withTool.api.callTool).not.toHaveBeenCalled();

    const dismissOnly = mountSurface(renderConfirmationDocument({ ...DELETE_POST, cancel: { label: 'Not now' } }));
    dismissOnly.click('cancel');
    expect(dismissOnly.api.requestTeardown).not.toHaveBeenCalled();
    expect(dismissOnly.status()).toBe('');
  });

  it('ignores a trusted confirm click that lands before the dwell, then sends exactly one after it', () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    vi.advanceTimersByTime(CONFIRM_DWELL_MS - 1);
    surface.trustedClick('confirm');

    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('');
    expect(surface.disabledActions()).toEqual([false, false]);

    vi.advanceTimersByTime(1);
    surface.trustedClick('confirm');
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_delete', {
      id: 'p1',
      kind: 'post',
      confirmationToken: TOKEN,
      decision: 'confirm',
    });
  });

  it('lets a trusted cancel through at once -- backing out needs no dwell', () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    surface.trustedClick('cancel');
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_delete', {
      id: 'p1',
      kind: 'post',
      confirmationToken: TOKEN,
      decision: 'cancel',
    });
  });

  it('starts the dwell when a hidden dialog becomes visible, not when it loaded', () => {
    let visibility: DocumentVisibilityState = 'hidden';
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST), (doc) => {
      Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
    });
    vi.advanceTimersByTime(CONFIRM_DWELL_MS * 5);
    surface.trustedClick('confirm');
    expect(surface.api.callTool).not.toHaveBeenCalled();

    visibility = 'visible';
    surface.doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(CONFIRM_DWELL_MS - 1);
    surface.trustedClick('confirm');
    expect(surface.api.callTool).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    surface.trustedClick('confirm');
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
  });

  it('restarts the dwell when the dialog is hidden and shown again', () => {
    let visibility: DocumentVisibilityState = 'visible';
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST), (doc) => {
      Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
    });
    vi.advanceTimersByTime(CONFIRM_DWELL_MS * 5);
    visibility = 'hidden';
    surface.doc.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    surface.doc.dispatchEvent(new Event('visibilitychange'));
    surface.trustedClick('confirm');
    expect(surface.api.callTool).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CONFIRM_DWELL_MS);
    surface.trustedClick('confirm');
    expect(surface.api.callTool).toHaveBeenCalledTimes(1);
  });

  it('re-enables the buttons and shows the host’s reason when the call fails', async () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    humanClick(surface, 'confirm');
    await surface.settle('reject', new Error('Row is locked'));

    expect(surface.status()).toBe('Failed: Row is locked');
    expect(surface.statusState()).toBe('failed');
    // A rejected call did not happen, so the human must still be able to retry or cancel.
    expect(surface.disabledActions()).toEqual([false, false]);
    expect(surface.api.requestTeardown).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error rejection rather than printing [object Object]', async () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    humanClick(surface, 'confirm');
    await surface.settle('reject', 'plain string failure');
    expect(surface.status()).toBe('Failed: plain string failure');
  });

  it('calls the cancel tool too, so a pending token is burned instead of left live', () => {
    const surface = mountSurface(renderConfirmationDocument(DELETE_POST));
    humanClick(surface, 'cancel');
    expect(surface.api.callTool).toHaveBeenCalledWith('content_post_delete', {
      id: 'p1',
      kind: 'post',
      confirmationToken: TOKEN,
      decision: 'cancel',
    });
  });

  it('dismisses locally when cancel names no tool', () => {
    const surface = mountSurface(
      renderConfirmationDocument({ ...DELETE_POST, cancel: { label: 'Not now' } }),
    );
    humanClick(surface, 'cancel');
    expect(surface.api.callTool).not.toHaveBeenCalled();
    expect(surface.status()).toBe('Dismissed.');
    expect(surface.statusState()).toBe('dismissed');
    expect(surface.api.requestTeardown).toHaveBeenCalledTimes(1);
  });

  it('renders a single button when no cancel is configured at all', () => {
    const { doc } = mountSurface(
      renderConfirmationDocument({ title: 'Proceed?', confirm: { label: 'Yes', toolName: 't', params: {} } }),
    );
    expect(doc.querySelectorAll('button[data-mcpui-action]')).toHaveLength(1);
    expect(doc.querySelector('.mcpui-description')).toBeNull();
    expect(doc.querySelector('.mcpui-details')).toBeNull();
    expect(doc.querySelector('.mcpui-warning')).toBeNull();
  });

  it('uses caller-supplied runtime strings, falling back per-key to the English defaults', async () => {
    const surface = mountSurface(
      renderConfirmationDocument({
        ...DELETE_POST,
        text: { working: 'Suppression…', done: 'Supprimé.' },
        lang: 'fr',
      }),
    );
    expect(surface.doc.documentElement.getAttribute('lang')).toBe('fr');
    humanClick(surface, 'confirm');
    expect(surface.status()).toBe('Suppression…');
    await surface.settle('resolve', null);
    expect(surface.status()).toBe('Supprimé.');

    const failing = mountSurface(renderConfirmationDocument({ ...DELETE_POST, text: { working: 'x' } }));
    humanClick(failing, 'confirm');
    await failing.settle('reject', new Error('nope'));
    expect(failing.status()).toBe('Failed: nope');
  });

  it('reports the app identity and token overrides through to the document', () => {
    const html = renderConfirmationDocument({
      ...DELETE_POST,
      app: { appName: 'host-delete-dialog', appVersion: '3' },
      tokens: { '--jini-mcpui-danger': '#800000' },
    });
    expect(html).toContain('"host-delete-dialog"');
    expect(html).toContain('--jini-mcpui-danger: #800000;');
  });
});

describe('buildConfirmationSurface', () => {
  it('wraps the document in a ui:// EmbeddedResource', () => {
    const resource = buildConfirmationSurface({ ...DELETE_POST, uri: 'ui://example-host/content-post-delete/p1/3' });
    expect(resource.type).toBe('resource');
    expect(resource.resource.uri).toBe('ui://example-host/content-post-delete/p1/3');
    expect(resource.resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.resource.text).toContain('<h1 class="mcpui-title">Delete this post?</h1>');
  });

  it('always writes an action plan, even with no preferredFrameSize asked for -- a host mirror needs the plan unconditionally, not only when frame sizing is also in play', () => {
    const resource = buildConfirmationSurface({ ...DELETE_POST, uri: 'ui://example-host/content-post-delete/p1/3' });
    expect(resource.resource._meta).toEqual({
      [MCP_UI_ACTION_PLAN_META_KEY]: {
        title: 'Delete this post?',
        description: 'This is a soft delete; the post is moved to the trash.',
        actions: [
          { id: 'confirm', label: 'Delete post', variant: 'danger' },
          { id: 'cancel', label: 'Cancel', variant: 'neutral' },
        ],
      },
    });
  });

  it('carries a preferred frame size when one is asked for, alongside the action plan', () => {
    const resource = buildConfirmationSurface({
      ...DELETE_POST,
      uri: 'ui://example-host/x/1',
      preferredFrameSize: ['420px', '460px'],
    });
    expect(resource.resource._meta?.[MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]).toEqual(['420px', '460px']);
    expect(resource.resource._meta).toHaveProperty(MCP_UI_ACTION_PLAN_META_KEY);
  });

  it('omits a cancel action from the plan when the spec has none, matching the rendered document', () => {
    const { cancel: _cancel, ...noCancel } = DELETE_POST;
    const resource = buildConfirmationSurface({ ...noCancel, uri: 'ui://example-host/x/2' });
    const plan = resource.resource._meta?.[MCP_UI_ACTION_PLAN_META_KEY] as { actions: unknown[] };
    expect(plan.actions).toEqual([{ id: 'confirm', label: 'Delete post', variant: 'danger' }]);
  });
});
