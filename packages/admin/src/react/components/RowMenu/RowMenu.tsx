import { createPortal } from 'react-dom';
import { agentHandle, buildAgentListHandles, type AgentElementRole } from '@jini-ai/agentic';
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
 *
 * ## Agent handles
 *
 * Given `agentHandle="post-42"` this publishes, whenever the menu is actually open:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the trigger button | `post-42` | `button` |
 * | one dropdown item, keyed by the caller's own `RowMenuItem.key` | `post-42-item-<slug of key>` | `button` |
 *
 * Items sit under their own `-item-` namespace, via `@jini-ai/agentic`'s `buildAgentListHandles`,
 * rather than directly under `<base>` — a host is free to key an item `"edit"`, and nothing should
 * stop that colliding with a hypothetical future `<base>-edit` action of this component's own, the
 * same reasoning `source-config-list/agent-handles.ts` documents for its own `-field-`/`-item-`
 * namespaces. `buildAgentListHandles` also absorbs two host realities this component cannot control:
 * item keys are arbitrary strings, not pre-validated handle segments, and two different keys can
 * slugify to the same thing (`"Edit"` and `"edit"`) — both are resolved there once rather than
 * re-derived here. `agentHandle` itself is NOT sanitized: it is the caller's own explicit choice of
 * name and a bad one should fail loudly at first render rather than silently answer to a handle the
 * caller never wrote. Omit `agentHandle` and no `data-agent-*` markup is emitted at all.
 *
 * A table renders one `RowMenu` per row, so the caller is responsible for handing each row a
 * DISTINCT base — two rows under the same base would publish duplicate handles and make every verb
 * on them ambiguous.
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
  /** This row's own agent handle — see this file's "Agent handles" doc comment for the full
   *  scheme. Omit and no `data-agent-*` markup is emitted at all. */
  agentHandle?: string;
}

/**
 * Builds the `data-agent-*` attribute props for one of this row's sub-elements, or nothing at all
 * when the row published no base handle — same shape as `source-config-list/agent-handles.ts`'s
 * `sourceConfigAgentProps`, kept local and unexported here since only this one component needs it.
 *
 * @param handle - This sub-element's already-resolved handle, or `undefined` when the caller
 *   published no `agentHandle` for the row at all.
 * @param options - Role and stable label for this sub-element.
 * @returns Spreadable attribute props, or `{}` when `handle` is `undefined`.
 * @complexity O(1).
 */
function rowMenuAgentProps(handle: string | undefined, options: { role: AgentElementRole; label: string }) {
  return handle === undefined ? {} : agentHandle(handle, options);
}

export function RowMenu({
  useRowMenu: useRowMenuState = useRowMenu,
  agentHandle: baseHandle,
  ...props
}: RowMenuProps) {
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

  // One base handle per item, positionally aligned with `props.items` — undefined (rather than an
  // empty array) when the caller published no `agentHandle` at all, so the render below can tell
  // "opted out" apart from "an empty item list" without a second flag.
  const itemHandles = baseHandle
    ? buildAgentListHandles(`${baseHandle}-item`, props.items.map((item) => item.key))
    : undefined;

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
        {...rowMenuAgentProps(baseHandle, { role: 'button', label: props.triggerLabel })}
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
                    {...rowMenuAgentProps(itemHandles?.[index], { role: 'button', label: item.label })}
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
