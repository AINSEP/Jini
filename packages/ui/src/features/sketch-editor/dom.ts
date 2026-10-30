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

function resolveTooltipTarget(trigger: HTMLElement, entry: SketchTooltipTarget): HTMLElement | null {
  return entry.target === 'closest-label' ? trigger.closest<HTMLElement>('label') : trigger;
}

function decorateTooltipTarget({
  target,
  trigger,
  label,
  placement,
}: {
  target: HTMLElement;
  trigger: HTMLElement;
  label: string;
  placement: string;
}): void {
  setTooltipAttribute(target, 'data-tooltip', label);
  setTooltipAttribute(target, 'data-tooltip-placement', placement);
  if (!target.classList.contains('jini-tooltip')) target.classList.add('jini-tooltip');
  setTooltipAttribute(trigger, 'aria-label', label);
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
    const triggers = Array.from(root.querySelectorAll<HTMLElement>(entry.selector));
    const label = normalizeTooltipLabel(labels[entry.label]);
    if (!label) continue;
    for (const trigger of triggers) {
      const target = resolveTooltipTarget(trigger, entry);
      if (!target || decorated.has(target)) continue;
      decorateTooltipTarget({ target, trigger, label, placement: entry.placement ?? 'bottom' });
      decorated.add(target);
    }
  }
}

function readPopoverOrigin(popover: HTMLElement, rect: DOMRect): { left: number; top: number } | null {
  const left = Number.parseFloat(popover.style.left || `${rect.left}`);
  const top = Number.parseFloat(popover.style.top || `${rect.top}`);
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
}

/** Shifts `value` so the `[start, end]` span fits inside `[min, max]`: the
 *  overflow past `max` is subtracted first, then the underflow before `min`
 *  is added, in that order. */
function clampAxis(
  { value, start, end }: { value: number; start: number; end: number },
  { min, max }: { min: number; max: number },
): number {
  let next = value;
  if (end > max) next -= end - max;
  if (start < min) next += min - start;
  return next;
}

function writePopoverCoordinate({ popover, side, next }: { popover: HTMLElement; side: 'left' | 'top'; next: number }): void {
  if (next !== Number.parseFloat(popover.style[side] || 'NaN')) popover.style[side] = `${Math.max(0, Math.round(next))}px`;
}

export function clampSketchContextPopover(popover: HTMLElement, viewportRoot: HTMLElement): void {
  const viewportRect = viewportRoot.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const origin = readPopoverOrigin(popover, rect);
  if (!origin) return;

  const nextLeft = clampAxis(
    { value: origin.left, start: rect.left, end: rect.right },
    { min: viewportRect.left + SKETCH_CONTEXT_MENU_MARGIN, max: viewportRect.right - SKETCH_CONTEXT_MENU_MARGIN },
  );
  const nextTop = clampAxis(
    { value: origin.top, start: rect.top, end: rect.bottom },
    { min: viewportRect.top + SKETCH_CONTEXT_MENU_MARGIN, max: viewportRect.bottom - SKETCH_CONTEXT_MENU_MARGIN },
  );

  writePopoverCoordinate({ popover, side: 'left', next: nextLeft });
  writePopoverCoordinate({ popover, side: 'top', next: nextTop });
}

function hasRecognizedContextMenuAction(menu: HTMLUListElement, recognized: ReadonlySet<string>): boolean {
  // `li[data-testid]` is an attribute selector: every `item` it matches is
  // guaranteed to carry the attribute, so `getAttribute` can't return null
  // here — only typed nullable because `getAttribute` is nullable in general.
  return Array.from(menu.querySelectorAll<HTMLLIElement>('li[data-testid]')).some((item) =>
    recognized.has(item.getAttribute('data-testid')!),
  );
}

/** Removes every `<hr>` and every non-allow-listed `<li>` from `menu`,
 *  returning the surviving `<li>`s keyed by action name. */
function pruneContextMenuItems(menu: HTMLUListElement, allowed: ReadonlySet<string>): Map<string, HTMLLIElement> {
  const byAction = new Map<string, HTMLLIElement>();
  for (const child of Array.from(menu.children)) {
    if (child instanceof HTMLHRElement) child.remove();
    if (!(child instanceof HTMLLIElement)) continue;
    const actionName = child.getAttribute('data-testid') ?? '';
    if (allowed.has(actionName)) byAction.set(actionName, child);
    else child.remove();
  }
  return byAction;
}

function isContextMenuOrdered(menu: HTMLUListElement, orderedItems: readonly HTMLLIElement[]): boolean {
  const currentItems = Array.from(menu.children).filter(
    (child): child is HTMLLIElement => child instanceof HTMLLIElement,
  );
  return currentItems.length === orderedItems.length && currentItems.every((item, index) => item === orderedItems[index]);
}

function simplifyContextMenu(
  { menu, viewportRoot, allowList }: { menu: HTMLUListElement; viewportRoot: HTMLElement; allowList: readonly string[] },
  { allowed, recognized }: { allowed: ReadonlySet<string>; recognized: ReadonlySet<string> },
): void {
  // `menu` was found via `root.querySelectorAll(...)`, so it is always a
  // strict descendant of `root` and therefore always has a parent element
  // — `.parentElement` is only typed nullable because `Element` itself
  // permits detached nodes, not because that's reachable here.
  const popover = menu.closest<HTMLElement>('.popover') ?? menu.parentElement!;
  if (!hasRecognizedContextMenuAction(menu, recognized)) return;

  menu.classList.add('jini-sketch-context-menu');
  popover.classList.add('jini-sketch-context-popover');

  const byAction = pruneContextMenuItems(menu, allowed);
  // `orderContextMenuActions` only returns names present in `byAction`'s
  // keys, so every lookup here is defined.
  const orderedItems = orderContextMenuActions(Array.from(byAction.keys()), allowList).map((action) => byAction.get(action)!);
  if (orderedItems.length === 0) {
    popover.remove();
    return;
  }
  // Only touch the DOM when the order is actually wrong. This runs on
  // every MutationObserver tick, and re-appending nodes already in place
  // detaches/re-inserts them each frame; because that re-triggers the
  // observer, an unconditional reorder becomes a self-sustaining
  // per-frame churn that cancels the in-flight pointer interaction,
  // making the menu impossible to click.
  if (!isContextMenuOrdered(menu, orderedItems)) {
    for (const item of orderedItems) menu.appendChild(item);
  }

  clampSketchContextPopover(popover, viewportRoot);
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
  const sets = { allowed: new Set(allowList), recognized: new Set(recognizedActions) };
  for (const menu of Array.from(root.querySelectorAll<HTMLUListElement>('ul.context-menu'))) {
    simplifyContextMenu({ menu, viewportRoot, allowList }, sets);
  }
}

/** The override for `value`, or `null` when there is none or it would not
 *  change anything (so callers skip a no-op DOM write). */
function resolveTextOverride(value: string, overrides: SketchDomTextOverrides): string | null {
  const next = translateDomTextValue(value, overrides);
  return next !== null && next !== value ? next : null;
}

function rewriteTextNodes(root: ParentNode, overrides: SketchDomTextOverrides): void {
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = textWalker.nextNode();
  while (node) {
    // `NodeFilter.SHOW_TEXT` restricts this walk to `Text` nodes, whose
    // `nodeValue` is always a string per spec (only `Document`/`DocumentType`
    // nodes ever have a null `nodeValue`) — `Node.nodeValue`'s broader type
    // is nullable only because it covers those other node kinds too.
    const next = resolveTextOverride(node.nodeValue!, overrides);
    if (next !== null) node.nodeValue = next;
    node = textWalker.nextNode();
  }
}

function rewriteOverrideAttributes(root: ParentNode, overrides: SketchDomTextOverrides): void {
  const descendants = Array.from(root.querySelectorAll<HTMLElement>('*'));
  const elements = root instanceof Element ? [root, ...descendants] : descendants;
  for (const element of elements) {
    for (const attr of SKETCH_TEXT_OVERRIDE_ATTRS) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const next = resolveTextOverride(value, overrides);
      if (next !== null) element.setAttribute(attr, next);
    }
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
  rewriteTextNodes(root, overrides);
  rewriteOverrideAttributes(root, overrides);
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

function isCommandEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey;
}

/** The `.Modal__content` around `target`, but only when it sits inside one
 *  of our marked `.jini-sketch-modal` portals and holds a `<textarea>`. */
function resolvePortalEditorContent(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const portal = target.closest<HTMLElement>('.jini-sketch-modal');
  const content = target.closest<HTMLElement>('.Modal__content');
  if (!portal || !content || !portal.contains(content)) return null;
  return content.querySelector('textarea') ? content : null;
}

function isButtonEnabled(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

export function handleSketchPortalCommandEnter(event: KeyboardEvent, insertLabelPattern: RegExp): void {
  if (!isCommandEnter(event)) return;
  const content = resolvePortalEditorContent(event.target);
  if (!content) return;

  const insertButton = findSketchMermaidInsertButton(content, insertLabelPattern);
  if (!insertButton || !isButtonEnabled(insertButton)) return;

  event.preventDefault();
  event.stopPropagation();
  insertButton.click();
}
