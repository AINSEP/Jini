import { createPortal } from 'react-dom';
import { resolveTone, toneClassName, type ConfirmTone } from '../../types.js';
import { useRowMenu } from './RowMenu.hooks.js';

/**
 * @file Three-dot overflow menu for table rows — replaces the "one visible button per row" pattern
 * so a row can grow more actions (Edit, Disable, Delete, …) without widening the table or producing
 * the wall of buttons that pattern turns into.
 *
 * Portaled to `document.body` and positioned with `getBoundingClientRect()` rather than rendered as
 * an in-flow absolutely-positioned child of the trigger — an admin table normally sits inside a
 * horizontal scroller (`overflow-x: auto`), and per the CSS overflow spec, setting either axis to a
 * non-`visible` value forces the *other* axis to compute as `auto` as well, so a menu positioned to
 * escape the table's own box would be silently clipped by that same scroller. This is the identical
 * problem `Sidebar.tsx`'s `RailTooltip` solves for `.cms-nav`'s `overflow-y: auto` (see that
 * component's doc comment, where it was verified live via `getComputedStyle`) — same fix here: a
 * DOM sibling of the app root, not a descendant of the clipping element. The measurement and
 * repositioning itself lives in `RowMenu.hooks.tsx` — see that file's doc comment.
 *
 * Unstyled: `.row-menu-trigger`, `.row-menu-popup`, `.row-menu-popup-above`, and `.row-menu-item`
 * are emitted for the host stylesheet to define. Only the positioning that has to be measured at
 * runtime is set inline.
 */

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Visual tone — `"warning"` for reversible-but-access-affecting actions (e.g. Disable),
   *  `"danger"` for genuinely destructive ones (e.g. Delete). Defaults to `"default"` (neutral).
   *  Shares `ConfirmDialog`'s three-tier vocabulary on purpose — a caller wiring up "Disable opens
   *  nothing, Delete opens a ConfirmDialog" from the same item list should not have to reconcile
   *  two different tone enums to keep the colors matching. Wins over `destructive` below when both
   *  are passed. */
  tone?: ConfirmTone;
  /** @deprecated Use `tone: "danger"` instead — this only ever expressed the danger tier, and the
   *  vocabulary has a second one (`"warning"`) this boolean cannot reach. Kept working (mapped to
   *  `tone: "danger"` when `tone` is not set) for existing callers rather than a breaking rename. */
  destructive?: boolean;
}

export interface RowMenuProps {
  items: RowMenuItem[];
  /** Full accessible name for the trigger, e.g. `Actions for "My Post"` — the row's own title
   *  doesn't disambiguate a bare "⋯" for a screen-reader user navigating control-by-control rather
   *  than row-by-row, same reasoning as `ConfirmButton.ariaLabel`. */
  triggerLabel: string;
  /** Injectable seam for the menu's open/close, positioning, and keyboard/focus state. Defaults to
   *  the real {@link useRowMenu}; a test can pass a fake here to exercise `RowMenu`'s rendering
   *  without driving the real positioning math or DOM measurement. */
  useRowMenu?: typeof useRowMenu;
}

export function RowMenu({ useRowMenu: useRowMenuState = useRowMenu, ...props }: RowMenuProps) {
  const {
    open,
    position,
    triggerRef,
    menuRef,
    itemRefs,
    onTriggerClick,
    onTriggerKeyDown,
    onMenuKeyDown,
    selectItem,
  } = useRowMenuState(props.items.length);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu-trigger"
        aria-label={props.triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        {/* Three vertical dots — the conventional overflow/"kebab" affordance. Filled circles, not
            stroked outlines, unlike this package's other icons (`Sidebar.tsx`'s stroke-based rail-
            toggle chevrons): at this glyph's actual rendered size (16px, scaled down from this
            18-unit viewBox), a thin stroked ring goes muddy where a filled dot stays crisp. Always
            paired with the real accessible name (`aria-label` on the `<button>` above, from
            `triggerLabel`) rather than shipped as a bare unlabeled icon — this glyph itself is
            `aria-hidden`, a screen reader never reaches it. */}
        <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="4.5" r="1.5" />
          <circle cx="9" cy="9" r="1.5" />
          <circle cx="9" cy="13.5" r="1.5" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={props.triggerLabel}
              className={`row-menu-popup${position?.placement === 'above' ? ' row-menu-popup-above' : ''}`}
              style={{
                position: 'fixed',
                top: position ? position.top : -9999,
                left: position ? position.left : -9999,
                // Laid out but invisible until the first `reposition()` measurement lands (see
                // `RowMenu.hooks.tsx`) — keeps `offsetHeight`/`offsetWidth` measurable without a
                // visible flash at the wrong coordinates.
                visibility: position ? 'visible' : 'hidden',
                transform: position?.placement === 'above' ? 'translateY(-100%)' : undefined,
              }}
              onKeyDown={onMenuKeyDown}
            >
              {props.items.map((item, index) => {
                const toneClass = toneClassName(resolveTone(item));
                return (
                  <button
                    key={item.key}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={['row-menu-item', toneClass].filter(Boolean).join(' ')}
                    onClick={() => selectItem(item.onSelect)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
