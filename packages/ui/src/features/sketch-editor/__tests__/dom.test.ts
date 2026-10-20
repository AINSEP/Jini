// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS, DEFAULT_SKETCH_TOOLTIP_TARGETS } from '../constants.js';
import {
  applySketchContextMenuSimplification,
  applySketchDomTextOverrides,
  applySketchEditorTooltips,
  clampSketchContextPopover,
  enhanceSketchExcalidrawPortals,
  findSketchMermaidInsertButton,
  handleSketchPortalCommandEnter,
  readDefaultSketchToolColor,
  readExcalidrawTheme,
  removeSketchMermaidShortcutHints,
  rewriteExcalidrawUnableToEmbedToasts,
} from '../dom.js';
import { buildSketchTooltipLabels } from '../rules.js';

const t = (key: string) => key;
const labels = buildSketchTooltipLabels(t);
const INSERT_PATTERN = /^(Insert)(\s|$|→)/i;

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '';
});

describe('readExcalidrawTheme', () => {
  it('reads data-theme off <html>, defaulting to light', () => {
    expect(readExcalidrawTheme()).toBe('light');
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readExcalidrawTheme()).toBe('dark');
  });
});

describe('readDefaultSketchToolColor', () => {
  it('matches the active theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readDefaultSketchToolColor()).toBe('#ffffff');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(readDefaultSketchToolColor()).toBe('#1c1b1a');
  });

  it('falls back to prefers-color-scheme via window.matchMedia when data-theme is unset', () => {
    // jsdom ships no `matchMedia` implementation at all (`window.matchMedia`
    // is `undefined`), so `window.matchMedia?.(...)` always short-circuits
    // in every other test in this file — stub it to exercise the real call.
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      expect(readDefaultSketchToolColor()).toBe('#ffffff');
      expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('applySketchEditorTooltips', () => {
  it('decorates a toolbar trigger with data-tooltip/aria-label and the jini-tooltip class', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-testid="main-menu-trigger"></button>';
    document.body.appendChild(root);

    applySketchEditorTooltips(root, labels, DEFAULT_SKETCH_TOOLTIP_TARGETS);

    const button = root.querySelector('[data-testid="main-menu-trigger"]')!;
    expect(button.getAttribute('data-tooltip')).toBe('Main menu');
    expect(button.getAttribute('data-tooltip-placement')).toBe('bottom');
    expect(button.getAttribute('aria-label')).toBe('Main menu');
    expect(button.classList.contains('jini-tooltip')).toBe(true);
  });

  it('decorates the closest <label> for a "closest-label" target', () => {
    const root = document.createElement('div');
    root.innerHTML = '<label><button data-testid="toolbar-rectangle"></button></label>';
    document.body.appendChild(root);

    applySketchEditorTooltips(root, labels, DEFAULT_SKETCH_TOOLTIP_TARGETS);

    const label = root.querySelector('label')!;
    const button = root.querySelector('[data-testid="toolbar-rectangle"]')!;
    expect(label.getAttribute('data-tooltip')).toBe('Rectangle');
    expect(button.getAttribute('aria-label')).toBe('Rectangle');
  });

  it('is idempotent across repeated calls (no duplicate class, same attributes)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-testid="main-menu-trigger"></button>';
    document.body.appendChild(root);
    applySketchEditorTooltips(root, labels, DEFAULT_SKETCH_TOOLTIP_TARGETS);
    applySketchEditorTooltips(root, labels, DEFAULT_SKETCH_TOOLTIP_TARGETS);
    const button = root.querySelector('[data-testid="main-menu-trigger"]')!;
    expect(button.getAttribute('data-tooltip')).toBe('Main menu');
    expect(button.classList.toString()).toBe('jini-tooltip');
  });

  it('only decorates each target element once within a single call, even if two targets resolve to it', () => {
    const root = document.createElement('div');
    // Both a direct selector match and a closest-label match could resolve
    // to the same <label> in principle; verify the `decorated` guard keeps
    // a single element from being written to twice in one pass.
    root.innerHTML = '<button data-testid="main-menu-trigger"></button>';
    document.body.appendChild(root);
    const targets = [
      { selector: '[data-testid="main-menu-trigger"]', label: 'mainMenu' as const, placement: 'bottom' as const },
      { selector: '[data-testid="main-menu-trigger"]', label: 'lock' as const, placement: 'top' as const },
    ];
    applySketchEditorTooltips(root, labels, targets);
    const button = root.querySelector('[data-testid="main-menu-trigger"]')!;
    expect(button.getAttribute('data-tooltip')).toBe('Main menu');
    expect(button.getAttribute('data-tooltip-placement')).toBe('bottom');
  });

  it('skips a target whose resolved label normalizes to empty', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-testid="main-menu-trigger"></button>';
    document.body.appendChild(root);
    const blankLabels = { ...labels, mainMenu: '   ' };
    applySketchEditorTooltips(root, blankLabels, DEFAULT_SKETCH_TOOLTIP_TARGETS);
    const button = root.querySelector('[data-testid="main-menu-trigger"]')!;
    expect(button.hasAttribute('data-tooltip')).toBe(false);
    expect(button.classList.contains('jini-tooltip')).toBe(false);
  });

  it('defaults placement to "bottom" when a target omits it', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-testid="main-menu-trigger"></button>';
    document.body.appendChild(root);
    applySketchEditorTooltips(root, labels, [{ selector: '[data-testid="main-menu-trigger"]', label: 'mainMenu' }]);
    const button = root.querySelector('[data-testid="main-menu-trigger"]')!;
    expect(button.getAttribute('data-tooltip-placement')).toBe('bottom');
  });
});

describe('clampSketchContextPopover', () => {
  function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect);
  }

  it('is a no-op when the popover has no measured width', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    stubRect(popover, { width: 0, height: 0 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    expect(popover.style.left).toBe('');
    expect(popover.style.top).toBe('');
  });

  it('is a no-op when the popover has measured width but no height', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    stubRect(popover, { width: 200, height: 0 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    expect(popover.style.left).toBe('');
    expect(popover.style.top).toBe('');
  });

  it('is a no-op when the derived position is not finite (a non-numeric inline style keyword)', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    // 'auto' is a valid CSS `left`/`top` keyword (so jsdom's CSSOM accepts
    // the assignment, unlike a garbage string) but parses to NaN.
    popover.style.left = 'auto';
    stubRect(popover, { width: 100, height: 50, left: 10, top: 10, right: 110, bottom: 60 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    expect(popover.style.top).toBe('');
  });

  it('clamps a popover overflowing the right/bottom viewport edges', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    stubRect(popover, { width: 200, height: 100, left: 700, top: 550, right: 900, bottom: 650 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    // maxRight = 800-8=792, overflow = 900-792=108, nextLeft = 700-108=592
    expect(popover.style.left).toBe('592px');
    // maxBottom = 600-8=592, overflow = 650-592=58, nextTop = 550-58=492
    expect(popover.style.top).toBe('492px');
  });

  it('clamps a popover overflowing the left/top viewport edges, floored at 0', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    stubRect(popover, { width: 100, height: 50, left: -20, top: -20, right: 80, bottom: 30 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    // minLeft = 0+8=8, nextLeft = -20+(8-(-20)) = 8
    expect(popover.style.left).toBe('8px');
    expect(popover.style.top).toBe('8px');
  });

  it('does not touch inline style when the current position already satisfies the clamp', () => {
    const popover = document.createElement('div');
    const viewport = document.createElement('div');
    popover.style.left = '10px';
    popover.style.top = '10px';
    stubRect(popover, { width: 100, height: 50, left: 10, top: 10, right: 110, bottom: 60 });
    stubRect(viewport, { left: 0, top: 0, right: 800, bottom: 600 });
    clampSketchContextPopover(popover, viewport);
    expect(popover.style.left).toBe('10px');
    expect(popover.style.top).toBe('10px');
  });
});

describe('applySketchContextMenuSimplification', () => {
  function buildMenu(actions: string[]): { root: HTMLElement; menu: HTMLUListElement; popover: HTMLElement } {
    const root = document.createElement('div');
    const popover = document.createElement('div');
    popover.className = 'popover';
    const menu = document.createElement('ul');
    menu.className = 'context-menu';
    for (const action of actions) {
      const li = document.createElement('li');
      li.setAttribute('data-testid', action);
      li.textContent = action;
      menu.appendChild(li);
    }
    const hr = document.createElement('hr');
    menu.appendChild(hr);
    popover.appendChild(menu);
    root.appendChild(popover);
    document.body.appendChild(root);
    return { root, menu, popover };
  }

  it('removes disallowed actions and separators, keeping allow-listed ones in order', () => {
    const { root, menu, popover } = buildMenu(['delete', 'copyAsSvg', 'copy', 'duplicate']);
    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    const items = Array.from(menu.querySelectorAll('li')).map((li) => li.getAttribute('data-testid'));
    expect(items).toEqual(['copy', 'copyAsSvg']);
    expect(menu.querySelectorAll('hr')).toHaveLength(0);
    expect(menu.classList.contains('jini-sketch-context-menu')).toBe(true);
    expect(popover.classList.contains('jini-sketch-context-popover')).toBe(true);
  });

  it('ignores a context menu with no recognized Excalidraw action', () => {
    const { menu } = buildMenu(['someUnrelatedAction']);
    const root = menu.closest('div')!;
    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    expect(menu.classList.contains('jini-sketch-context-menu')).toBe(false);
    expect(menu.querySelectorAll('li')).toHaveLength(1);
  });

  it('removes the popover entirely when no allow-listed action survives', () => {
    const { root, popover } = buildMenu(['delete', 'duplicate']);
    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    expect(root.contains(popover)).toBe(false);
  });

  it('does not reorder DOM nodes when already in the correct order (avoids reorder churn)', () => {
    const { root, menu } = buildMenu(['copy', 'paste']);
    const firstChildBefore = menu.children[0];
    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    expect(menu.children[0]).toBe(firstChildBefore);
  });

  it('falls back to the menu\'s parent element when there is no .popover ancestor', () => {
    const root = document.createElement('div');
    const menu = document.createElement('ul');
    menu.className = 'context-menu';
    const li = document.createElement('li');
    li.setAttribute('data-testid', 'copy');
    menu.appendChild(li);
    root.appendChild(menu); // menu's parent is `root` itself, no `.popover` wrapper
    document.body.appendChild(root);

    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    expect(root.classList.contains('jini-sketch-context-popover')).toBe(true);
  });

  it('leaves a non-<li>, non-<hr> child untouched but removes a <li> without a data-testid', () => {
    const { root, menu } = buildMenu(['copy']);
    const stray = document.createElement('div');
    stray.textContent = 'stray';
    menu.appendChild(stray);
    const bareLi = document.createElement('li');
    bareLi.textContent = 'no testid';
    menu.appendChild(bareLi);

    applySketchContextMenuSimplification(root, root, DEFAULT_CONTEXT_MENU_ACTION_ORDER, DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS);
    // Only <li>/<hr> children are ever touched; an unrelated element child
    // (not part of Excalidraw's own context-menu markup) is simply skipped.
    expect(menu.contains(stray)).toBe(true);
    expect(menu.contains(bareLi)).toBe(false);
    expect(Array.from(menu.querySelectorAll('li')).map((li) => li.getAttribute('data-testid'))).toEqual(['copy']);
  });
});

describe('applySketchDomTextOverrides', () => {
  it('rewrites matching text nodes and attributes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button title="Close" aria-label="Close">Close</button>';
    applySketchDomTextOverrides(root, { Close: 'Fermer' });
    const button = root.querySelector('button')!;
    expect(button.textContent).toBe('Fermer');
    expect(button.getAttribute('title')).toBe('Fermer');
    expect(button.getAttribute('aria-label')).toBe('Fermer');
  });

  it('is a no-op when overrides are undefined or empty', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button title="Close">Close</button>';
    applySketchDomTextOverrides(root, undefined);
    applySketchDomTextOverrides(root, {});
    expect(root.querySelector('button')!.textContent).toBe('Close');
  });

  it('walks a non-Element ParentNode (e.g. a DocumentFragment) too', () => {
    const fragment = document.createDocumentFragment();
    const button = document.createElement('button');
    button.title = 'Close';
    button.textContent = 'Close';
    fragment.appendChild(button);
    applySketchDomTextOverrides(fragment, { Close: 'Fermer' });
    expect(button.textContent).toBe('Fermer');
    expect(button.getAttribute('title')).toBe('Fermer');
  });
});

describe('rewriteExcalidrawUnableToEmbedToasts', () => {
  it('rewrites the recognized "can\'t embed" toast message', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="Toast"><div class="Toast__message">Embedding this URL is currently not allowed</div></div>';
    document.body.appendChild(root);
    rewriteExcalidrawUnableToEmbedToasts(root, 'Cannot embed this link');
    const message = root.querySelector('.Toast__message')!;
    expect(message.textContent).toBe('Cannot embed this link');
    expect(message.closest('.Toast')!.getAttribute('data-jini-sketch-embed-toast-rewritten')).toBe('true');
  });

  it('leaves unrelated toast messages untouched', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="Toast"><div class="Toast__message">Saved successfully</div></div>';
    rewriteExcalidrawUnableToEmbedToasts(root, 'Cannot embed this link');
    expect(root.querySelector('.Toast__message')!.textContent).toBe('Saved successfully');
  });

  it('is a no-op when the replacement text itself is empty/whitespace-only', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="Toast"><div class="Toast__message">Embedding this URL is currently not allowed</div></div>';
    rewriteExcalidrawUnableToEmbedToasts(root, '   ');
    expect(root.querySelector('.Toast__message')!.textContent).toBe('Embedding this URL is currently not allowed');
  });
});

describe('findSketchMermaidInsertButton / removeSketchMermaidShortcutHints', () => {
  it('finds the Insert button inside a Mermaid dialog and strips shortcut hints', () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <div>Mermaid syntax</div>
      <button aria-label="Cancel">Cancel</button>
      <button aria-label="Insert diagram">Insert <kbd>Cmd+Enter</kbd></button>
      <div class="ttd-dialog-submit-shortcut">Cmd+Enter</div>
    `;
    const button = findSketchMermaidInsertButton(content, INSERT_PATTERN);
    expect(button?.getAttribute('aria-label')).toBe('Insert diagram');

    removeSketchMermaidShortcutHints(content, INSERT_PATTERN);
    expect(content.querySelectorAll('kbd')).toHaveLength(0);
    expect(content.querySelectorAll('.ttd-dialog-submit-shortcut')).toHaveLength(0);
  });

  it('returns null for a non-Mermaid dialog', () => {
    const content = document.createElement('div');
    content.innerHTML = '<div>Some other dialog</div><button>Insert</button>';
    expect(findSketchMermaidInsertButton(content, INSERT_PATTERN)).toBeNull();
  });

  it('falls back to aria-label when textContent normalizes to empty', () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <div>Mermaid syntax</div>
      <button aria-label="Insert"></button>
    `;
    const button = findSketchMermaidInsertButton(content, INSERT_PATTERN);
    expect(button?.getAttribute('aria-label')).toBe('Insert');
  });

  it('skips a button with neither textContent nor an aria-label', () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <div>Mermaid syntax</div>
      <button></button>
      <button aria-label="Insert diagram">Insert</button>
    `;
    const button = findSketchMermaidInsertButton(content, INSERT_PATTERN);
    expect(button?.getAttribute('aria-label')).toBe('Insert diagram');
  });

  it('returns null when a Mermaid dialog has buttons but none match the insert pattern', () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <div>Mermaid syntax</div>
      <button>Cancel</button>
      <button>Close</button>
    `;
    expect(findSketchMermaidInsertButton(content, INSERT_PATTERN)).toBeNull();
  });
});

describe('enhanceSketchExcalidrawPortals', () => {
  it('marks portals, toggles the help-modal class, and injects a labeled close button', () => {
    const portal = document.createElement('div');
    portal.className = 'excalidraw-modal-container';
    portal.innerHTML = '<div class="Modal__content">Hello <span class="HelpDialog__header"></span></div>';
    document.body.appendChild(portal);

    const onClose = vi.fn();
    enhanceSketchExcalidrawPortals('Close', onClose, undefined, INSERT_PATTERN);

    expect(portal.classList.contains('jini-sketch-modal')).toBe(true);
    expect(portal.classList.contains('jini-sketch-help-modal')).toBe(true);
    const close = portal.querySelector<HTMLButtonElement>('.jini-sketch-dialog-close')!;
    expect(close).not.toBeNull();
    expect(close.getAttribute('aria-label')).toBe('Close');

    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not inject a second close button on a repeat call', () => {
    const portal = document.createElement('div');
    portal.className = 'excalidraw-modal-container';
    portal.innerHTML = '<div class="Modal__content">Hello</div>';
    document.body.appendChild(portal);

    enhanceSketchExcalidrawPortals('Close', vi.fn(), undefined, INSERT_PATTERN);
    enhanceSketchExcalidrawPortals('Close', vi.fn(), undefined, INSERT_PATTERN);
    expect(portal.querySelectorAll('.jini-sketch-dialog-close')).toHaveLength(1);
  });

  it('applies domTextOverrides inside the portal', () => {
    const portal = document.createElement('div');
    portal.className = 'excalidraw-modal-container';
    portal.innerHTML = '<div class="Modal__content"><span>Preview</span></div>';
    document.body.appendChild(portal);

    enhanceSketchExcalidrawPortals('Fermer', vi.fn(), { Preview: 'Aperçu' }, INSERT_PATTERN);
    expect(portal.querySelector('span')!.textContent).toBe('Aperçu');
  });
});

describe('handleSketchPortalCommandEnter', () => {
  function keydown(target: Element, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true, ...options });
    Object.defineProperty(event, 'target', { value: target, enumerable: true });
    return event;
  }

  it('clicks the Insert button on Cmd+Enter inside a Mermaid dialog textarea', () => {
    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML =
      '<div class="Modal__content">Mermaid<textarea></textarea><button aria-label="Insert diagram">Insert</button></div>';
    document.body.appendChild(portal);
    const button = portal.querySelector('button')!;
    const onClick = vi.fn();
    button.addEventListener('click', onClick);

    const textarea = portal.querySelector('textarea')!;
    handleSketchPortalCommandEnter(keydown(textarea), INSERT_PATTERN);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a plain Enter (no modifier)', () => {
    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML = '<div class="Modal__content">Mermaid<textarea></textarea><button>Insert</button></div>';
    document.body.appendChild(portal);
    const button = portal.querySelector('button')!;
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    const textarea = portal.querySelector('textarea')!;
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'target', { value: textarea, enumerable: true });
    handleSketchPortalCommandEnter(event, INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does nothing outside a modal/without a textarea', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(() => handleSketchPortalCommandEnter(keydown(div), INSERT_PATTERN)).not.toThrow();
  });

  it('does nothing when the event target is not an Element (e.g. a detached Text node)', () => {
    const text = document.createTextNode('hi');
    expect(() => handleSketchPortalCommandEnter(keydown(text as unknown as Element), INSERT_PATTERN)).not.toThrow();
  });

  it('does nothing inside a modal that has no textarea', () => {
    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML = '<div class="Modal__content">Mermaid<button aria-label="Insert diagram">Insert</button></div>';
    document.body.appendChild(portal);
    const button = portal.querySelector('button')!;
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    const content = portal.querySelector('.Modal__content')!;
    handleSketchPortalCommandEnter(keydown(content), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does nothing when the matched Insert button is disabled', () => {
    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML =
      '<div class="Modal__content">Mermaid<textarea></textarea><button aria-label="Insert diagram" disabled>Insert</button></div>';
    document.body.appendChild(portal);
    const button = portal.querySelector('button')!;
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    const textarea = portal.querySelector('textarea')!;
    handleSketchPortalCommandEnter(keydown(textarea), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does nothing when the matched Insert button is aria-disabled', () => {
    const portal = document.createElement('div');
    portal.className = 'jini-sketch-modal';
    portal.innerHTML =
      '<div class="Modal__content">Mermaid<textarea></textarea><button aria-label="Insert diagram" aria-disabled="true">Insert</button></div>';
    document.body.appendChild(portal);
    const button = portal.querySelector('button')!;
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    const textarea = portal.querySelector('textarea')!;
    handleSketchPortalCommandEnter(keydown(textarea), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('dom.ts boundary pins', () => {
  function commandEnter(target: Element, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true, ...options });
    Object.defineProperty(event, 'target', { value: target, enumerable: true });
    return event;
  }

  function mountMermaidPortal(html: string): { textarea: HTMLTextAreaElement; onClick: ReturnType<typeof vi.fn> } {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const onClick = vi.fn();
    host.querySelector('button')?.addEventListener('click', onClick);
    return { textarea: host.querySelector('textarea')!, onClick };
  }

  const MERMAID_PORTAL =
    '<div class="jini-sketch-modal"><div class="Modal__content">Mermaid<textarea></textarea><button>Insert</button></div></div>';

  it('Ctrl+Enter (no Meta) also submits the Mermaid Insert button', () => {
    const { textarea, onClick } = mountMermaidPortal(MERMAID_PORTAL);
    handleSketchPortalCommandEnter(commandEnter(textarea, { metaKey: false, ctrlKey: true }), INSERT_PATTERN);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a submitted Command+Enter is prevented from reaching the editor', () => {
    const { textarea } = mountMermaidPortal(MERMAID_PORTAL);
    const event = commandEnter(textarea);
    handleSketchPortalCommandEnter(event, INSERT_PATTERN);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Cmd+Alt+Enter is ignored', () => {
    const { textarea, onClick } = mountMermaidPortal(MERMAID_PORTAL);
    handleSketchPortalCommandEnter(commandEnter(textarea, { altKey: true }), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a non-Enter key with Meta held is ignored', () => {
    const { textarea, onClick } = mountMermaidPortal(MERMAID_PORTAL);
    handleSketchPortalCommandEnter(commandEnter(textarea, { key: 'a' }), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is ignored when the .Modal__content sits outside (around) the .jini-sketch-modal', () => {
    const { textarea, onClick } = mountMermaidPortal(
      '<div class="Modal__content">Mermaid<button>Insert</button><div class="jini-sketch-modal"><textarea></textarea></div></div>',
    );
    handleSketchPortalCommandEnter(commandEnter(textarea), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is ignored inside a modal whose content is not a Mermaid dialog', () => {
    const { textarea, onClick } = mountMermaidPortal(
      '<div class="jini-sketch-modal"><div class="Modal__content">Other<textarea></textarea><button>Insert</button></div></div>',
    );
    handleSketchPortalCommandEnter(commandEnter(textarea), INSERT_PATTERN);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applySketchEditorTooltips skips a "closest-label" trigger that has no <label> ancestor', () => {
    const root = document.createElement('div');
    root.innerHTML = '<input class="probe" />';
    applySketchEditorTooltips(root, labels, [{ selector: '.probe', label: 'hand', target: 'closest-label' }]);
    expect(root.innerHTML).toBe('<input class="probe">');
  });

  it('clampSketchContextPopover falls back to the measured rect when no inline left/top is set', () => {
    const viewport = document.createElement('div');
    const popover = document.createElement('div');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    vi.spyOn(popover, 'getBoundingClientRect').mockReturnValue(new DOMRect(90, 20, 30, 30));
    clampSketchContextPopover(popover, viewport);
    expect([popover.style.left, popover.style.top]).toEqual(['62px', '20px']);
  });

  it('clampSketchContextPopover leaves an in-bounds axis that already matches its inline value untouched', () => {
    const viewport = document.createElement('div');
    const popover = document.createElement('div');
    popover.style.left = '90px';
    popover.style.top = '20px';
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    vi.spyOn(popover, 'getBoundingClientRect').mockReturnValue(new DOMRect(90, 20, 30, 30));
    clampSketchContextPopover(popover, viewport);
    expect([popover.style.left, popover.style.top]).toEqual(['62px', '20px']);
  });

  it('applySketchContextMenuSimplification keeps an earlier duplicate action <li> in front of the reordered survivors', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="popover"><ul class="context-menu"><li data-testid="paste">a</li><li data-testid="copy">b</li><li data-testid="paste">c</li></ul></div>';
    document.body.appendChild(root);
    applySketchContextMenuSimplification(root, document.body, ['copy', 'paste'], ['copy']);
    expect(root.querySelector('ul')!.textContent).toBe('abc');
  });

  it('applySketchContextMenuSimplification orders by the LAST occurrence of a duplicated allow-list entry', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="popover"><ul class="context-menu"><li data-testid="paste">p</li><li data-testid="copy">c</li></ul></div>';
    document.body.appendChild(root);
    applySketchContextMenuSimplification(root, document.body, ['copy', 'paste', 'copy'], ['copy']);
    expect(root.querySelector('ul')!.textContent).toBe('pc');
  });

  it('applySketchContextMenuSimplification re-appends items on every call when an allow-list entry is duplicated (reported, not fixed)', () => {
    // The "already ordered" check compares lengths, and a duplicated allow-list
    // entry makes the expected list longer than the menu, so the reorder (and
    // the MutationObserver churn the source comment warns about) never settles.
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="popover"><ul class="context-menu"><li data-testid="paste">p</li><li data-testid="copy">c</li></ul></div>';
    document.body.appendChild(root);
    applySketchContextMenuSimplification(root, document.body, ['copy', 'paste', 'copy'], ['copy']);
    const menu = root.querySelector('ul')!;
    const append = vi.spyOn(menu, 'appendChild');
    applySketchContextMenuSimplification(root, document.body, ['copy', 'paste', 'copy'], ['copy']);
    expect(append).toHaveBeenCalledTimes(3);
  });

  it('applySketchDomTextOverrides rewrites the root element\'s own attribute and skips empty attributes', () => {
    const root = document.createElement('div');
    root.setAttribute('title', 'Close');
    root.innerHTML = '<span aria-label="">Close</span>';
    applySketchDomTextOverrides(root, { Close: 'Fermer' });
    expect(root.outerHTML).toBe('<div title="Fermer"><span aria-label="">Fermer</span></div>');
  });

  it('applySketchDomTextOverrides performs no DOM write when an override maps a value to itself', () => {
    const root = document.createElement('div');
    root.setAttribute('title', 'Close');
    root.textContent = 'Close';
    const observer = new MutationObserver(() => {});
    observer.observe(root, { attributes: true, characterData: true, subtree: true });
    applySketchDomTextOverrides(root, { Close: 'Close' });
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it('applySketchContextMenuSimplification appends nothing when the menu is already in allow-list order', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="popover"><ul class="context-menu"><li data-testid="copy">c</li><li data-testid="paste">p</li></ul></div>';
    document.body.appendChild(root);
    const menu = root.querySelector('ul')!;
    const append = vi.spyOn(menu, 'appendChild');
    applySketchContextMenuSimplification(root, document.body, ['copy', 'paste'], ['copy']);
    expect(append).not.toHaveBeenCalled();
  });

  it('a disabled Insert button leaves Command+Enter unhandled (not prevented)', () => {
    const { textarea } = mountMermaidPortal(
      '<div class="jini-sketch-modal"><div class="Modal__content">Mermaid<textarea></textarea><button disabled>Insert</button></div></div>',
    );
    const event = commandEnter(textarea);
    handleSketchPortalCommandEnter(event, INSERT_PATTERN);
    expect(event.defaultPrevented).toBe(false);
  });
});
