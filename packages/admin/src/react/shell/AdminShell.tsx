import { useId, useMemo, type ReactNode } from 'react';
import { Sidebar } from '../components/Sidebar.js';
import { resolveAdminShellModel, type AdminShellModel } from './model.js';
import { resolveShellHooks } from './shell-hooks.js';
import type { useAdminTheme } from './use-admin-theme.js';
import type { AdminShellAppearance } from './theme-ports.js';
import type { AdminNavGroup } from '../../core/manifest/rules.js';
import type {
  AdminShellBaseProps, AdminShellContext, AdminShellHostProps, AdminShellProps, AdminShellSession, AdminShellSessionController, AdminShellSessionState, AdminShellSlotArgs,
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

/** Loading, login or session-error UI for every state except an authenticated one. */
function renderSessionGate({ props, context, state, refresh }: {
  readonly props: AdminShellBaseProps; readonly context: AdminShellContext; readonly state: GateState; readonly refresh: () => Promise<void>;
}): ReactNode {
  if (state.status === 'checking') return <div className="boot-screen" role="status">{props.labels.loading}</div>;
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

/** Resolve the authenticated route, nav and slot arguments from the session's contributions. */
function resolveShellView({ props, context, session, routePath, controller }: {
  readonly props: AdminShellBaseProps; readonly context: AdminShellContext; readonly session: AdminShellSession;
  readonly routePath: string; readonly controller: AdminShellSessionController;
}, { appearance }: { readonly appearance?: AdminShellAppearance | undefined }): ShellView {
  const model = resolveAdminShellModel({ panels: props.panels, session, routePath, defaultPanelId: props.defaultPanelId },
    { capabilities: props.capabilities ?? [] });
  const slotArgs: AdminShellSlotArgs = {
    context, session, route: model.route, logout: controller.logout, refreshSession: controller.refresh,
    ...(appearance ? { appearance } : {}),
  };
  const nav = props.translateNav ? props.translateNav({ groups: model.nav }) : model.nav;
  return { model, slotArgs, nav };
}

/** The manifest-driven sidebar: header slot, nav groups, rail toggle and footer slot. */
function ShellSidebar({ props, view, open, id }: {
  readonly props: AdminShellBaseProps; readonly view: ShellView; readonly open: boolean; readonly id: string;
}): ReactNode {
  return (
    <Sidebar activeId={view.model.route.panelId} base={props.adminBase} open={open} id={id}
      label={props.labels.navigation} railStorageKey={props.railStorageKey} railDefaultCollapsed={props.railDefaultCollapsed ?? false}>
      {props.slots.sidebarHeader}
      <Sidebar.Nav groups={view.nav} soonLabel={props.labels.soon} collapsibleGroups={props.collapsibleGroups ?? []} />
      <Sidebar.Footer>
        <Sidebar.RailToggle expandLabel={props.labels.expandSidebar} collapseLabel={props.labels.collapseSidebar} />
        {props.slots.sidebarFooter?.(view.slotArgs)}
      </Sidebar.Footer>
    </Sidebar>
  );
}

/**
 * A host-composed admin layout with manifest navigation and a session gate.
 * @param props Required host scope, ports, contributions, labels and slots; optional layout settings.
 * @returns Loading/login/error UI or the authenticated sidebar, feature screen and pane slots.
 */
export function AdminShell(props: AdminShellProps | AdminShellHostProps): ReactNode {
  const context = useMemo(() => ({ apiBase: props.apiBase, workspace: props.workspace }), [props.apiBase, props.workspace]);
  const hooks = resolveShellHooks({ props });
  const session = hooks.useSession(context);
  const appearance = hooks.useTheme({ userId: session.state.status === 'authenticated' ? session.state.session.user.id : null, workspace: context.workspace },
    themeOptions(props));
  const routePath = hooks.useRoute({ navigation: props.navigation, base: props.adminBase });
  const drawer = hooks.useDrawer({ routePath });
  const id = useId();
  const sidebarId = `${id}-sidebar`;
  const mainId = `${id}-main`;

  if (session.state.status !== 'authenticated') return renderSessionGate({ props, context, state: session.state, refresh: session.refresh });

  const view = resolveShellView({ props, context, session: session.state.session, routePath, controller: session }, { appearance });
  const { model, slotArgs } = view;
  const assistant = props.slots.assistant;

  return (
    <div className={['admin-layout', props.className].filter(Boolean).join(' ')}>
      <a href={`#${mainId}`} className="skip-link">{props.labels.skipToContent}</a>
      <ShellSidebar props={props} view={view} open={drawer.open} id={sidebarId} />
      {drawer.open && <button type="button" className="sidebar-backdrop" aria-label={props.labels.closeNavigation} onClick={() => drawer.setOpen(false)} />}
      <div className="admin-main-col">
        <div className="admin-topbar">
          <button type="button" className="admin-topbar-toggle" aria-expanded={drawer.open} aria-controls={sidebarId}
            aria-label={drawer.open ? props.labels.closeNavigation : props.labels.openNavigation}
            onClick={() => drawer.setOpen((open) => !open)}>
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" /></svg>
          </button>
          <span className="admin-topbar-title">{props.title}</span>
          {props.slots.topbar}
        </div>
        <main ref={props.mainRef} id={mainId} className="admin-content" tabIndex={-1} data-agent-page={model.agentPageId ?? undefined}>
          {renderRoutedPanel({ model, slots: props.slots, slotArgs })}
        </main>
      </div>
      {assistant && <aside className="admin-assistant-pane" aria-label={assistant.label} hidden={!assistant.open}>{assistant.content}</aside>}
      {props.slots.overlays?.(slotArgs)}
    </div>
  );
}
