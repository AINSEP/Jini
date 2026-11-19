/**
 * Whether a keydown that reached the card should open the project.
 *
 * The `event.target !== event.currentTarget` half is the whole reason this is a function rather
 * than an inline condition. The card is a keyboard-activated open target, and it is also the
 * ANCESTOR of the delete button; a keydown on that button bubbles to the card, where an unguarded
 * handler called `preventDefault()` — cancelling the very click the browser was about to synthesize
 * from the key — and then opened the project. Keyboard users therefore could not reach the delete
 * confirmation at all: Enter or Space on a focused delete button opened the project instead.
 *
 * An overlay can stop both keydown and click propagation, while a descendant button may stop
 * only clicks. Guarding at the card instead of at each descendant covers both shapes and any
 * control added later, which is why the check lives here and not on the button.
 *
 * @param event the keydown, narrowed to the three fields this decision reads — so a test can call
 *   it with plain objects and no DOM.
 * @complexity O(1) time, O(1) space.
 */
export function isCardOpenKey(event: {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}): boolean {
  if (event.target !== event.currentTarget) return false;
  return event.key === 'Enter' || event.key === ' ';
}

/** Exactly what {@link isCardOpenKey} reads, plus the one method the handler calls — so a test can
 *  drive `cardOpenProps` with a plain object and no DOM, the same way `isCardOpenKey` already can. */
export interface CardOpenKeyEvent {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault: () => void;
}

/**
 * The card's "I am an open target" props, or the inert equivalents.
 *
 * Extracted because the card element was carrying five separate `openable ? … : undefined`
 * ternaries for what is one decision — a reader had to check all five to confirm they agreed, and
 * a sixth attribute added later could disagree with the other five silently. One call, one answer.
 *
 * `onKeyDown` keeps using {@link isCardOpenKey} rather than an inline key check: it also refuses a
 * keydown that started on a DESCENDANT, which is what stops the delete button's and the ⋮ menu's
 * keyboard activation from opening the site instead. See that function's own doc.
 *
 * @param required.openable whether this card should respond at all.
 * @param required.onOpen invoked with nothing — the caller closes over which site it means.
 * @complexity O(1) time, O(1) space.
 */
export function cardOpenProps({ openable, onOpen }: { openable: boolean; onOpen: () => void }, _options = {}
): {
  role: 'button' | undefined;
  tabIndex: 0 | undefined;
  onClick: (() => void) | undefined;
  onKeyDown: ((event: CardOpenKeyEvent) => void) | undefined;
} {
  if (!openable) {
    return { role: undefined, tabIndex: undefined, onClick: undefined, onKeyDown: undefined };
  }
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (!isCardOpenKey(event)) return;
      event.preventDefault();
      onOpen();
    },
  };
}

/**
 * The ⋮ menu's per-entry `onClick` builder: every entry closes the menu first, then acts — the same
 * order needed when an entry opens another surface. Acting first would leave an open menu
 * floating over whatever the action changed.
 *
 * @param required.setOpen the menu's open-state setter (owned by the host).
 * @returns `choose({ act })`, which builds one entry's handler. Building it runs nothing.
 * @complexity O(1) time, O(1) space.
 */
export function closeMenuThen({ setOpen }: { setOpen: (open: boolean) => void }, _options = {}): (required: { act: () => void }) => () => void {
  return ({ act }) => () => {
    setOpen(false);
    act();
  };
}

/**
 * A name is a label, never site identity. Keep unrelated cards and expose their parent paths.
 * @returns The display names more than one site has. @complexity O(n) in `projects`.
 */
export function duplicateDisplayNames({ projects }: { projects: readonly { displayName: string }[] }, _options = {}): Set<string> {
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();
  for (const project of projects) {
    if (seenNames.has(project.displayName)) duplicateNames.add(project.displayName);
    seenNames.add(project.displayName);
  }
  return duplicateNames;
}

