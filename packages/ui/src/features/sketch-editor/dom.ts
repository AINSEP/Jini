/**
 * The DOM-enhancement toolkit that makes embedding a third-party editor
 * (Excalidraw exposes no hooks for any of this) feel native: tooltip
 * injection, context-menu simplification, DOM text-override application,
 * toast rewriting, and modal/portal enhancement. Every function here takes
 * whatever root element(s) it needs to operate on as parameters — none of
 * it reaches for a module-level singleton — so it stays independently
 * unit-testable against hand-built DOM fixtures.
 *
 * This file intentionally touches `document`/`window`/global DOM APIs
 * directly rather than going through `dependencies.ts` (unlike a
 * transport/fetch concern): DOM manipulation of a mounted third-party
 * library's own rendered output *is* this feature's entire purpose, not an
 * external dependency to abstract away. Excalidraw itself is still bound
 * through `ports.ts`/`dependencies.ts` (see those files).
 */
import {
  SKETCH_CONTEXT_MENU_MARGIN,
  SKETCH_TEXT_OVERRIDE_ATTRS,
} from './constants.js';
import {
  isExcalidrawUnableToEmbedToast,
  normalizeTooltipLabel,
  orderContextMenuActions,
  resolveDefaultSketchToolColor,
  translateDomTextValue,
} from './rules.js';
import type { SketchDomTextOverrides, SketchTooltipLabels, SketchTooltipTarget } from './types.js';

export function readExcalidrawTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function readDefaultSketchToolColor(): string {
  if (typeof document === 'undefined') return resolveDefaultSketchToolColor(null, false);
  const theme = document.documentElement.getAttribute('data-theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  return resolveDefaultSketchToolColor(theme, prefersDark);
}

export function setTooltipAttribute(target: HTMLElement, name: string, value: string): void {
  if (target.getAttribute(name) === value) return;
  target.setAttribute(name, value);
}

/**
 * Drives ONLY the shared `TooltipLayer` contract (`.jini-tooltip[data-tooltip]`):
 * it renders a single styled, viewport-aware bubble and suppresses the
 * native browser `title` on hover. Painting a separate `::after`/`title`
 * on top of it produces duplicate tooltips.
 */
export function applySketchEditorTooltips(
  root: HTMLElement,
  labels: SketchTooltipLabels,
  targets: readonly SketchTooltipTarget[],
): void {
  const decorated = new Set<HTMLElement>();
  for (const entry of targets) {
    for (const trigger of Array.from(root.querySelectorAll<HTMLElement>(entry.selector))) {
      const target = entry.target === 'closest-label' ? trigger.closest<HTMLElement>('label') : trigger;
      if (!target || decorated.has(target)) continue;

      const label = normalizeTooltipLabel(labels[entry.label]);
      if (!label) continue;

      setTooltipAttribute(target, 'data-tooltip', label);
      setTooltipAttribute(target, 'data-tooltip-placement', entry.placement ?? 'bottom');
      if (!target.classList.contains('jini-tooltip')) target.classList.add('jini-tooltip');
      setTooltipAttribute(trigger, 'aria-label', label);
      decorated.add(target);
    }
  }
}

export function clampSketchContextPopover(popover: HTMLElement, viewportRoot: HTMLElement): void {
  const viewportRect = viewportRoot.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  let nextLeft = Number.parseFloat(popover.style.left || `${rect.left}`);
  let nextTop = Number.parseFloat(popover.style.top || `${rect.top}`);
  if (!Number.isFinite(nextLeft) || !Number.isFinite(nextTop)) return;

  const maxRight = viewportRect.right - SKETCH_CONTEXT_MENU_MARGIN;
  const minLeft = viewportRect.left + SKETCH_CONTEXT_MENU_MARGIN;
  const maxBottom = viewportRect.bottom - SKETCH_CONTEXT_MENU_MARGIN;
  const minTop = viewportRect.top + SKETCH_CONTEXT_MENU_MARGIN;

  if (rect.right > maxRight) nextLeft -= rect.right - maxRight;
  if (rect.left < minLeft) nextLeft += minLeft - rect.left;
  if (rect.bottom > maxBottom) nextTop -= rect.bottom - maxBottom;
  if (rect.top < minTop) nextTop += minTop - rect.top;

  if (nextLeft !== Number.parseFloat(popover.style.left || 'NaN')) popover.style.left = `${Math.max(0, Math.round(nextLeft))}px`;
  if (nextTop !== Number.parseFloat(popover.style.top || 'NaN')) popover.style.top = `${Math.max(0, Math.round(nextTop))}px`;
}

/**
 * Simplifies Excalidraw's built-in right-click context menu down to
 * `allowList`, dropping any `<hr>` separators. `recognizedActions` guards
 * against mistaking an unrelated `ul.context-menu` elsewhere on the page for
 * Excalidraw's own.
 */
export function applySketchContextMenuSimplification(
  root: HTMLElement,
  viewportRoot: HTMLElement,
  allowList: readonly string[],
  recognizedActions: readonly string[],
): void {
  for (const menu of Array.from(root.querySelectorAll<HTMLUListElement>('ul.context-menu'))) {
    // `menu` was found via `root.querySelectorAll(...)`, so it is always a
    // strict descendant of `root` and therefore always has a parent element
    // — `.parentElement` is only typed nullable because `Element` itself
    // permits detached nodes, not because that's reachable here.
    const popover = menu.closest<HTMLElement>('.popover') ?? menu.parentElement!;
    const recognized = new Set(recognizedActions);
    // `li[data-testid]` is an attribute selector: every `item` it matches is
    // guaranteed to carry the attribute, so `getAttribute` can't return null
    // here — only typed nullable because `getAttribute` is nullable in general.
    const hasRecognizedAction = Array.from(menu.querySelectorAll<HTMLLIElement>('li[data-testid]')).some((item) =>
      recognized.has(item.getAttribute('data-testid')!),
    );
    if (!hasRecognizedAction) continue;

    menu.classList.add('jini-sketch-context-menu');
    popover.classList.add('jini-sketch-context-popover');

    const allowed = new Set(allowList);
    const byAction = new Map<string, HTMLLIElement>();
    for (const child of Array.from(menu.children)) {
      if (child instanceof HTMLHRElement) {
        child.remove();
        continue;
      }
      if (!(child instanceof HTMLLIElement)) continue;
      const actionName = child.getAttribute('data-testid') ?? '';
      if (!allowed.has(actionName)) {
        child.remove();
        continue;
      }
      byAction.set(actionName, child);
    }

    const orderedActions = orderContextMenuActions(Array.from(byAction.keys()), allowList);
    const orderedItems = orderedActions.map((action) => byAction.get(action)!).filter(Boolean);
    if (orderedItems.length === 0) {
      popover.remove();
      continue;
    }
    // Only touch the DOM when the order is actually wrong. This runs on
    // every MutationObserver tick, and re-appending nodes already in place
    // detaches/re-inserts them each frame; because that re-triggers the
    // observer, an unconditional reorder becomes a self-sustaining
    // per-frame churn that cancels the in-flight pointer interaction,
    // making the menu impossible to click.
    const currentItems = Array.from(menu.children).filter(
      (child): child is HTMLLIElement => child instanceof HTMLLIElement,
    );
    const alreadyOrdered =
      currentItems.length === orderedItems.length && currentItems.every((item, index) => item === orderedItems[index]);
    if (!alreadyOrdered) {
      for (const item of orderedItems) menu.appendChild(item);
    }

    clampSketchContextPopover(popover, viewportRoot);
  }
}

/**
 * Walks `root`'s text nodes and a fixed set of text-bearing attributes,
 * rewriting any that match `overrides`. `overrides` is entirely
 * host-supplied — no translated copy ships as a default (see
 * `packages/ui/archived provenance ledger`).
 */
export function applySketchDomTextOverrides(root: ParentNode, overrides: SketchDomTextOverrides | undefined): void {
  if (!overrides || Object.keys(overrides).length === 0 || typeof document === 'undefined') return;
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = textWalker.nextNode();
  while (node) {
    // `NodeFilter.SHOW_TEXT` restricts this walk to `Text` nodes, whose
    // `nodeValue` is always a string per spec (only `Document`/`DocumentType`
    // nodes ever have a null `nodeValue`) — `Node.nodeValue`'s broader type
    // is nullable only because it covers those other node kinds too.
    const next = translateDomTextValue(node.nodeValue!, overrides);
    if (next !== null && next !== node.nodeValue) node.nodeValue = next;
    node = textWalker.nextNode();
  }
  const elements =
    root instanceof Element ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] : Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const element of elements) {
    for (const attr of SKETCH_TEXT_OVERRIDE_ATTRS) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const next = translateDomTextValue(value, overrides);
      if (next !== null && next !== value) element.setAttribute(attr, next);
    }
  }
}

export function rewriteExcalidrawUnableToEmbedToasts(
  root: HTMLElement,
  replacement: string,
  additionalPhrases: readonly string[] = [],
): void {
  const normalizedReplacement = normalizeTooltipLabel(replacement);
  if (!normalizedReplacement) return;
  for (const messageNode of Array.from(root.querySelectorAll<HTMLElement>('.Toast__message'))) {
    const current = normalizeTooltipLabel(messageNode.textContent);
    if (!current || current === normalizedReplacement || !isExcalidrawUnableToEmbedToast(current, additionalPhrases)) {
      continue;
    }
    messageNode.textContent = normalizedReplacement;
    messageNode.closest<HTMLElement>('.Toast')?.setAttribute('data-jini-sketch-embed-toast-rewritten', 'true');
  }
}

export function findSketchMermaidInsertButton(content: HTMLElement, insertLabelPattern: RegExp): HTMLButtonElement | null {
  const dialogText = normalizeTooltipLabel(content.textContent);
  if (!dialogText || !/Mermaid/i.test(dialogText)) return null;
  for (const button of Array.from(content.querySelectorAll<HTMLButtonElement>('button'))) {
    const label = normalizeTooltipLabel(button.textContent) ?? normalizeTooltipLabel(button.getAttribute('aria-label'));
    if (!label) continue;
    if (insertLabelPattern.test(label)) return button;
  }
  return null;
}

export function removeSketchMermaidShortcutHints(content: HTMLElement, insertLabelPattern: RegExp): void {
  const insertButton = findSketchMermaidInsertButton(content, insertLabelPattern);
  if (!insertButton) return;
  for (const hint of Array.from(insertButton.querySelectorAll('kbd'))) hint.remove();
  for (const hint of Array.from(content.querySelectorAll('.ttd-dialog-submit-shortcut'))) hint.remove();
}

/**
 * Adds a `jini-sketch-modal` marker + a close button to every Excalidraw
 * modal portal mounted on `document.body` (Excalidraw renders these via its
 * own portal, outside the component's own DOM subtree, so this must walk
 * the whole document rather than a local root).
 */
export function enhanceSketchExcalidrawPortals(
  closeLabel: string,
  onClose: () => void,
  domTextOverrides: SketchDomTextOverrides | undefined,
  insertLabelPattern: RegExp,
): void {
  for (const portal of Array.from(document.querySelectorAll<HTMLElement>('.excalidraw-modal-container'))) {
    portal.classList.add('jini-sketch-modal');
    portal.classList.toggle('jini-sketch-help-modal', Boolean(portal.querySelector('.HelpDialog__header')));
    applySketchDomTextOverrides(portal, domTextOverrides);
    for (const content of Array.from(portal.querySelectorAll<HTMLElement>('.Modal__content'))) {
      removeSketchMermaidShortcutHints(content, insertLabelPattern);
      let close = content.querySelector<HTMLButtonElement>(':scope > .jini-sketch-dialog-close');
      if (!close) {
        close = document.createElement('button');
        close.type = 'button';
        close.className = 'jini-sketch-dialog-close';
        close.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        });
        content.appendChild(close);
      }
      close.setAttribute('aria-label', closeLabel);
      close.setAttribute('title', closeLabel);
    }
  }
}

export function handleSketchPortalCommandEnter(event: KeyboardEvent, insertLabelPattern: RegExp): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const portal = target.closest<HTMLElement>('.jini-sketch-modal');
  const content = target.closest<HTMLElement>('.Modal__content');
  if (!portal || !content || !portal.contains(content)) return;
  if (!content.querySelector('textarea')) return;

  const insertButton = findSketchMermaidInsertButton(content, insertLabelPattern);
  if (!insertButton || insertButton.disabled || insertButton.getAttribute('aria-disabled') === 'true') return;

  event.preventDefault();
  event.stopPropagation();
  insertButton.click();
}
