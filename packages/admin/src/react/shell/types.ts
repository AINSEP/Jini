import type { ReactNode, Ref } from 'react';
import type { AdminTheme, ColorSchemePreference } from '../kit.js';
import type { AdminShellAppearance, AdminThemeEnvironment, AdminThemePreferenceStorePort } from './theme-ports.js';
import type { AdminPanel } from '../../core/manifest/types.js';
import type { AdminNavGroup } from '../../core/manifest/rules.js';
import type { AdminRoute } from '../../core/routing/types.js';
import type { AdminShellContext, AdminShellNavigationPort, AdminShellSession, AdminShellSessionPort } from '../../core/ports/shell.js';
import type { useShellDrawer, useShellRoute } from './AdminShell.hooks.js';
import type { useAdminShellSession } from './use-admin-shell-session.js';
import type { useAdminTheme } from './use-admin-theme.js';
export type { AdminShellContext, AdminShellNavigationPort, AdminShellSession, AdminShellSessionPort } from '../../core/ports/shell.js';

export interface AdminShellRenderArgs {
  readonly context: AdminShellContext;
  readonly session: AdminShellSession;
  readonly route: AdminRoute;
}

/** A feature contribution uses the existing manifest, with a React renderer taking one object. */
export type AdminShellPanel = AdminPanel<(args: AdminShellRenderArgs) => ReactNode>;

export type AdminShellSessionState =
  | { readonly status: 'checking' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'authenticated'; readonly session: AdminShellSession }
  | { readonly status: 'error'; readonly error: unknown };

export interface AdminShellSessionController {
  readonly state: AdminShellSessionState;
  /** Re-read after the host's login UI finishes; also refreshes effective permissions. */
  readonly refresh: () => Promise<void>;
  readonly logout: () => Promise<void>;
}

export interface AdminShellSlotArgs extends AdminShellRenderArgs {
  readonly appearance?: AdminShellAppearance;
  readonly logout: () => Promise<void>;
  readonly refreshSession: () => Promise<void>;
}

/** Exactly what the built-in sidebar hands to `<Sidebar>`; a host's own arrangement spreads it. */
export interface AdminShellSidebarProps {
  readonly activeId: string;
  readonly base: string;
  readonly open: boolean;
  readonly id: string;
  readonly label: string;
  readonly railStorageKey: string;
  readonly railDefaultCollapsed: boolean;
}

/** Arguments of `slots.sidebar`: the slot args plus what a host needs to compose its own sidebar. */
export interface AdminShellSidebarArgs extends AdminShellSlotArgs {
  /** The visible groups, after `translateNav`. */
  readonly nav: readonly AdminNavGroup[];
  readonly sidebarProps: AdminShellSidebarProps;
  /** The shell's one drawer state: the topbar toggle and the backdrop use the same one. */
  readonly setDrawerOpen: (open: boolean) => void;
}

export interface AdminShellSlots {
  readonly login: (args: { readonly context: AdminShellContext; readonly refreshSession: () => Promise<void> }) => ReactNode;
  readonly sessionError?: (args: { readonly error: unknown; readonly retry: () => Promise<void> }) => ReactNode;
  /**
   * Replaces the built-in `<Sidebar>` arrangement (header slot, one nav, rail toggle and footer).
   * Render `<Sidebar {...sidebarProps}>` with your own children: `Sidebar` is a compound component
   * built for that. Rail override stays a `Sidebar` prop you pass (`railOverride`, `onRailCollapsedChange`).
   * Absent: the built-in sidebar, with exactly the markup it always had. `sidebarHeader` and
   * `sidebarFooter` belong to the built-in arrangement and are not rendered when this is present.
   */
  readonly sidebar?: (args: AdminShellSidebarArgs) => ReactNode;
  readonly sidebarHeader?: ReactNode;
  readonly sidebarFooter?: (args: AdminShellSlotArgs) => ReactNode;
  readonly topbar?: ReactNode;
  readonly overlays?: (args: AdminShellSlotArgs) => ReactNode;
  /**
   * Wraps the whole authenticated layout (root element, sidebar, main column, assistant and overlays
   * all inside `children`): the place for providers the panels, the dock and the overlays must share.
   * Not called for the checking, anonymous and error states. Re-key your provider on `session.user.id`
   * to remount it when the operator changes.
   */
  readonly frame?: (args: AdminShellSlotArgs & { readonly children: ReactNode }) => ReactNode;
  /** Rendered between the sidebar and the drawer backdrop (a host confirm dialog, for example). */
  readonly beforeMain?: ReactNode;
  /** Rendered inside the main column, right after `<main>` (a host's floating controls, for example). */
  readonly afterMain?: ReactNode;
  /** Rendered **instead of** the built-in assistant `<aside>`, which then is not rendered even if `assistant` is set. */
  readonly assistantAside?: ReactNode;
  /**
   * Rendered in `<main>` instead of the routed panel when the operator may not use it (`model.access`
   * is `'denied'`). The URL, route and agent page id stay the denied panel's own. Absent: an empty
   * `<main>`. Client-side visibility only; the server stays the authority.
   */
  readonly noAccess?: (args: AdminShellSlotArgs) => ReactNode;
  /** Always mounted while authenticated; hidden when closed. The host owns pane controls. */
  readonly assistant?: { readonly content: ReactNode; readonly label: string; readonly open: boolean };
}

/** Required host copy, so branding and language never fall back to another product's values. */
export interface AdminShellLabels {
  readonly navigation: string;
  readonly openNavigation: string;
  readonly closeNavigation: string;
  readonly skipToContent: string;
  readonly loading: string;
  readonly sessionError: string;
  readonly retry: string;
  readonly expandSidebar: string;
  readonly collapseSidebar: string;
  readonly soon: string;
}

/**
 * Everything an admin shell takes except where its session comes from; see {@link AdminShellProps}
 * and {@link AdminShellHostProps} for the two session sources.
 */
export interface AdminShellBaseProps extends AdminShellContext {
  /**
   * The theme hook, defaulted to the real `useAdminTheme`. Pass a fake in tests, or, for a host that
   * owns its theme controller (themes, the settings that store them and the root attributes), a hook
   * that returns `undefined`: the shell then paints nothing on `themeEnvironment.target` and hands no
   * `appearance` to the slots. The hook still receives `{ userId, workspace }` and the theme options.
   */
  readonly useThemeHook?: typeof useAdminTheme;
  /** The route-snapshot hook, defaulted to the shell's own `useShellRoute` (reads `navigation`). */
  readonly useRouteHook?: typeof useShellRoute;
  /** The mobile drawer state hook, defaulted to the shell's own `useShellDrawer`. */
  readonly useDrawerHook?: typeof useShellDrawer;
  readonly theme?: AdminTheme;
  /** Controlled when supplied; otherwise the injected store restores the user's choice. */
  readonly colorScheme?: ColorSchemePreference;
  readonly themeEnvironment?: AdminThemeEnvironment;
  readonly themePreferenceStore?: AdminThemePreferenceStorePort;
  readonly onColorSchemeChange?: (args: { readonly preference: ColorSchemePreference }) => void;
  readonly adminBase: string;
  /** DOM ids of the sidebar `<nav>` and the `<main>`; each defaults to a generated one. The skip link, the topbar toggle's `aria-controls`, the nav and main all read from them. */
  readonly ids?: { readonly sidebar?: string; readonly main?: string };
  readonly defaultPanelId: string;
  readonly railStorageKey: string;
  readonly title: ReactNode;
  readonly navigation: AdminShellNavigationPort;
  readonly panels: readonly AdminShellPanel[];
  readonly slots: AdminShellSlots;
  readonly labels: AdminShellLabels;
  readonly capabilities?: readonly string[];
  readonly railDefaultCollapsed?: boolean;
  readonly collapsibleGroups?: readonly string[];
  /**
   * Localizes or relabels the nav. The shell memoizes its result on this function's identity, so a host
   * must pass a **stable** function (wrap one that closes over locale in `useCallback`): a new function
   * on every render rebuilds the nav on every render.
   */
  readonly translateNav?: (args: { readonly groups: readonly AdminNavGroup[] }) => readonly AdminNavGroup[];
  /** Optional page-driver/measurement seam; the host owns any agent or screenshot integration. */
  readonly mainRef?: Ref<HTMLElement>;
  readonly className?: string;
}

/** The shell reads the session through a port (today's source). Pass `session`, never `useHostSession`. */
export interface AdminShellProps extends AdminShellBaseProps {
  readonly session: AdminShellSessionPort;
  /** The session hook, defaulted to the real `useAdminShellSession`. */
  readonly useSessionHook?: typeof useAdminShellSession;
  readonly useHostSession?: undefined;
}

/**
 * The host owns the session machine (boot token, epoch guard, permission refresh) and reads it itself
 * above the shell, so the shell must not read a second copy through a port. There is no real hook to
 * default to without a port, hence no default: pass this hook and no `session`. Fixed for the life of
 * the component, like any hook.
 */
export interface AdminShellHostProps extends AdminShellBaseProps {
  readonly session?: undefined;
  readonly useSessionHook?: undefined;
  readonly useHostSession: () => AdminShellSessionController;
}

/** Exactly one session source, enforced by the type. */
export type AdminShellSessionSource =
  | Pick<AdminShellProps, 'session' | 'useSessionHook' | 'useHostSession'>
  | Pick<AdminShellHostProps, 'session' | 'useSessionHook' | 'useHostSession'>;
