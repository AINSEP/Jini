import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { AdminNavGroup, AdminNavItem } from '../../core/manifest/rules.js';
import { DEFAULT_ADMIN_BASE, adminHref } from '../../core/routing/rules.js';
import { useSidebarRail } from '../hooks/use-sidebar-rail.js';

/**
 * @file Admin sidebar, as a compound component.
 *
 * ## Why children rather than props
 *
 * A sidebar's *content* and its *chrome* are two different questions, and only the first has an
 * obvious owner. The content is already host-owned: `<Sidebar.Nav>` takes the array `/core`'s
 * `buildNav(panels)` returns, so this package ships no labels, no icons, and no section list.
 *
 * The chrome is where a props-based API quietly imposes one host's product decisions on every other
 * host. An earlier draft of this component rendered a mobile header, then the nav, then a footer
 * containing a rail toggle and a log-out button — fixed order, all mandatory. Any second consumer
 * inherited "log out lives in the sidebar", and adding a workspace switcher between the nav and the
 * footer meant a new prop. Growing that into `header` / `footer` / `renderItem` slots would have
 * traded a fixed structure for a growing prop list and still fixed the order.
 *
 * Children solve both: the host chooses which pieces exist, in what order, and may interleave its
 * own components freely. Nothing here is mandatory — a sidebar that is only a nav is valid.
 *
 *     <Sidebar activeId={activeId} base="/admin">
 *       <Sidebar.MobileHeader onClose={closeDrawer} />
 *       <Sidebar.Nav groups={buildNav(panels)} />
 *       <Sidebar.Footer>
 *         <Sidebar.RailToggle />
 *         <MyLogoutButton onClick={logout} />
 *       </Sidebar.Footer>
 *     </Sidebar>
 *
 * ## The cost, stated plainly
 *
 * Rail-collapse state is read in three places (the root's class, item label clipping, the tooltip
 * portal), so the root publishes it through a context the children read. That makes
 * `<Sidebar.Nav>` outside a `<Sidebar>` a **runtime** error rather than a compile-time one. It
 * throws a named error rather than rendering nothing, so the mistake is loud.
 *
 * A host component that wants to participate in rail tooltips — the log-out button being the
 * obvious case — reads {@link useSidebar} and spreads `railTooltipProps(label)`. That is the seam
 * that keeps "bring your own log-out button" from meaning "lose the tooltip behavior".
 *
 * ## Layout
 *
 * Below the tablet breakpoint the same nav becomes an off-canvas drawer driven by `open`, toggled
 * from the host's mobile top bar. At desktop widths `open` is inert — the nav is always in-flow —
 * so there is one render path for both layouts rather than a mobile-only variant.
 *
 * The desktop rail collapse (`.is-rail`, `useSidebarRail`) is a *different* boolean from `open`, on
 * purpose: a user who collapsed the rail on desktop should not find their phone drawer stuck open,
 * and vice versa. The rail is persisted; the drawer is session-only overlay state the host owns.
 *
 * ## Styling contract
 *
 * Unstyled. Class names (`.cms-nav`, `.cms-item`, `.cms-section`, `.cms-group`, `.cms-foot`,
 * `.cms-tooltip-portal`, …) are emitted for the host stylesheet to define; only runtime-measured
 * portal coordinates are set inline. Every user-visible string is overridable — see each part's
 * label props — so this component does not impose one host's English on another.
 */

/** One rail tooltip's target: the label to show and the viewport point to anchor it at (already
 *  vertically centered / horizontally offset past the hovered element — see `showTooltip`). */
interface TooltipTarget {
  label: string;
  top: number;
  left: number;
}

/** Handlers that make any element participate in rail-mode tooltips. Spread onto a host's own
 *  control: `<button {...railTooltipProps('Log out')}>`. */
export interface RailTooltipHandlers {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

export interface SidebarContextValue {
  /** Whether the desktop rail is collapsed to icons. */
  collapsed: boolean;
  toggleRail: () => void;
  /** Mobile drawer state, owned by the host. */
  open: boolean;
  /** Where the admin is mounted, applied to every item's route path. */
  base: string;
  /** The active panel id, matched against `AdminNavItem.id`. */
  activeId: string;
  /** Tooltip handlers for a host-supplied control. No-ops while the rail is expanded. */
  railTooltipProps: (label: string) => RailTooltipHandlers;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Reads the enclosing `<Sidebar>`'s state. Throws outside one — see the file header on why this
 * check is a runtime error rather than a type error.
 */
export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error(
      'useSidebar (and Sidebar.Nav / Sidebar.Footer / Sidebar.RailToggle / Sidebar.MobileHeader) ' +
        'must be rendered inside a <Sidebar>. The rail-collapse state they read is published by ' +
        'the Sidebar root.',
    );
  }
  return value;
}

function Icon(props: { markup: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      dangerouslySetInnerHTML={{ __html: props.markup }}
    />
  );
}

/**
 * Rail-mode tooltip, portaled to `document.body`.
 *
 * Not a CSS-only `position: absolute` child of the hovered item (the first approach tried here) —
 * `.cms-nav` needs `overflow-y: auto` for its own scrollbar, and the CSS overflow spec computes an
 * omitted or even an explicitly-`visible` `overflow-x` to `auto` the instant the other axis isn't
 * `visible` (verified live: setting `overflow-x: visible` alongside `overflow-y: auto` still read
 * back as `overflow-x: auto` via `getComputedStyle`). That silently clips anything positioned to
 * escape the rail's edge — `opacity`/`visibility` both read correctly in a probe, but nothing
 * painted. A portal sidesteps the ancestor entirely: a DOM sibling of the app root, not a
 * descendant of the clipping element, positioned with `position: fixed` from the hovered element's
 * own `getBoundingClientRect()`.
 */
function RailTooltip(props: { target: TooltipTarget | null }) {
  if (!props.target) return null;
  return createPortal(
    <div
      className="cms-tooltip-portal"
      style={{ top: props.target.top, left: props.target.left }}
      role="presentation"
    >
      {props.target.label}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface SidebarProps {
  /** The active panel's id — matched against `AdminNavItem.id` by `Sidebar.Nav`. */
  activeId: string;
  /** Where the admin is mounted. Defaults to `/core`'s `DEFAULT_ADMIN_BASE`. */
  base?: string;
  /** Mobile drawer state, owned by the host (it also renders the backdrop). Inert at desktop
   *  widths, and deliberately distinct from the desktop rail collapse — see the file header. */
  open?: boolean;
  /** `localStorage` key for the desktop rail preference. A host with a pre-existing key should
   *  supply it rather than strand every operator's saved preference behind this package's
   *  default. */
  railStorageKey?: string;
  /** Accessible name for the `<nav>` landmark. @default "Admin" */
  label?: string;
  /** Extra class names appended to `.cms-nav`. */
  className?: string;
  /** DOM id, for a host's `aria-controls` on its mobile toggle. @default "admin-sidebar" */
  id?: string;
  children?: ReactNode;
}

function SidebarRoot(props: SidebarProps) {
  const rail = useSidebarRail(props.railStorageKey);
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);
  const open = props.open ?? false;
  const base = props.base ?? DEFAULT_ADMIN_BASE;

  // Rail state can change (toggled, or the viewport crossing the breakpoint) while a tooltip is
  // showing; drop it rather than let a stale one float over content that no longer corresponds to
  // a collapsed rail.
  useEffect(() => {
    setTooltip(null);
  }, [rail.collapsed]);

  const value = useMemo<SidebarContextValue>(() => {
    function show(e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, label: string) {
      if (!rail.collapsed) return;
      const r = e.currentTarget.getBoundingClientRect();
      setTooltip({ label, top: r.top + r.height / 2, left: r.right + 10 });
    }
    function hide() {
      setTooltip(null);
    }
    return {
      collapsed: rail.collapsed,
      toggleRail: rail.toggle,
      open,
      base,
      activeId: props.activeId,
      railTooltipProps: (label: string) => ({
        onMouseEnter: (e) => show(e, label),
        onMouseLeave: hide,
        onFocus: (e) => show(e, label),
        onBlur: hide,
      }),
    };
  }, [rail.collapsed, rail.toggle, open, base, props.activeId]);

  const className = [
    'cms-nav scroll',
    open ? 'is-open' : null,
    rail.collapsed ? 'is-rail' : null,
    props.className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <SidebarContext.Provider value={value}>
      <nav className={className} aria-label={props.label ?? 'Admin'} id={props.id ?? 'admin-sidebar'}>
        {props.children}
        <RailTooltip target={tooltip} />
      </nav>
    </SidebarContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export interface SidebarMobileHeaderProps {
  onClose: () => void;
  /** @default "Navigation" */
  title?: ReactNode;
  /** Accessible name for the close control. @default "Close navigation" */
  closeLabel?: string;
}

/**
 * The off-canvas drawer's own header row, hidden by the host stylesheet at desktop widths.
 *
 * Owns the open-transition focus move: when the drawer opens, focus lands on this close control
 * rather than staying on the topbar toggle behind it, so a keyboard or screen-reader user is
 * actually inside the drawer they just opened.
 */
function SidebarMobileHeader(props: SidebarMobileHeaderProps) {
  const { open } = useSidebar();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  return (
    <div className="cms-nav-mobile-head">
      <span>{props.title ?? 'Navigation'}</span>
      <button
        ref={closeButtonRef}
        type="button"
        className="cms-nav-close"
        onClick={props.onClose}
        aria-label={props.closeLabel ?? 'Close navigation'}
      >
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M5 5 13 13M13 5 5 13" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export interface SidebarNavProps {
  /** From `/core`'s `buildNav(resolvePanels(panels, context))`. */
  groups: readonly AdminNavGroup[];
  /** Label on a `soon` item's badge. @default "Soon" */
  soonLabel?: ReactNode;
  /** Replaces the default row rendering entirely. `active` is precomputed from the root's
   *  `activeId`; `href` already has the base applied. Use for a host that needs a framework
   *  `<Link>` instead of an `<a>`. */
  renderItem?: (item: AdminNavItem, ctx: { active: boolean; href: string; collapsed: boolean }) => ReactNode;
}

function SidebarNav(props: SidebarNavProps) {
  const { activeId, base, collapsed, railTooltipProps } = useSidebar();

  return (
    <>
      {props.groups.map((group, gi) => (
        <div className="cms-section" key={group.label ?? `top-${gi}`}>
          {/* Expected to become a plain divider rule in rail mode rather than vanishing — two
              dozen items across five groups with zero separation once the labels are gone is a
              scanning problem of its own. The label text stays in the DOM either way. */}
          {group.label ? <div className="cms-group">{group.label}</div> : null}
          {group.items.map((item) => {
            const active = item.id === activeId;
            const href = adminHref(item.href, base);
            if (props.renderItem) {
              return <Fragment key={item.id}>{props.renderItem(item, { active, href, collapsed })}</Fragment>;
            }
            if (item.soon) {
              return (
                <div className="cms-item is-soon" aria-disabled="true" key={item.id}>
                  <Icon markup={item.icon ?? ''} />
                  <span>{item.label}</span>
                  {/* Expected to be hidden outright in rail mode rather than shrunk — there is
                      nowhere for a badge to sit beside a centered icon, and `is-soon`'s own faint
                      color is what keeps the item reading as disabled once the badge is gone. */}
                  <span className="soon">{props.soonLabel ?? 'Soon'}</span>
                </div>
              );
            }
            return (
              <a
                key={item.id}
                className={`cms-item${active ? ' active' : ''}`}
                // `AdminNavItem.href` is a route path; the base is applied here so the panel
                // manifest never has to know it. A real URL, so cmd-click and "copy link address"
                // behave normally.
                href={href}
                aria-current={active ? 'page' : undefined}
                {...railTooltipProps(item.label)}
              >
                <Icon markup={item.icon ?? ''} />
                {/* The real accessible name — kept in the DOM and merely clipped visually in rail
                    mode, not removed, so the rail stays a set of named links rather than a column
                    of unlabelled icons. The portaled tooltip is a *sighted-only* supplement to
                    this, never a replacement — a screen reader sees this label, not the portal. */}
                <span>{item.label}</span>
              </a>
            );
          })}
        </div>
      ))}
    </>
  );
}

export interface SidebarFooterProps {
  children?: ReactNode;
  className?: string;
}

/** The bottom region. Carries no content of its own — the host decides what belongs there. */
function SidebarFooter(props: SidebarFooterProps) {
  return <div className={['cms-foot', props.className].filter(Boolean).join(' ')}>{props.children}</div>;
}

export interface SidebarRailToggleProps {
  /** @default "Expand sidebar" */
  expandLabel?: string;
  /** @default "Collapse sidebar" */
  collapseLabel?: string;
}

/**
 * Desktop rail collapse control. A real accessible name plus `aria-expanded` — not a bare icon
 * button. Typically hidden by the host stylesheet inside the mobile drawer, which has its own close
 * control and no rail concept.
 */
function SidebarRailToggle(props: SidebarRailToggleProps) {
  const { collapsed, toggleRail } = useSidebar();
  const label = collapsed ? (props.expandLabel ?? 'Expand sidebar') : (props.collapseLabel ?? 'Collapse sidebar');

  return (
    <div className="cms-rail-toggle-row">
      <button
        type="button"
        className="cms-rail-toggle"
        onClick={toggleRail}
        aria-expanded={!collapsed}
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          {/* Two chevrons back-to-back (a "collapse/expand panel" glyph), flipped via CSS rotation
              on `.is-rail` rather than swapped markup — one icon, two states. */}
          <path d="M6.5 4.5 3.5 9l3 4.5M11.5 4.5 14.5 9l-3 4.5" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Grouped admin sidebar. See the file header for why this is a compound component and what the
 * context costs.
 */
export const Sidebar = Object.assign(SidebarRoot, {
  MobileHeader: SidebarMobileHeader,
  Nav: SidebarNav,
  Footer: SidebarFooter,
  RailToggle: SidebarRailToggle,
});
