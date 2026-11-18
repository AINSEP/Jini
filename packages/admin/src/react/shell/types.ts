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

export interface AdminShellSlots {
  readonly login: (args: { readonly context: AdminShellContext; readonly refreshSession: () => Promise<void> }) => ReactNode;
  readonly sessionError?: (args: { readonly error: unknown; readonly retry: () => Promise<void> }) => ReactNode;
  readonly sidebarHeader?: ReactNode;
  readonly sidebarFooter?: (args: AdminShellSlotArgs) => ReactNode;
  readonly topbar?: ReactNode;
  readonly overlays?: (args: AdminShellSlotArgs) => ReactNode;
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
  /** The theme hook, defaulted to the real `useAdminTheme`. Pass a fake in tests; see J3 for a host that paints itself. */
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
