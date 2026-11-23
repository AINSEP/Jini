import { createPortal } from "react-dom";
import type { CSSProperties, JSX } from "react";
import { resolveTone, toneClassName } from "../../react/types.js";
import type { RowMenuProps } from "../../react/components/RowMenu/RowMenu.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { useTaxonomyRowMenu } from "./TaxonomyRowMenu.hooks.js";

type MenuState = ReturnType<typeof useTaxonomyRowMenu>;

export type TaxonomyRowMenuProps = Pick<RowMenuProps, "items" | "triggerLabel" | "agentHandle"> & {
  /** Mounted page root, outside the row scroller and inside the scoped agent driver. */
  portalContainer: HTMLElement | null;
  /** The menu state hook; the host injects `useTaxonomyRowMenu` (or a test double). */
  useTaxonomyRowMenuHook: typeof useTaxonomyRowMenu;
};

/**
 * A page-scoped overflow menu using the contracts published in admin 0.3.10.
 * That release's RowMenu always portals to document.body, outside the page driver's root.
 * Keep the host-specific portal here until a published component offers the same contract.
 * @param props - Actions, accessible trigger name, optional agent handle and mounted page root.
 * @returns Trigger plus a fixed popup; no popup is allowed before the page root mounts.
 * Classes are `jini-taxonomy-row-menu-*`; the host styles them (aliases of its row-menu rules).
 * @example <TaxonomyRowMenu items={actions} triggerLabel="Actions" portalContainer={pageRoot} useTaxonomyRowMenuHook={useTaxonomyRowMenu} />
 */
export function TaxonomyRowMenu({ items, triggerLabel, agentHandle: baseHandle, portalContainer,
  useTaxonomyRowMenuHook }: TaxonomyRowMenuProps): JSX.Element {
  const menu = useTaxonomyRowMenuHook({ itemCount: items.length });
  const itemHandles = baseHandle ? buildAgentListHandles({ prefix: `${baseHandle}-item`, ids: items.map((item) => item.key) }) : undefined;
  return <>
    <button
      ref={menu.triggerRef}
      type="button"
      className="jini-taxonomy-row-menu-trigger"
      aria-label={triggerLabel}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      disabled={portalContainer === null || items.length === 0}
      onClick={menu.onTriggerClick}
      onKeyDown={menu.onTriggerKeyDown}
      {...buttonHandleProps({ handle: baseHandle, label: triggerLabel })}
    >
      <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="4.5" r="1.5" />
        <circle cx="9" cy="9" r="1.5" />
        <circle cx="9" cy="13.5" r="1.5" />
      </svg>
    </button>
    {menu.open && portalContainer ? createPortal(
      <TaxonomyRowMenuPopup menu={menu} items={items} triggerLabel={triggerLabel} itemHandles={itemHandles} />, portalContainer,
    ) : null}
  </>;
}

/**
 * The agent-handle attributes for one of this menu's buttons, or none when it publishes no handle.
 * @param required - The button's handle (absent when the menu has no base handle) and its label.
 * @returns Spreadable `data-agent-*` props, or an empty object.
 */
function buttonHandleProps({ handle, label }: { handle: string | undefined; label: string }) {
  return handle === undefined ? {} : agentHandle({ handle }, { role: "button", label });
}

/**
 * Where the fixed popup sits. Before the first layout measure lands it is parked off-screen and hidden.
 * @param required - The hook's measured position, or `null` before the first measure.
 * @returns The popup's inline style.
 */
function popupStyle({ position }: { position: MenuState["position"] }): CSSProperties {
  if (!position) return { position: "fixed", top: -9999, left: -9999, visibility: "hidden", transform: undefined };
  return {
    position: "fixed",
    top: position.top,
    left: position.left,
    visibility: "visible",
    transform: position.placement === "above" ? "translateY(-100%)" : undefined,
  };
}

interface TaxonomyRowMenuPopupProps {
  menu: MenuState;
  items: TaxonomyRowMenuProps["items"];
  triggerLabel: string;
  /** One handle per item, in item order — absent when the menu publishes no handles. */
  itemHandles: string[] | undefined;
}

/** The portalled `role="menu"` list of actions — split out of `TaxonomyRowMenu` unchanged. */
function TaxonomyRowMenuPopup({ menu, items, triggerLabel, itemHandles }: TaxonomyRowMenuPopupProps): JSX.Element {
  const above = menu.position?.placement === "above";
  return <div
    ref={menu.menuRef}
    role="menu"
    aria-label={triggerLabel}
    className={`jini-taxonomy-row-menu-popup${above ? " jini-taxonomy-row-menu-popup-above" : ""}`}
    style={popupStyle({ position: menu.position })}
    onKeyDown={menu.onMenuKeyDown}
  >
    {items.map((item, index) => <button
      key={item.key}
      ref={(element) => { menu.itemRefs.current[index] = element; }}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={["jini-taxonomy-row-menu-item", toneClassName({ tone: resolveTone({}, item) })].filter(Boolean).join(" ")}
      onClick={() => menu.selectItem({ onSelect: item.onSelect })}
      {...buttonHandleProps({ handle: itemHandles?.[index], label: item.label })}
    >{item.label}</button>)}
  </div>;
}
