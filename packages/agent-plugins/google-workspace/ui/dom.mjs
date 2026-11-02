/**
 * @file The few browser helpers the three panels share: connect to the host through the copied
 * admin-surface client, build elements, and show status text.
 *
 * Exists so every panel builds its DOM the same safe way: text always goes through `textContent`
 * (never `innerHTML`), because titles, labels and messages come from Google or the host and must
 * never be parsed as markup inside the panel.
 */
import { createAdminSurfaceClient } from './surface-client.mjs';

/**
 * The client for this frame: listens to the parent's messages only (the client checks the source),
 * and applies the admin's design tokens to this frame's root so `panel.css` matches the admin.
 * @param {{ window: Window }} required - the frame's window (a test passes its own jsdom window).
 */
export function connectToHost(required) {
  const { window: frame } = required;
  closeTipsOnOutsideClick(frame.document);
  return createAdminSurfaceClient({
    parent: frame.parent,
    listen: (handler) => { frame.addEventListener('message', handler); return () => frame.removeEventListener('message', handler); },
  }, { themeRoot: frame.document.documentElement });
}

/**
 * An element with attributes, event handlers (`on<Event>` functions) and children (strings become text).
 * @param {string} tag
 * @param {Record<string, string | boolean | Function | undefined>} [props]
 * @param {Array<Node | string | null | undefined>} [children]
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(name, '');
    else if (typeof value === 'string') element.setAttribute(name, value);
    else {
      // False and absent props do not create attributes.
    }
  }
  element.append(...children.filter((child) => child !== null && child !== undefined));
  return element;
}

let nextTip = 0;

/**
 * An "i" toggletip: the explanation shows on hover, keyboard focus or tap, instead of a paragraph
 * on screen. The trigger is a focusable span (not a `<button>`), so the panels' button lists stay
 * their actions only; its text stays in the DOM and is the trigger's accessible description.
 * @param {string} label - what the explanation is about ("About Products").
 * @param {string} text
 * @param {{ bodyClass?: string }} [optional] - an extra class on the explanation (e.g. `intro`).
 */
export function tip(label, text, optional = {}) {
  nextTip += 1;
  const id = `tip-${nextTip}`;
  const toggle = (event) => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
    event.preventDefault();
    const wrapper = event.currentTarget.parentElement;
    const open = event.key === 'Escape' ? false : !wrapper.classList.contains('open');
    wrapper.classList.toggle('open', open);
    event.currentTarget.setAttribute('aria-expanded', String(open));
  };
  return h('span', { class: 'tip' }, [
    h('span', { class: 'tip-icon', role: 'button', tabindex: '0', 'aria-label': label, 'aria-describedby': id, 'aria-expanded': 'false', onClick: toggle, onKeydown: toggle }, ['i']),
    h('span', { class: optional.bodyClass ? `tip-body ${optional.bodyClass}` : 'tip-body', role: 'tooltip', id }, [text]),
  ]);
}

/** Taps elsewhere close an open toggletip (once per document). */
function closeTipsOnOutsideClick(doc) {
  if (doc.tipsWired) return;
  doc.tipsWired = true;
  doc.addEventListener('click', (event) => {
    for (const open of doc.querySelectorAll('.tip.open')) {
      if (!open.contains(event.target)) { open.classList.remove('open'); open.firstChild.setAttribute('aria-expanded', 'false'); }
    }
  });
}

/**
 * A compact status line. `tone`: 'error' (default, plain `notice`), 'ok', 'info' or 'warn'. With
 * `retry`, a "Try again" button sits inside the same box (outside the `.notice` text).
 * @param {{ text: string, tone?: string, retry?: () => void }} required
 */
export function notice(required) {
  const { text, tone = 'error', retry } = required;
  const line = h('p', { class: tone === 'error' ? 'notice' : `notice ${tone}`, role: 'status' }, [text]);
  if (!retry) return line;
  return h('div', { class: `notice-group ${tone}` }, [line, h('button', { type: 'button', class: 'small', onClick: retry }, ['Try again'])]);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

/** What identifies a focused control across a re-render: its id, else its tag and visible name. */
function focusKey(element, root) {
  if (!element || element === root || !root.contains(element)) return null;
  return { id: element.id, tag: element.tagName, name: element.getAttribute('aria-label') ?? element.textContent.trim() };
}

function matchesFocusKey({ control, key }, _options = {}) {
  if (key.id && control.id === key.id) return true;
  return control.tagName === key.tag && (control.getAttribute('aria-label') ?? control.textContent.trim()) === key.name;
}

/**
 * Replaces a region's content, keeping keyboard focus where the person was: on the same control
 * when it is still there, else on the first control of the new content (never lost to `<body>`).
 */
export function show(root, ...nodes) {
  const key = focusKey(root.ownerDocument.activeElement, root) ?? root.pendingFocus ?? null;
  root.pendingFocus = null;
  root.replaceChildren(...nodes.filter(Boolean));
  if (key === null) return;
  const controls = [...root.querySelectorAll(FOCUSABLE)];
  const same = controls.find(control => matchesFocusKey({ control, key }));
  (same ?? controls[0])?.focus();
}

/** The sentence to show for a failed call: the host's or plugin's fixed message. */
export function failureText(error) {
  // The host's schema check names JSON paths ("$.spreadsheetId has the wrong length"): developer text.
  if (error?.code === 'invalid-payload') return 'Some details are missing or not valid. Check them and try again.';
  return typeof error?.message === 'string' && error.message ? error.message : 'Something went wrong. Try again.';
}

/** Runs `work` with every button in `root` disabled, so one click sends one request. */
export async function busy(root, work) {
  // Disabling the focused button drops focus to <body>; `show` restores it from here.
  root.pendingFocus = focusKey(root.ownerDocument.activeElement, root);
  const buttons = [...root.querySelectorAll('button')];
  for (const control of buttons) control.disabled = true;
  try { return await work(); } finally { for (const control of buttons) control.disabled = false; }
}

/** Resolves after `ms` (the desktop Picker and sign-in polls). */
export const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
