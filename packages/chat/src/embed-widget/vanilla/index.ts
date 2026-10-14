import { CHAT_BUBBLE_STYLE } from '../../contracts/chat-bubble-style.js';
import { createVanillaChatController } from './state.js';
import type { VanillaChatControllerArgs, VanillaChatState } from './state.js';
import { isQueuedPageAction } from '../../core/browser/page-actions.js';
export { createVanillaChatController } from './state.js';
export type { VanillaChatControllerArgs, VanillaChatState } from './state.js';

export interface VanillaChatCopy {
  readonly title: string;
  readonly fabLabel: string;
  readonly placeholder: string;
  readonly send: string;
  readonly stop: string;
  readonly close: string;
  readonly reset: string;
  readonly resetQuestion: string;
  readonly confirm: string;
  readonly confirmDraft?: string;
  readonly keep: string;
  readonly proposalGo: string;
  readonly proposalLabel: (args: { title: string }) => string;
  readonly thinking: string;
  readonly greeting?: string;
  readonly suggestionsLabel?: string;
}
export interface MountVanillaChatArgs extends Omit<VanillaChatControllerArgs, 'onChange'> {
  readonly element: HTMLElement;
  readonly document: Document;
  readonly copy: VanillaChatCopy;
  readonly suggestions?: readonly string[];
  /** Host renderer must escape raw HTML and reject unsafe link protocols. */
  readonly renderMarkdown: (args: { content: string; element: HTMLElement }) => void;
  readonly scheduleFrame: (args: { callback: () => void }) => () => void;
}

function svgIcon({ document, path }: { document: Document; path: string }): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'none');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '2');
  svg.append(shape);
  return svg;
}

/**
 * Mounts a DOM-only chat panel. Native buttons/forms supply keyboard semantics;
 * explicitly opened dialogs trap focus, restore the bubble on close and announce settled replies.
 * Restored panels leave page focus alone. Streaming markdown is rendered at most once per frame.
 * All listeners, scheduled page effects and runs belong to this mount and are disposed.
 * Markdown is an injected host capability; no framework or icon font enters this graph.
 */
export function mountVanillaChat(args: MountVanillaChatArgs, options: { initialOpen?: boolean } = {}) {
  const { document, element, copy } = args;
  const node = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string, text = '') => {
    const result = document.createElement(tag);
    result.className = className;
    result.textContent = text;
    return result;
  };
  const button = (label: string) => {
    const result = node('button', 'jini-chat-vanilla__button', label);
    result.type = 'button';
    return result;
  };
  const shell = node('div', 'jini-chat-vanilla');
  const fab = button('');
  fab.className = 'jini-chat-bubble';
  fab.setAttribute('aria-label', copy.fabLabel);
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.append(svgIcon({ document, path: 'M4 4h16v12H9l-5 4V4z' }));
  const panel = node('section', 'jini-chat-vanilla__panel');
  panel.id = `jini-chat-${args.ids({})}`;
  fab.setAttribute('aria-controls', panel.id);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', copy.title);
  const header = node('header', 'jini-chat-vanilla__header');
  const title = node('strong', 'jini-chat-vanilla__title', copy.title);
  const reset = button(copy.reset);
  const close = button('');
  close.setAttribute('aria-label', copy.close);
  close.append(svgIcon({ document, path: 'M6 6l12 12M18 6L6 18' }));
  header.append(title, reset, close);
  const confirmation = node('div', 'jini-chat-vanilla__confirmation');
  const confirm = button(copy.confirm);
  confirm.classList.add('jini-chat-vanilla__discard');
  const keep = button(copy.keep);
  confirmation.append(node('span', '', copy.resetQuestion), confirm, keep);
  confirmation.hidden = true;
  const log = node('div', 'jini-chat-vanilla__messages');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'off');
  log.setAttribute('aria-relevant', 'additions text');
  log.setAttribute('aria-label', copy.title);
  log.tabIndex = 0;
  const status = node('div', 'jini-chat-vanilla__status');
  status.setAttribute('role', 'status');
  const announcements = node('div', 'jini-chat-vanilla__announcements');
  announcements.setAttribute('role', 'log');
  announcements.setAttribute('aria-live', 'polite');
  announcements.setAttribute('aria-relevant', 'additions');
  announcements.setAttribute('aria-atomic', 'false');
  const error = node('div', 'jini-chat-vanilla__error');
  error.setAttribute('role', 'alert');
  const proposal = node('div', 'jini-chat-vanilla__proposal');
  const proposalText = node('span', '');
  const go = button(copy.proposalGo);
  proposal.append(proposalText, go);
  const form = node('form', 'jini-chat-vanilla__composer');
  const input = node('textarea', 'jini-chat-vanilla__input');
  input.placeholder = copy.placeholder;
  input.setAttribute('aria-label', copy.placeholder);
  input.maxLength = 8000;
  input.rows = 2;
  const send = button(copy.send);
  send.type = 'submit';
  send.classList.add('jini-chat-vanilla__send');
  send.setAttribute('aria-label', copy.send);
  send.replaceChildren(svgIcon({ document, path: 'M5 4l15 8-15 8v-6l9-2-9-2V4z' }));
  const stop = button(copy.stop);
  form.append(input, send, stop);
  const greeting = node('p', 'jini-chat-vanilla__greeting', copy.greeting);
  const suggestions = node('div', 'jini-chat-vanilla__suggestions');
  if (copy.suggestionsLabel) suggestions.setAttribute('aria-label', copy.suggestionsLabel);
  const suggestionButtons = (args.suggestions ?? []).map(text => button(text));
  suggestions.append(...suggestionButtons);
  log.append(greeting, suggestions);
  panel.append(header, confirmation, log, status, announcements, error, proposal, form);
  const bubbleStyle = node('style', '', CHAT_BUBBLE_STYLE);
  shell.append(bubbleStyle, fab, panel);
  element.replaceChildren(shell);
  const rows = new Map<string, { element: HTMLElement; content: string }>();
  let wasOpen = false;
  let initialized = false;
  const liveReplies = new Set<string>();
  const renderChrome = ({ state }: { state: VanillaChatState }) => {
    panel.hidden = !state.open;
    panel.setAttribute('aria-modal', String(state.open));
    fab.setAttribute('aria-expanded', String(state.open));
    fab.querySelector('path')?.setAttribute('d', state.open ? 'M6 6l12 12M18 6L6 18' : 'M4 4h16v12H9l-5 4V4z');
    greeting.hidden = !copy.greeting || state.messages.length > 0;
    suggestions.hidden = suggestionButtons.length === 0 || state.messages.length > 0;
    suggestionButtons.forEach(button => { button.disabled = state.busy; });
    error.textContent = state.error ?? '';
    error.hidden = !state.error;
    status.textContent = state.busy ? copy.thinking : '';
    send.disabled = state.busy || !input.value.trim();
    input.disabled = state.busy;
    stop.hidden = !state.busy;
    proposal.hidden = state.proposal === null;
    proposalText.textContent = state.proposal ? copy.proposalLabel({ title: state.proposal.navigate.target.title }) : '';
  };
  const renderRows = ({ state }: { state: VanillaChatState }) => {
    const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const ids = new Set(state.messages.map(message => message.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.element.remove(); rows.delete(id); }
    for (const message of state.messages) {
      let row = rows.get(message.id);
      if (!row) {
        row = { element: node('div', `jini-chat-vanilla__message jini-chat-vanilla__message--${message.role}`), content: '\0' };
        rows.set(message.id, row);
        log.append(row.element);
      }
      if (row.content !== message.content) {
        if (message.role === 'user') row.element.textContent = message.content;
        else args.renderMarkdown({ content: message.content, element: row.element });
        row.content = message.content;
      }
    }
    // A dedicated additions-only region announces each LIVE settled reply once. Markdown rows
    // may be rebuilt while streaming, but restored transcripts and old text stay silent.
    for (const message of state.messages) {
      if (message.role !== 'assistant' || message.runStatus === 'running' || !liveReplies.delete(message.id)) continue;
      const text = rows.get(message.id)?.element.textContent;
      if (text) {
        announcements.append(node('span', '', text));
        // Bound the additions-only live region without replaying earlier replies.
        while (announcements.childElementCount > 2) announcements.firstElementChild!.remove();
      }
    }
    if (state.messages.length === 0) announcements.replaceChildren();
    if (pinned) log.scrollTop = log.scrollHeight;
  };
  const renderFocus = ({ state, composerHadFocus, stopHadFocus, panelHadFocus }: {
    state: VanillaChatState; composerHadFocus: boolean; stopHadFocus: boolean; panelHadFocus: boolean;
  }) => {
    if (state.open && !wasOpen && initialized) { if (state.busy) close.focus(); else input.focus(); }
    else if (state.open && state.busy && composerHadFocus) stop.focus();
    else if (state.open && !state.busy && stopHadFocus) input.focus();
    if (!state.open && wasOpen) {
      confirmation.hidden = true;
      panel.setAttribute('aria-modal', 'false');
      if (panelHadFocus) fab.focus();
    }
    wasOpen = state.open;
  };
  let latestState: VanillaChatState;
  let framePending = false;
  let cancelRenderFrame = () => {};
  const render = ({ state }: { state: VanillaChatState }) => {
    latestState = state;
    const panelHadFocus = panel.contains(document.activeElement);
    const composerHadFocus = document.activeElement === input;
    const stopHadFocus = document.activeElement === stop;
    renderChrome({ state });
    renderFocus({ state, composerHadFocus, stopHadFocus, panelHadFocus });
    if (initialized && state.busy) {
      for (const message of state.messages) if (message.role === 'assistant' && message.runStatus === 'running') liveReplies.add(message.id);
      if (framePending) return;
      framePending = true;
      cancelRenderFrame = args.scheduleFrame({ callback: () => {
        framePending = false;
        renderRows({ state: latestState });
      } });
      return;
    }
    cancelRenderFrame();
    framePending = false;
    renderRows({ state });
  };
  const controller = createVanillaChatController({ ...args, onChange: render });
  const listeners: (() => void)[] = [];
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  suggestionButtons.forEach(button => listen(button, 'click', () => {
    input.value = button.textContent ?? '';
    renderChrome({ state: controller.getState({}) });
    input.focus();
  }));
  listen(input, 'input', () => renderChrome({ state: controller.getState({}) }));
  listen(fab, 'click', () => controller.setOpen({ open: !controller.getState({}).open }));
  listen(close, 'click', () => controller.setOpen({ open: false }));
  listen(reset, 'click', () => {
    if (controller.getState({}).messages.length === 0 && input.value.length === 0) {
      controller.reset({}); input.focus(); return;
    }
    confirm.textContent = controller.getState({}).messages.length === 0 ? copy.confirmDraft ?? copy.confirm : copy.confirm;
    confirmation.hidden = false; keep.focus();
  });
  listen(keep, 'click', () => { confirmation.hidden = true; reset.focus(); });
  listen(confirm, 'click', () => { confirmation.hidden = true; input.value = ''; controller.reset({}); input.focus(); });
  listen(go, 'click', () => controller.acceptProposal({}));
  listen(stop, 'click', () => controller.cancel({}));
  listen(form, 'submit', event => {
    event.preventDefault();
    const text = input.value;
    if (!text.trim() || controller.getState({}).busy) return;
    input.value = '';
    void controller.send({ text }).then(() => {
      const state = controller.getState({});
      if (state.open && !state.busy && panel.contains(document.activeElement)) input.focus();
    });
  });
  listen(input, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (key.key === 'Enter' && !key.shiftKey && !key.isComposing) { key.preventDefault(); form.requestSubmit(); }
  });
  listen(document, 'keydown', event => {
    if (!controller.getState({}).open || !panel.contains(document.activeElement)) return;
    const key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      key.preventDefault();
      if (!confirmation.hidden) { confirmation.hidden = true; reset.focus(); }
      else controller.setOpen({ open: false });
      return;
    }
    if (key.key !== 'Tab') return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
      .filter(candidate => !candidate.closest('[hidden]'));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (key.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { key.preventDefault(); last?.focus(); }
    else if (!key.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { key.preventDefault(); first?.focus(); }
  });
  listen(element, 'jini-chat-open', () => {
    controller.setOpen({ open: true });
    if (controller.getState({}).busy) close.focus(); else input.focus();
  });
  const queued = { value: args.session.drain({}) };
  let cancelFrame = () => {};
  if (isQueuedPageAction(queued) && queued.value.type !== 'navigate') {
    const action = queued.value;
    cancelFrame = args.scheduleFrame({ callback: () => { args.pageActions.execute({ action }); } });
  }
  controller.setOpen({ open: options.initialOpen ?? controller.getState({}).open });
  initialized = true;
  element.dataset.chatMounted = 'true';
  element.dispatchEvent(new (document.defaultView?.Event ?? Event)('jini-chat-mounted'));
  return {
    controller,
    unmount(_input: Record<string, never> = {}, _opts = {}) {
      listeners.forEach(dispose => dispose());
      cancelFrame();
      cancelRenderFrame();
      delete element.dataset.chatMounted;
      controller.dispose({});
      args.pageActions.clearHighlight({});
      shell.remove();
    },
  };
}
