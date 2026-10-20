/**
 * `<PreviewModalShell>` — full-screen overlay chrome around arbitrary
 * preview content: title/subtitle header, an optional tab bar for multiple
 * views, an optional companion sidebar, a fullscreen toggle, an optional
 * split-button primary action, and a content stage that renders whichever
 * of custom / unavailable / error / loading / HTML state the active view is
 * in. All state/effects live in `usePreviewModalShell`; this component is
 * the presentational shell.
 *
 * Origin: `apps/web/src/components/PreviewModal.tsx`. The merged Share/
 * Export popover is NOT ported here — see `../../../source-map.md`'s
 * `preview-modal-shell` classification section for why.
 */
import type { ReactElement, ReactNode } from 'react';
import { SrcDocSandbox } from '../../../react/components/SrcDocSandbox.js';
import type { BuildSrcDocOptions } from '../../../srcdoc/build.js';
import { useT } from '../../../react/i18n.js';
import { deriveContentStatus } from '../../rules.js';
import type { PreviewModalPrimaryAction, PreviewModalUnavailable } from '../../types.js';
import { usePreviewModalShell, type PreviewModalShellController } from '../hooks/usePreviewModalShell.js';
import { DEFAULT_PREVIEW_MODAL_ICONS, type PreviewModalIconName } from './icons.js';

export interface PreviewModalView {
  id: string;
  label: string;
  /** `null` means "still loading", `undefined` means "not yet requested" — both keep the stage blank until the host reacts to `onView`. */
  html?: string | null | undefined;
  /** When set, the stage shows an error state with a Retry button that re-fires `onView` for this view id. */
  error?: string | null | undefined;
  /** Set when this view genuinely has no preview to render. The shell shows `unavailable.message` instead of the loading/error states. Mutually exclusive with `html`/`error`. */
  unavailable?: PreviewModalUnavailable | null | undefined;
  /** Render an arbitrary node in the stage instead of the built-in HTML sandbox — e.g. an image/video/audio player. The shell still owns chrome (header/tabs/sidebar/fullscreen/close) around it. */
  custom?: ReactNode;
}

export interface PreviewModalSidebar {
  label: string;
  /** Side-pane content — the host renders whatever it likes. When absent, the toggle is not shown. */
  content: ReactNode;
  defaultOpen?: boolean | undefined;
  onToggle?: ((open: boolean) => void) | undefined;
  /** Stable identity for the side-panel source; changing it while open re-fires `onToggle` so the host can prime a fresh fetch. */
  contentKey?: string | number | undefined;
}

export interface PreviewModalShellProps {
  title: string;
  subtitle?: string | undefined;
  views: PreviewModalView[];
  initialViewId?: string | undefined;
  onView?: ((viewId: string) => void) | undefined;
  onClose: () => void;
  sidebar?: PreviewModalSidebar | undefined;
  /** Logical viewport width the HTML content renders at before being scaled to fit the stage. Defaults to 1280. */
  designWidth?: number | undefined;
  primaryAction?: PreviewModalPrimaryAction | undefined;
  /** Extra controls rendered after the sidebar toggle and before Close. */
  headerExtras?: ReactNode;
  /** Hide the header sidebar-toggle button while keeping the stage-edge expand handle. */
  hideSidebarToggle?: boolean | undefined;
  onFullscreenClick?: (() => void) | undefined;
  onSidebarToggleClick?: ((open: boolean) => void) | undefined;
  /** Options forwarded to the built-in HTML renderer (`SrcDocSandbox`/`buildSrcDoc`) for `ready` views. */
  srcDocOptions?: BuildSrcDocOptions | undefined;
  icons?: Partial<Record<PreviewModalIconName, () => ReactElement>> | undefined;
  className?: string | undefined;
}

export function PreviewModalShell({
  title,
  subtitle,
  views,
  initialViewId,
  onView,
  onClose,
  sidebar,
  designWidth = 1280,
  primaryAction,
  headerExtras,
  hideSidebarToggle = false,
  onFullscreenClick,
  onSidebarToggleClick,
  srcDocOptions,
  icons: iconOverrides,
  className,
}: PreviewModalShellProps) {
  const t = useT();
  const icons = { ...DEFAULT_PREVIEW_MODAL_ICONS, ...iconOverrides };
  const c = usePreviewModalShell({
    views,
    initialViewId,
    onView,
    onClose,
    sidebarDefaultOpen: sidebar?.defaultOpen,
    sidebarOnToggle: sidebar?.onToggle,
    sidebarContentKey: sidebar?.contentKey,
    designWidth,
  });

  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={t('{title} preview', { title })}
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      data-preview-modal-backdrop=""
      onClick={(event) => {
        // Only the actual backdrop dismisses. Clicks from the modal surface or any descendant
        // bubble through this element with a different target and must leave the preview open.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}
        data-preview-modal=""
        data-preview-modal-fullscreen={c.fullscreen ? 'true' : 'false'}
      >
        <ShellHeader
          title={title}
          subtitle={subtitle}
          views={views}
          controller={c}
          primaryAction={primaryAction}
          icons={icons}
          sidebar={hideSidebarToggle ? undefined : sidebar}
          headerExtras={headerExtras}
          onClose={onClose}
          onSidebarToggleClick={onSidebarToggleClick}
        />
        <ShellStage
          title={title}
          controller={c}
          icons={icons}
          sidebar={sidebar}
          onView={onView}
          srcDocOptions={srcDocOptions}
          onFullscreenClick={onFullscreenClick}
          onSidebarToggleClick={onSidebarToggleClick}
        />
      </div>
    </div>
  );
}

type ShellController = PreviewModalShellController<PreviewModalView>;
type ShellIcons = Record<PreviewModalIconName, () => ReactElement>;

/** Header chrome; `sidebar` is already `undefined` when the host hid the header toggle via `hideSidebarToggle`. */
function ShellHeader({
  title,
  subtitle,
  views,
  controller,
  primaryAction,
  icons,
  sidebar,
  headerExtras,
  onClose,
  onSidebarToggleClick,
}: {
  title: string;
  subtitle: string | undefined;
  views: PreviewModalView[];
  controller: ShellController;
  primaryAction: PreviewModalPrimaryAction | undefined;
  icons: ShellIcons;
  sidebar: PreviewModalSidebar | undefined;
  headerExtras: ReactNode;
  onClose: () => void;
  onSidebarToggleClick: ((open: boolean) => void) | undefined;
}) {
  const t = useT();
  return (
  <header style={{ display: 'flex', alignItems: 'center', gap: 12 }} data-preview-modal-header="">
    <div data-preview-modal-title-block="">
      <div data-preview-modal-title="">{title}</div>
      {subtitle ? <div data-preview-modal-subtitle="">{subtitle}</div> : null}
    </div>
    {views.length > 1 ? <TabBar views={views} controller={controller} /> : null}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }} data-preview-modal-actions="">
      {primaryAction ? <PrimaryAction action={primaryAction} controller={controller} icons={icons} /> : null}
      {sidebar ? (
        <SidebarToggle sidebar={sidebar} controller={controller} onSidebarToggleClick={onSidebarToggleClick} />
      ) : null}
      {headerExtras}
    </div>
    <button
      type="button"
      onClick={onClose}
      title={t('Close preview')}
      aria-label={t('Close')}
      data-preview-modal-close=""
    >
      {icons.close()}
    </button>
  </header>
  );
}

function ShellStage({
  title,
  controller,
  icons,
  sidebar,
  onView,
  srcDocOptions,
  onFullscreenClick,
  onSidebarToggleClick,
}: {
  title: string;
  controller: ShellController;
  icons: ShellIcons;
  sidebar: PreviewModalSidebar | undefined;
  onView: ((viewId: string) => void) | undefined;
  srcDocOptions: BuildSrcDocOptions | undefined;
  onFullscreenClick: (() => void) | undefined;
  onSidebarToggleClick: ((open: boolean) => void) | undefined;
}) {
  const t = useT();
  const status = deriveContentStatus(controller.activeView);
  return (
  <div
    style={{ display: 'flex', flex: 1, minHeight: 0 }}
    data-preview-modal-stage={sidebar && controller.sidebarOpen ? 'has-sidebar' : ''}
    ref={controller.stageRef}
  >
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }} ref={controller.stageFrameRef} data-preview-modal-stage-frame="">
      {status !== 'unavailable' && status !== 'error' ? (
        <FullscreenButton controller={controller} icons={icons} onFullscreenClick={onFullscreenClick} />
      ) : null}
      <ContentStage
        status={status}
        view={controller.activeView}
        title={title}
        scalerStyle={controller.scalerStyle}
        onView={onView}
        srcDocOptions={srcDocOptions}
        t={t}
      />
      {sidebar && !controller.sidebarOpen ? (
        <SidebarHandle sidebar={sidebar} controller={controller} open onSidebarToggleClick={onSidebarToggleClick} />
      ) : null}
    </div>
    {sidebar && controller.sidebarOpen ? (
      <aside aria-label={sidebar.label} data-preview-modal-sidebar="">
        <SidebarHandle sidebar={sidebar} controller={controller} open={false} onSidebarToggleClick={onSidebarToggleClick} />
        {sidebar.content}
      </aside>
    ) : null}
  </div>
  );
}

function TabBar({ views, controller }: { views: PreviewModalView[]; controller: ShellController }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4 }} data-preview-modal-tabs="">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={controller.activeId === v.id}
          data-preview-modal-tab={controller.activeId === v.id ? 'active' : ''}
          onClick={() => controller.setActiveId(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function SidebarToggle({
  sidebar,
  controller,
  onSidebarToggleClick,
}: {
  sidebar: PreviewModalSidebar;
  controller: ShellController;
  onSidebarToggleClick: ((open: boolean) => void) | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={controller.sidebarOpen}
      title={sidebar.label}
      onClick={() => {
        const next = !controller.sidebarOpen;
        onSidebarToggleClick?.(next);
        controller.setSidebarOpen(next);
      }}
    >
      {sidebar.label}
    </button>
  );
}

function FullscreenButton({
  controller,
  icons,
  onFullscreenClick,
}: {
  controller: ShellController;
  icons: ShellIcons;
  onFullscreenClick: (() => void) | undefined;
}) {
  const t = useT();
  const label = controller.fullscreen ? t('Exit fullscreen') : t('Fullscreen');
  return (
    <button
      type="button"
      onClick={() => {
        onFullscreenClick?.();
        if (controller.fullscreen) controller.exitFullscreen();
        else controller.enterFullscreen();
      }}
      title={label}
      aria-label={label}
      data-preview-modal-stage-fullscreen=""
    >
      {controller.fullscreen ? icons['fullscreen-exit']() : icons.fullscreen()}
    </button>
  );
}

/** Stage-edge handle: `open` renders the "Show" expand handle (‹), otherwise the "Hide" collapse handle (›) inside the sidebar. */
function SidebarHandle({
  sidebar,
  controller,
  open,
  onSidebarToggleClick,
}: {
  sidebar: PreviewModalSidebar;
  controller: ShellController;
  open: boolean;
  onSidebarToggleClick: ((open: boolean) => void) | undefined;
}) {
  const t = useT();
  const label = open ? t('Show {label}', { label: sidebar.label }) : t('Hide {label}', { label: sidebar.label });
  return (
    <button
      type="button"
      onClick={() => {
        onSidebarToggleClick?.(open);
        controller.setSidebarOpen(open);
      }}
      title={label}
      aria-label={label}
      data-preview-modal-stage-handle={open ? 'expand' : 'collapse'}
    >
      <span aria-hidden="true">{open ? '‹' : '›'}</span>
    </button>
  );
}

function PrimaryButton({ action }: { action: PreviewModalPrimaryAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || action.busy}
      aria-busy={action.busy ? 'true' : undefined}
      {...(action.testId ? { 'data-testid': action.testId } : {})}
      data-preview-modal-primary-action=""
    >
      {action.busy ? action.busyLabel ?? action.label : action.label}
    </button>
  );
}

function PrimaryAction({
  action,
  controller,
  icons,
}: {
  action: PreviewModalPrimaryAction;
  controller: ShellController;
  icons: ShellIcons;
}) {
  const t = useT();
  const menu = action.menu ?? [];

  if (menu.length === 0) return <PrimaryButton action={action} />;

  return (
    <div ref={controller.primaryMenuRef} style={{ position: 'relative', display: 'flex' }} data-preview-modal-primary-action-group="">
      <PrimaryButton action={action} />
      <button
        type="button"
        onClick={() => controller.setPrimaryMenuOpen((v) => !v)}
        disabled={action.disabled || action.busy}
        aria-haspopup="menu"
        aria-expanded={controller.primaryMenuOpen}
        aria-label={t('More ways to {label}', { label: action.label })}
        {...(action.testId ? { 'data-testid': `${action.testId}-menu` } : {})}
        data-preview-modal-primary-action-caret=""
      >
        {icons['chevron-down']()}
      </button>
      {controller.primaryMenuOpen ? <PrimaryActionMenu menu={menu} controller={controller} /> : null}
    </div>
  );
}

function PrimaryActionMenu({
  menu,
  controller,
}: {
  menu: NonNullable<PreviewModalPrimaryAction['menu']>;
  controller: ShellController;
}) {
  return (
    <div role="menu" data-preview-modal-primary-action-popover="">
      {menu.map((item, index) => (
        <button
          key={item.testId ?? `${item.label}-${index}`}
          type="button"
          role="menuitem"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            controller.setPrimaryMenuOpen(false);
            item.onClick();
          }}
          {...(item.testId ? { 'data-testid': item.testId } : {})}
          data-preview-modal-primary-action-option=""
        >
          <span data-preview-modal-primary-action-option-label="">{item.label}</span>
          {item.description ? (
            <span data-preview-modal-primary-action-option-desc="">{item.description}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ContentStage({
  status,
  view,
  title,
  scalerStyle,
  onView,
  srcDocOptions,
  t,
}: {
  status: ReturnType<typeof deriveContentStatus>;
  view: PreviewModalView | undefined;
  title: string;
  scalerStyle: ShellController['scalerStyle'];
  onView: ((viewId: string) => void) | undefined;
  srcDocOptions: BuildSrcDocOptions | undefined;
  t: ReturnType<typeof useT>;
}) {
  if (status === 'custom') {
    return <div data-preview-modal-stage-custom="">{view?.custom}</div>;
  }
  if (status === 'unavailable') {
    return (
      <div data-preview-modal-unavailable="">
        {view?.unavailable?.message}
      </div>
    );
  }
  if (status === 'error') return <ErrorStage view={view} onView={onView} t={t} />;
  if (status === 'loading') {
    return (
      <div data-preview-modal-loading="">
        {t('Loading {label}…', { label: (view?.label ?? t('preview')).toLowerCase() })}
      </div>
    );
  }
  // `status === 'ready'` is only ever returned by `deriveContentStatus` for
  // a defined view with a string `html` (see rules.ts) — `view!`/`.html`
  // (no `??`) is safe by that invariant, not a runtime guess.
  return (
    <div style={scalerStyle} data-preview-modal-stage-scaler="">
      <SrcDocSandbox
        key={view!.id}
        html={view!.html as string}
        options={srcDocOptions}
        title={`${title} ${view!.label}`}
      />
    </div>
  );
}

function ErrorStage({
  view,
  onView,
  t,
}: {
  view: PreviewModalView | undefined;
  onView: ((viewId: string) => void) | undefined;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div data-preview-modal-error="">
      <div data-preview-modal-error-title="">{t('Something went wrong.')}</div>
      <div data-preview-modal-error-body="">{t('This preview could not be loaded.')}</div>
      {onView && view ? (
        <button type="button" onClick={() => onView(view.id)}>
          {t('Retry')}
        </button>
      ) : null}
    </div>
  );
}
