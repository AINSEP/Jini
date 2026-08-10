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
import { usePreviewModalShell } from '../hooks/usePreviewModalShell.js';
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

  const showTabs = views.length > 1;
  const status = deriveContentStatus(c.activeView);

  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={t('{title} preview', { title })}
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      data-preview-modal-backdrop=""
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}
        data-preview-modal=""
        data-preview-modal-fullscreen={c.fullscreen ? 'true' : 'false'}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }} data-preview-modal-header="">
          <div data-preview-modal-title-block="">
            <div data-preview-modal-title="">{title}</div>
            {subtitle ? <div data-preview-modal-subtitle="">{subtitle}</div> : null}
          </div>
          {showTabs ? (
            <div role="tablist" style={{ display: 'flex', gap: 4 }} data-preview-modal-tabs="">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={c.activeId === v.id}
                  data-preview-modal-tab={c.activeId === v.id ? 'active' : ''}
                  onClick={() => c.setActiveId(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }} data-preview-modal-actions="">
            {primaryAction ? <PrimaryAction action={primaryAction} controller={c} icons={icons} /> : null}
            {sidebar && !hideSidebarToggle ? (
              <button
                type="button"
                aria-pressed={c.sidebarOpen}
                title={sidebar.label}
                onClick={() => {
                  const next = !c.sidebarOpen;
                  onSidebarToggleClick?.(next);
                  c.setSidebarOpen(next);
                }}
              >
                {sidebar.label}
              </button>
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
        <div
          style={{ display: 'flex', flex: 1, minHeight: 0 }}
          data-preview-modal-stage={sidebar && c.sidebarOpen ? 'has-sidebar' : ''}
          ref={c.stageRef}
        >
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }} ref={c.stageFrameRef} data-preview-modal-stage-frame="">
            {status !== 'unavailable' && status !== 'error' ? (
              <button
                type="button"
                onClick={() => {
                  onFullscreenClick?.();
                  if (c.fullscreen) c.exitFullscreen();
                  else c.enterFullscreen();
                }}
                title={c.fullscreen ? t('Exit fullscreen') : t('Fullscreen')}
                aria-label={c.fullscreen ? t('Exit fullscreen') : t('Fullscreen')}
                data-preview-modal-stage-fullscreen=""
              >
                {c.fullscreen ? icons['fullscreen-exit']() : icons.fullscreen()}
              </button>
            ) : null}
            <ContentStage
              status={status}
              view={c.activeView}
              title={title}
              scalerStyle={c.scalerStyle}
              onView={onView}
              srcDocOptions={srcDocOptions}
              t={t}
            />
            {sidebar && !c.sidebarOpen ? (
              <button
                type="button"
                onClick={() => {
                  onSidebarToggleClick?.(true);
                  c.setSidebarOpen(true);
                }}
                title={t('Show {label}', { label: sidebar.label })}
                aria-label={t('Show {label}', { label: sidebar.label })}
                data-preview-modal-stage-handle="expand"
              >
                <span aria-hidden="true">‹</span>
              </button>
            ) : null}
          </div>
          {sidebar && c.sidebarOpen ? (
            <aside aria-label={sidebar.label} data-preview-modal-sidebar="">
              <button
                type="button"
                onClick={() => {
                  onSidebarToggleClick?.(false);
                  c.setSidebarOpen(false);
                }}
                title={t('Hide {label}', { label: sidebar.label })}
                aria-label={t('Hide {label}', { label: sidebar.label })}
                data-preview-modal-stage-handle="collapse"
              >
                <span aria-hidden="true">›</span>
              </button>
              {sidebar.content}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PrimaryAction({
  action,
  controller,
  icons,
}: {
  action: PreviewModalPrimaryAction;
  controller: ReturnType<typeof usePreviewModalShell>;
  icons: Record<PreviewModalIconName, () => ReactElement>;
}) {
  const t = useT();
  const hasMenu = Boolean(action.menu && action.menu.length > 0);

  if (!hasMenu) {
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

  return (
    <div ref={controller.primaryMenuRef} style={{ position: 'relative', display: 'flex' }} data-preview-modal-primary-action-group="">
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
      {controller.primaryMenuOpen ? (
        <div role="menu" data-preview-modal-primary-action-popover="">
          {action.menu!.map((item, index) => (
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
      ) : null}
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
  scalerStyle: ReturnType<typeof usePreviewModalShell>['scalerStyle'];
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
  if (status === 'error') {
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
