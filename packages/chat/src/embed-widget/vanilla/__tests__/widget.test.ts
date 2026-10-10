import { it, expect } from 'vitest';
import { mountVanillaChat, type MountVanillaChatArgs } from '../index.js';
import type { RunHandlers } from '../../../core/transport.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

it('mounts an accessible dialog, streams replies, traps focus, confirms reset and cleans up', async () => {
  const element = document.createElement('div');
  document.body.replaceChildren(element);
  let handlers: RunHandlers | undefined;
  let seq = 0;
  let renderFrame: (() => void) | undefined;
  const mount = mountVanillaChat({ element, document, agentId: 'visitor', directiveEventName: 'client_directive',
    suggestions: ['Find posts', 'Find pages'],
    ids: () => String(++seq), createAbortController: () => new AbortController(),
    transport: { async startRun(_input, callbacks) { handlers = callbacks; return { runId: 'r' }; },
      async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {} },
    session: { load: () => ({ open: false, messages: [] }), save: () => {}, clear: () => {}, enqueue: () => {}, drain: () => null },
    pageActions: { allows: () => true, navigate: () => true, execute: () => true, clearHighlight: () => {} },
    scheduleFrame: ({ callback }) => { renderFrame = callback; return () => { renderFrame = undefined; }; }, renderMarkdown: ({ content, element: target }) => { target.textContent = content; },
    copy: { title: 'Chat', fabLabel: 'Open chat', placeholder: 'Message', send: 'Send', stop: 'Stop', close: 'Close', reset: 'New thread',
      resetQuestion: 'Discard thread?', confirm: 'Confirm', confirmDraft: 'Discard draft', keep: 'Keep', proposalGo: 'Go', proposalLabel: ({ title }) => title, thinking: 'Replying',
      greeting: 'Ask about this site.', suggestionsLabel: 'Example prompts' },
  });
  const fab = element.querySelector<HTMLButtonElement>('.jini-chat-bubble')!;
  const dialog = element.querySelector<HTMLElement>('[role="dialog"]')!;
  const textarea = element.querySelector('textarea')!;
  expect(dialog.hidden).toBe(true);
  fab.click();
  expect(dialog.hidden).toBe(false);
  const send = element.querySelector<HTMLButtonElement>('.jini-chat-vanilla__send')!;
  expect(send.disabled).toBe(true);
  textarea.value = '   ';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  expect(send.disabled).toBe(true);
  textarea.value = 'A question';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  expect(send.disabled).toBe(false);
  Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'New thread')!.click();
  expect(dialog.querySelector('.jini-chat-vanilla__discard')).toHaveTextContent('Discard draft');
  expect(document.activeElement?.textContent).toBe('Keep');
  Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Keep')!.click();
  textarea.focus();
  textarea.value = '';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  expect(send.disabled).toBe(true);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(textarea);
  expect(fab.getAttribute('aria-expanded')).toBe('true');
  expect(element.querySelector('.jini-chat-vanilla__greeting')?.textContent).toBe('Ask about this site.');
  const suggestion = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Find posts')!;
  suggestion.click();
  expect(textarea.value).toBe('Find posts');
  expect(send.disabled).toBe(false);
  expect(document.activeElement).toBe(textarea);
  expect(suggestion.closest('.jini-chat-vanilla__messages')).not.toBeNull();
  expect(mount.controller.getState({}).messages).toHaveLength(0);
  expect(element.querySelector('.jini-chat-vanilla__messages')!.getAttribute('aria-live')).toBe('off');
  expect(element.querySelector('.jini-chat-vanilla__announcements')!.getAttribute('aria-live')).toBe('polite');
  expect(element.querySelectorAll('svg')).toHaveLength(3);
  expect(element.querySelector('.jini-chat-vanilla__send')).toHaveAttribute('aria-label', 'Send');
  expect(fab.querySelector('path')?.getAttribute('d')).toBe('M6 6l12 12M18 6L6 18');
  expect(document.querySelector('link[href*="remixicon"]')).toBeNull();
  textarea.value = 'Hello';
  element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await Promise.resolve();
  handlers!.onEvent({ kind: 'text', text: 'Welcome' });
  renderFrame!();
  expect(element.querySelector('.jini-chat-vanilla__message--assistant')!.textContent).toBe('Welcome');
  expect(element.querySelector<HTMLElement>('.jini-chat-vanilla__greeting')!.hidden).toBe(true);
  expect(element.querySelector<HTMLElement>('.jini-chat-vanilla__suggestions')!.hidden).toBe(true);
  handlers!.onDone([{ kind: 'text', text: 'Welcome' }]);
  const visibleButtons = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(b => !b.closest('[hidden]'));
  const reset = visibleButtons().find(b => b.textContent === 'New thread')!;
  // With a blank settled draft, Send is disabled and Stop is hidden: the textarea is the last tab stop.
  expect(send.disabled).toBe(true);
  expect(Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Stop')!.hidden).toBe(true);
  textarea.focus();
  const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  textarea.dispatchEvent(forward);
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(reset);
  const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  reset.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(textarea);
  const confirmation = dialog.querySelector<HTMLElement>('.jini-chat-vanilla__confirmation')!;
  expect(confirmation.hidden).toBe(true);
  reset.click();
  expect(confirmation.hidden).toBe(false);
  expect(document.activeElement).toBe(visibleButtons().find(b => b.textContent === 'Keep'));
  expect(mount.controller.getState({}).messages).toHaveLength(2);
  visibleButtons().find(b => b.textContent === 'Keep')!.click();
  expect(confirmation.hidden).toBe(true);
  expect(document.activeElement).toBe(reset);
  expect(mount.controller.getState({}).messages).toHaveLength(2);
  reset.click();
  visibleButtons().find(b => b.textContent === 'Confirm')!.click();
  expect(confirmation.hidden).toBe(true);
  expect(document.activeElement).toBe(textarea);
  expect(mount.controller.getState({}).messages).toEqual([]);
  expect(element.querySelector<HTMLElement>('.jini-chat-vanilla__greeting')!.hidden).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(dialog.hidden).toBe(true);
  expect(dialog.getAttribute('aria-modal')).toBe('false');
  expect(fab.querySelector('path')?.getAttribute('d')).toBe('M4 4h16v12H9l-5 4V4z');
  expect(document.activeElement).toBe(fab);
  mount.unmount({});
  expect(element.children).toHaveLength(0);
});

it('drains a queued destination treatment once without replaying stored replies', () => {
  const element = document.createElement('div');
  document.body.replaceChildren(element);
  let drains = 0;
  let effects = 0;
  let canceled = false;
  let scheduled: (() => void) | null = null;
  const mount = mountVanillaChat({ element, document, agentId: 'visitor', directiveEventName: 'client_directive',
    ids: () => 'unused', createAbortController: () => new AbortController(),
    transport: { async startRun() { return { runId: 'unused' }; }, async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {} },
    session: { load: () => ({ open: false, messages: [] }), save: () => {}, clear: () => {}, enqueue: () => {},
      drain: () => { drains++; return { type: 'highlight', target: { title: 'About', path: '/about', slug: 'about' } }; } },
    pageActions: { allows: () => true, navigate: () => { throw new Error('Unexpected navigation'); }, execute: () => { effects++; return true; }, clearHighlight: () => {} },
    scheduleFrame: ({ callback }) => { scheduled = callback; return () => { canceled = true; }; }, renderMarkdown: () => {},
    copy: { title: 'Chat', fabLabel: 'Open chat', placeholder: 'Message', send: 'Send', stop: 'Stop', close: 'Close', reset: 'New thread',
      resetQuestion: 'Discard?', confirm: 'Confirm', keep: 'Keep', proposalGo: 'Go', proposalLabel: ({ title }) => title, thinking: 'Replying' },
  });
  expect(drains).toBe(1);
  (scheduled as unknown as () => void)();
  expect(effects).toBe(1);
  mount.controller.setOpen({ open: true });
  expect(drains).toBe(1);
  mount.unmount({});
  expect(canceled).toBe(true);
});

function focusFixture({ restored = false, renderMarkdown }: { restored?: boolean; renderMarkdown?: MountVanillaChatArgs['renderMarkdown'] } = {}) {
  const outside = document.createElement('input');
  const element = document.createElement('div');
  document.body.replaceChildren(outside, element);
  outside.focus();
  let sequence = 0;
  let handlers: RunHandlers | undefined;
  const frames = new Set<() => void>();
  const rendered: string[] = [];
  const mount = mountVanillaChat({ element, document, agentId: 'visitor', directiveEventName: 'client_directive',
    ids: () => String(++sequence), createAbortController: () => new AbortController(),
    transport: { async startRun(_input, callbacks) { handlers = callbacks; return { runId: 'run' }; },
      async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {} },
    session: { load: () => ({ open: restored, messages: restored ? [{ id: 'old', role: 'assistant', content: 'Previous reply', runStatus: 'succeeded' }] : [] }),
      save: () => {}, clear: () => {}, enqueue: () => {}, drain: () => null },
    pageActions: { allows: () => true, navigate: () => true, execute: () => true, clearHighlight: () => {} },
    scheduleFrame: ({ callback }) => { frames.add(callback); return () => { frames.delete(callback); }; },
    renderMarkdown: ({ content, element: target }) => {
      rendered.push(content);
      if (renderMarkdown) renderMarkdown({ content, element: target }); else target.textContent = content;
    },
    copy: { title: 'Chat', fabLabel: 'Open chat', placeholder: 'Message', send: 'Send', stop: 'Stop', close: 'Close', reset: 'New thread',
      resetQuestion: 'Discard?', confirm: 'Confirm', keep: 'Keep', proposalGo: 'Go', proposalLabel: ({ title }) => title, thinking: 'Replying' },
  });
  return { outside, element, mount, frames, rendered, callbacks: () => handlers!, flush: () => {
    const pending = [...frames]; frames.clear(); pending.forEach(callback => callback());
  } };
}

it('restores an open panel without focusing or trapping the host page; explicit entry traps focus', () => {
  const f = focusFixture({ restored: true });
  try {
    const panel = f.element.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(f.outside);
    for (const key of ['Tab', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      f.outside.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(panel.hidden).toBe(false);
      expect(document.activeElement).toBe(f.outside);
    }
    f.element.dispatchEvent(new Event('jini-chat-open'));
    const textarea = f.element.querySelector('textarea')!;
    expect(document.activeElement).toBe(textarea);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const first = Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'New thread')!;
    first.focus();
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(textarea);
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(f.element.querySelector('.jini-chat-bubble'));
  } finally { f.mount.unmount({}); }
});

it('renders chunks once per frame and announces only the new settled reply, never restored text', async () => {
  const f = focusFixture({ restored: true });
  try {
    const announcements = f.element.querySelector('.jini-chat-vanilla__announcements')!;
    expect(announcements.textContent).toBe('');
    await f.mount.controller.send({ text: 'Hello' });
    f.callbacks().onEvent({ kind: 'text', text: 'One ' });
    f.callbacks().onEvent({ kind: 'text', text: 'reply' });
    expect(f.frames.size).toBe(1);
    expect(f.rendered).toEqual(['Previous reply']);
    expect(announcements.textContent).toBe('');
    f.flush();
    expect(f.rendered).toEqual(['Previous reply', 'One reply']);
    f.callbacks().onDone([{ kind: 'text', text: 'One reply' }]);
    expect(announcements.textContent).toBe('One reply');
    expect(announcements.children).toHaveLength(1);
    f.mount.controller.setOpen({ open: false });
    f.mount.controller.setOpen({ open: true });
    expect(announcements.children).toHaveLength(1);
    expect(announcements.getAttribute('aria-relevant')).toBe('additions');
    expect(announcements.getAttribute('aria-atomic')).toBe('false');
  } finally { f.mount.unmount({}); }
});

it('renders a mobile-safe input with a computed 16px font', async () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(path.resolve(__dirname, '../style.css'), 'utf8');
  document.head.append(style);
  const f = focusFixture();
  try { expect(getComputedStyle(f.element.querySelector('textarea')!).fontSize).toBe('16px'); }
  finally { f.mount.unmount({}); style.remove(); }
});


it('keeps an open dialog modal across focus moves and ends modal semantics when closed', () => {
  const f = focusFixture();
  try {
    const panel = f.element.querySelector<HTMLElement>('[role="dialog"]')!;
    f.element.dispatchEvent(new Event('jini-chat-open'));
    expect(panel.getAttribute('aria-modal')).toBe('true');
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')!.focus();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    f.outside.focus();
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    f.outside.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(panel.hidden).toBe(false);
    const input = f.element.querySelector('textarea')!;
    input.focus();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    input.blur();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    f.mount.controller.setOpen({ open: false });
    expect(panel.getAttribute('aria-modal')).toBe('false');
  } finally { f.mount.unmount({}); }
});

it('guards an unsent draft with safe confirmation and keeps reset focus in the composer', () => {
  const f = focusFixture();
  try {
    f.element.dispatchEvent(new Event('jini-chat-open'));
    const input = f.element.querySelector('textarea')!;
    const button = (label: string) => Array.from(f.element.querySelectorAll('button')).find(node => node.textContent === label)!;
    input.value = 'My unsent question';
    const confirmation = f.element.querySelector<HTMLElement>('.jini-chat-vanilla__confirmation')!;
    button('New thread').click();
    expect(confirmation.hidden).toBe(false);
    expect(document.activeElement).toBe(button('Keep'));
    expect(input.value).toBe('My unsent question');
    button('Keep').click();
    expect(confirmation.hidden).toBe(true);
    expect(document.activeElement).toBe(button('New thread'));
    expect(input.value).toBe('My unsent question');
    button('New thread').click();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(confirmation.hidden).toBe(true);
    expect(input.value).toBe('My unsent question');
    expect(document.activeElement).toBe(button('New thread'));
    button('New thread').click();
    button('Confirm').click();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(f.mount.controller.getState({}).messages).toEqual([]);
    button('New thread').click();
    expect(confirmation.hidden).toBe(true);
    expect(document.activeElement).toBe(input);
  } finally { f.mount.unmount({}); }
});

it('announces rendered reply text and retains only the two most recent live additions', async () => {
  const f = focusFixture({ renderMarkdown: ({ content, element }) => {
    const label = content.slice(2, content.indexOf('**', 2));
    const strong = document.createElement('strong'); strong.textContent = label;
    const link = document.createElement('a'); link.href = 'https://example.com/help'; link.textContent = 'Help';
    element.replaceChildren(strong, document.createTextNode(' '), link);
  } });
  try {
    const announcements = f.element.querySelector('.jini-chat-vanilla__announcements')!;
    for (let index = 1; index <= 4; index++) {
      await f.mount.controller.send({ text: 'Question' });
      const content = `**Reply ${index}** [Help](https://example.com/help)`;
      f.callbacks().onEvent({ kind: 'text', text: content });
      f.callbacks().onDone([{ kind: 'text', text: content }]);
      expect(announcements.lastElementChild!.textContent).toBe(`Reply ${index} Help`);
      expect(announcements.children).toHaveLength(Math.min(index, 2));
    }
    expect(Array.from(announcements.children, child => child.textContent)).toEqual(['Reply 3 Help', 'Reply 4 Help']);
    f.mount.controller.reset({});
    expect(announcements.children).toHaveLength(0);
  } finally { f.mount.unmount({}); }
});
