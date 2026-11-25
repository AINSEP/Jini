import { useId, useMemo, type ReactNode } from 'react';
import { Sidebar } from '../components/Sidebar.js';
import { resolveAdminShellModel, type AdminShellModel } from './model.js';
import type { useShellDrawer } from './AdminShell.hooks.js';
import { resolveShellHooks, resolveShellIds } from './shell-hooks.js';
import type { useAdminTheme } from './use-admin-theme.js';
import type { AdminShellAppearance } from './theme-ports.js';
import type { AdminNavGroup } from '../../core/manifest/rules.js';
import type {
  AdminShellBaseProps, AdminShellContext, AdminShellHostProps, AdminShellProps, AdminShellSession, AdminShellSessionController, AdminShellSessionState, AdminShellSidebarProps, AdminShellSlotArgs,
} from './types.js';

type ThemeOptions = NonNullable<Parameters<typeof useAdminTheme>[1]>;
type GateState = Exclude<AdminShellSessionState, { readonly status: 'authenticated' }>;

/** Copy only the theme props the host supplied, so absent ones keep the hook's own defaults. */
function themeOptions(props: AdminShellBaseProps): ThemeOptions {
  return {
    ...(props.theme ? { theme: props.theme } : {}),
    ...(props.colorScheme ? { colorScheme: props.colorScheme } : {}),
    ...(props.themeEnvironment ? { environment: props.themeEnvironment } : {}),
    ...(props.themePreferenceStore ? { preferenceStore: props.themePreferenceStore } : {}),
    ...(props.onColorSchemeChange ? { onColorSchemeChange: props.onColorSchemeChange } : {}),
  };
}

/**
 * Loading, login or session-error UI for every state except an authenticated one.
 * The loading state carries `jini-admin-boot-screen` and the legacy `boot-screen` alias: Jini ships no rule for either name, but consuming admin hosts style the legacy `.boot-screen` selector,
 * so the alias is a host contract to keep until every host selects the prefixed class.
 */
function renderSessionGate({ props, context, state, refresh }: {
  readonly props: AdminShellBaseProps; readonly context: AdminShellContext; readonly state: GateState; readonly refresh: () => Promise<void>;
}): ReactNode {
  if (state.status === 'checking') return <div className="jini-admin-boot-screen boot-screen" role="status">{props.labels.loading}</div>;
  if (state.status === 'anonymous') return props.slots.login({ context, refreshSession: refresh });
  if (props.slots.sessionError) return props.slots.sessionError({ error: state.error, retry: refresh });
  return <div role="alert"><p>{props.labels.sessionError}</p><button type="button" onClick={() => { void refresh(); }}>{props.labels.retry}</button></div>;
}

/** The routed panel, or the host's `noAccess` slot (an empty `<main>` without one) when access is denied. */
function renderRoutedPanel({ model, slots, slotArgs }: {
  readonly model: AdminShellModel; readonly slots: AdminShellBaseProps['slots']; readonly slotArgs: AdminShellSlotArgs;
}): ReactNode {
  if (model.access === 'denied') return slots.noAccess?.(slotArgs) ?? null;
  return model.panel?.render(slotArgs);
}

interface ShellView { readonly model: AdminShellModel; readonly slotArgs: AdminShellSlotArgs; readonly nav: readonly AdminNavGroup[] }

/** The manifest-driven sidebar: header slot, nav groups, rail toggle and footer slot. */
function ShellSidebar({ props, view, sidebarProps }: {
  readonly props: AdminShellBaseProps; readonly view: ShellView; readonly sidebarProps: AdminShellSidebarProps;
}): ReactNode {
  return (
    <Sidebar {...sidebarProps}>
      {props.slots.sidebarHeader}
      <Sidebar.Nav groups={view.nav} soonLabel={props.labels.soon} collapsibleGroups={props.collapsibleGroups ?? []} />
      <Sidebar.Footer>
        <Sidebar.RailToggle expandLabel={props.labels.expandSidebar} collapseLabel={props.labels.collapseSidebar} />
        {props.slots.sidebarFooter?.(view.slotArgs)}
      </Sidebar.Footer>
    </Sidebar>
  );
}

/** The host's `slots.sidebar` composition when given, otherwise the built-in {@link ShellSidebar}. */
function renderShellSidebar({ props, view, drawer, id }: {
  readonly props: AdminShellBaseProps; readonly view: ShellView; readonly drawer: ReturnType<typeof useShellDrawer>; readonly id: string;
}): ReactNode {
  const sidebarProps: AdminShellSidebarProps = {
    activeId: view.model.route.panelId, base: props.adminBase, open: drawer.open, id, label: props.labels.navigation,
    railStorageKey: props.railStorageKey, railDefaultCollapsed: props.railDefaultCollapsed ?? false,
  };
  if (!props.slots.sidebar) return <ShellSidebar props={props} view={view} sidebarProps={sidebarProps} />;
  return props.slots.sidebar({ ...view.slotArgs, nav: view.nav, sidebarProps, setDrawerOpen: drawer.setOpen });
}

interface ShellLayoutArgs {
  readonly props: AdminShellBaseProps; readonly context: AdminShellContext; readonly controller: AdminShellSessionController;
  readonly session: AdminShellSession; readonly appearance: AdminShellAppearance | undefined; readonly routePath: string;
  readonly drawer: ReturnType<typeof useShellDrawer>; readonly ids: { readonly sidebar: string; readonly main: string };
}

/**
 * The topbar, `<main>` with the routed panel (or `noAccess`) and the host's `afterMain` content.
 * Each topbar element carries its `jini-admin-topbar*` class and the legacy `admin-topbar*` alias: Jini
 * ships no rule for either name, but consuming admin hosts style the legacy `.admin-topbar*` selectors, so
 * the alias is a host contract to keep until every host selects the prefixed classes. The column
 * (`jini-admin-main-col`) and `<main>` (`jini-admin-content`) follow the same pairing: Jini's packaged CSS
 * styles the content region through either name, and consuming hosts still select the legacy `.admin-main-col`
 * and `.admin-content` (layout, scroll, container-query ancestor), so both aliases stay.
 */
function ShellMainColumn({ props, view, drawer, ids }: {
  readonly props: AdminShellBaseProps; readonly view: ShellView; readonly drawer: ReturnType<typeof useShellDrawer>;
  readonly ids: ShellLayoutArgs['ids'];
}): ReactNode {
  const { model, slotArgs } = view;
  return (
    <div className="jini-admin-main-col admin-main-col">
      <div className="jini-admin-topbar admin-topbar">
        <button type="button" className="jini-admin-topbar-toggle admin-topbar-toggle" aria-expanded={drawer.open} aria-controls={ids.sidebar}
          aria-label={drawer.open ? props.labels.closeNavigation : props.labels.openNavigation}
          onClick={() => drawer.setOpen((open) => !open)}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" strokeLinecap="round" /></svg>
        </button>
        <span className="jini-admin-topbar-title admin-topbar-title">{props.title}</span>
        {props.slots.topbar}
      </div>
      <main ref={props.mainRef} id={ids.main} className="jini-admin-content admin-content" tabIndex={-1} data-agent-page={model.agentPageId ?? undefined}>
        {renderRoutedPanel({ model, slots: props.slots, slotArgs })}
      </main>
      {props.slots.afterMain}
    </div>
  );
}

/** The host's `assistantAside` when given, otherwise the built-in pane for `slots.assistant`. */
function renderAssistant(slots: AdminShellBaseProps['slots']): ReactNode {
  const { assistant, assistantAside } = slots;
  if (assistantAside) return assistantAside;
  return assistant && <aside className="jini-admin-assistant-pane" aria-label={assistant.label} hidden={!assistant.open}>{assistant.content}</aside>;
}

/**
 * Resolve the authenticated route, nav and slot arguments from the session's contributions, then lay out
 * the sidebar, main column, assistant and overlays. It is its own component so the model and the translated nav are memoized on
 * what they derive from (panels, capabilities, the session's permissions, route, `translateNav`):
 * a drawer toggle or a theme repaint re-renders the shell without rebuilding either.
 * The root, skip link and drawer backdrop carry `jini-admin-layout`, `jini-admin-skip-link` and
 * `jini-admin-sidebar-backdrop` plus the legacy `admin-layout`, `skip-link` and `sidebar-backdrop`: Jini's packaged
 * CSS still styles `.admin-layout` for hosts that render their own chrome, and consuming hosts select all three
 * legacy names, so each alias is a host contract until every host selects the prefixed classes.
 */
function ShellLayout({ args }: { readonly args: ShellLayoutArgs }): ReactNode {
  const { props, context, controller, session, appearance, routePath, drawer, ids } = args;
  const { panels, capabilities, defaultPanelId, translateNav } = props;
  const model = useMemo(() => resolveAdminShellModel({ panels, session, routePath, defaultPanelId }, capabilities ? { capabilities } : {}),
    [panels, capabilities, session, routePath, defaultPanelId]);
  const nav = useMemo(() => (translateNav ? translateNav({ groups: model.nav }) : model.nav), [translateNav, model]);
  const slotArgs: AdminShellSlotArgs = {
    context, session, route: model.route, logout: controller.logout, refreshSession: controller.refresh,
    ...(appearance ? { appearance } : {}),
  };
  const view: ShellView = { model, slotArgs, nav };
  const layout = (
    <div className={['jini-admin-layout admin-layout', props.className].filter(Boolean).join(' ')}>
      <a href={`#${ids.main}`} className="jini-admin-skip-link skip-link">{props.labels.skipToContent}</a>
      {renderShellSidebar({ props, view, drawer, id: ids.sidebar })}
      {props.slots.beforeMain}
      {drawer.open && <button type="button" className="jini-admin-sidebar-backdrop sidebar-backdrop" aria-label={props.labels.closeNavigation} onClick={() => drawer.setOpen(false)} />}
      <ShellMainColumn props={props} view={view} drawer={drawer} ids={ids} />
      {renderAssistant(props.slots)}
      {props.slots.overlays?.(slotArgs)}
    </div>
  );
  return props.slots.frame ? props.slots.frame({ ...slotArgs, children: layout }) : layout;
}

/**
 * A host-composed admin layout with manifest navigation and a session gate.
 * @param props Required host scope, ports, contributions, labels and slots; optional layout settings.
 * @returns Loading/login/error UI or the authenticated sidebar, feature screen and pane slots.
 */
export function AdminShell(props: AdminShellProps | AdminShellHostProps): ReactNode {
  const context = useMemo(() => ({ apiBase: props.apiBase, workspace: props.workspace }), [props.apiBase, props.workspace]);
  const hooks = resolveShellHooks({ props });
  const controller = hooks.useSession(context);
  const { state } = controller;
  const appearance = hooks.useTheme({ userId: state.status === 'authenticated' ? state.session.user.id : null, workspace: context.workspace },
    themeOptions(props));
  const routePath = hooks.useRoute({ navigation: props.navigation, base: props.adminBase });
  const drawer = hooks.useDrawer({ routePath });
  const id = useId();

  if (state.status !== 'authenticated') return renderSessionGate({ props, context, state, refresh: controller.refresh });
  return <ShellLayout args={{ props, context, controller, session: state.session, appearance, routePath, drawer, ids: resolveShellIds({ ids: props.ids, baseId: id }) }} />;
}
