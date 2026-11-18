import { useShellDrawer, useShellRoute } from './AdminShell.hooks.js';
import type { AdminShellContext, AdminShellHostProps, AdminShellProps, AdminShellSessionController } from './types.js';
import { useAdminShellSession } from './use-admin-shell-session.js';
import { useAdminTheme } from './use-admin-theme.js';

/** The four hooks `AdminShell` calls, each resolved to the host's fake or the real one. */
export interface ShellHooks {
  readonly useSession: (context: AdminShellContext) => AdminShellSessionController;
  readonly useTheme: typeof useAdminTheme;
  readonly useRoute: typeof useShellRoute;
  readonly useDrawer: typeof useShellDrawer;
}

/**
 * Pick the hook to call for each concern. Pure: it returns hook functions and calls none, so
 * `AdminShell` still calls every hook unconditionally and in the same order on each render.
 * @param args Required shell props, from either session source.
 * @param _options Reserved; none today.
 * @returns The session, theme, route and drawer hooks, defaulted to the real ones.
 */
export function resolveShellHooks(
  { props }: { readonly props: AdminShellProps | AdminShellHostProps },
  _options: Record<string, never> = {},
): ShellHooks {
  const { useThemeHook = useAdminTheme, useRouteHook = useShellRoute, useDrawerHook = useShellDrawer } = props;
  return { useSession: resolveSessionHook(props), useTheme: useThemeHook, useRoute: useRouteHook, useDrawer: useDrawerHook };
}

/** A host-owned session hook when given; otherwise the port-reading hook bound to the port. */
function resolveSessionHook(props: AdminShellProps | AdminShellHostProps): ShellHooks['useSession'] {
  if (props.useHostSession) return props.useHostSession;
  const { session, useSessionHook = useAdminShellSession } = props;
  return (context) => useSessionHook({ port: session, context });
}
