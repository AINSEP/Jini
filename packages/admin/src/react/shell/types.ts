import type { ReactNode, Ref } from 'react';
import type { AdminTheme, ColorSchemePreference } from '@jini-ai/ui/theme';
import type { AdminShellAppearance, AdminThemeEnvironment, AdminThemePreferenceStorePort } from './theme-ports.js';
import type { AdminPanel } from '../../core/manifest/types.js';
import type { AdminNavGroup } from '../../core/manifest/rules.js';
import type { AdminRoute } from '../../core/routing/types.js';
import type { AdminShellContext, AdminShellNavigationPort, AdminShellSession, AdminShellSessionPort } from '../../core/ports/shell.js';
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

export interface AdminShellProps extends AdminShellContext {
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
  readonly session: AdminShellSessionPort;
  readonly navigation: AdminShellNavigationPort;
  readonly panels: readonly AdminShellPanel[];
  readonly slots: AdminShellSlots;
  readonly labels: AdminShellLabels;
  readonly capabilities?: readonly string[];
  readonly railDefaultCollapsed?: boolean;
  readonly collapsibleGroups?: readonly string[];
  readonly translateNav?: (args: { readonly groups: readonly AdminNavGroup[] }) => readonly AdminNavGroup[];
  /** Optional page-driver/measurement seam; the host owns any agent or screenshot integration. */
  readonly mainRef?: Ref<HTMLElement>;
  readonly className?: string;
}
