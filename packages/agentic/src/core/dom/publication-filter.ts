import type { PagePublication, PublishedPageElement } from '../page-publication.js';
import { findFieldReadRefusal, type FieldDescriptor } from '../guards.js';

const EXCLUDED = '[hidden], [inert], [aria-hidden="true"], [data-agent-private], [data-agent-personalized], dialog:not([open]), script, style, template, noscript';
/** Rendering/private checks include ancestors, even where checkVisibility is unavailable. */
export function publicElement({ element }: { element: Element }, _options = {}): boolean {
  if (!element.isConnected || element.closest(EXCLUDED) || !visibleInDetails(element)) return false;
  if (!platformVisible(element)) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (hiddenStyle(current)) return false;
  }
  return true;
}
function platformVisible(element: Element): boolean {
  return typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}
function hiddenStyle(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}
/** Read only public text nodes. Never clone private/hidden text or form values into a label.
 * O(n) over this already-published region, never the document. */
export function publishedText({ element }: { element: Element }, _options = {}): string {
  if (!publicElement({ element }) || element.matches('input,textarea,select,[contenteditable]')) return '';
  return Array.from(element.childNodes).map(publicNodeText).join('');
}

/** Snapshot identities and targets once; a re-rendered control needs a fresh publication/binding.
 * O(p × m) snapshot for p manifest entries and m scoped handles; O(depth) checks plus live duplicate detection per operation. */
export function createPublicationFilter({ root, publication, fieldOf }: {
  root: ParentNode & { querySelector: Element['querySelector'] }; publication: PagePublication;
  fieldOf: (element: Element) => FieldDescriptor | null;
}, _options = {}) {
  const entries = new Map<string, PublishedPageElement>();
  const nodes = new Map<string, Element>();
  const targets = new Map<string, string>();
  const candidates = Array.from(root.querySelectorAll('[data-agent-element]'));
  for (const entry of publication.elements) {
    if (entries.has(entry.handle)) { nodes.delete(entry.handle); continue; }
    entries.set(entry.handle, entry);
    const matches = candidates.filter(node => node.getAttribute('data-agent-element') === entry.handle);
    if (matches.length === 1) { nodes.set(entry.handle, matches[0]!); targets.set(entry.handle, targetOf(matches[0]!)); }
  }
  function eligible(element: Element): PublishedPageElement | undefined {
    const handle = element.getAttribute('data-agent-element') ?? '';
    if (root instanceof Element && root.getAttribute('data-agent-publication') !== publication.revision) return undefined;
    if (nodes.get(handle) !== element || !publicElement({ element })) return undefined;
    if (targetOf(element) !== targets.get(handle)) return undefined;
    // fieldOf also resolves descendants for composite controls. A read region must remain
    // available when it contains a password field; publishedText strips the field itself.
    const field = element.matches('input,textarea,select,[contenteditable]') ? fieldOf(element) : null;
    if (field && findFieldReadRefusal({ field })) return undefined;
    return entries.get(handle);
  }
  return {
    allows({ element, action }: { element: Element; action: string }): boolean {
      const entry = eligible(element);
      if (!entry) return false;
      if (['read', 'highlight', 'scrollTo'].includes(action)) return true;
      if (element.matches(':disabled,[aria-disabled="true"]')) return false;
      if (action === 'fill') return entry.action === 'fill';
      if (action === 'selectOption') return entry.action === 'select';
      return action === 'click' && allowedClick({ element, entry, fieldOf });
    },
  };
}

/** A form override changing while a human decides invalidates the captured target. */
function targetOf(element: Element): string {
  const form = (element as HTMLButtonElement).form ?? element.closest('form');
  return JSON.stringify([element.tagName, element.getAttribute('href'), element.getAttribute('type'),
    element.getAttribute('formaction'), element.getAttribute('formmethod'), form?.getAttribute('action'), form?.getAttribute('method')]);
}

function isSubmitter(element: Element): boolean {
  return (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit' && element.form !== null;
}
function visibleInDetails(element: Element): boolean {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (!(parent instanceof HTMLDetailsElement) || parent.open) continue;
    const summary = parent.querySelector(':scope > summary');
    if (!summary?.contains(element)) return false;
  }
  return true;
}

function allowedClick({ element, entry, fieldOf }: { element: Element; entry: PublishedPageElement; fieldOf: (element: Element) => FieldDescriptor | null }): boolean {
  if (element.matches('a[href]')) return false;
  if (isSubmitter(element) && entry.action !== 'submit') return false;
  if (entry.action === 'submit' && !safeSubmission({ element, entry, fieldOf })) return false;
  return ['menu', 'tab', 'accordion', 'carousel', 'media', 'submit'].includes(entry.action);
}

function publicNodeText(node: ChildNode): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  return node instanceof Element ? publishedText({ element: node }) : '';
}
/** A published submitter cannot carry credentials/payment fields along as unmarked form data. */
function safeSubmission({ element, entry, fieldOf }: { element: Element; entry: PublishedPageElement; fieldOf: (element: Element) => FieldDescriptor | null }): boolean {
  const form = (element as HTMLButtonElement).form;
  if (!form || !entry.target) return false;
  const action = element.getAttribute('formaction') ?? form.getAttribute('action') ?? element.ownerDocument.location.pathname;
  const method = (element.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get').toLowerCase();
  if (action !== entry.target.action || method !== entry.target.method) return false;
  return !Array.from(form.elements).some(control => {
    const field = fieldOf(control);
    return field !== null && findFieldReadRefusal({ field }) !== null;
  });
}
