import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';
import { Icon } from './Icon.js';

export type WorkingDirPlacement = 'down' | 'up';

export type WorkingDirLabels = Partial<{
  missing: string;
  hint: string;
  trigger: string;
  replace: string;
  pick: string;
  recent: string;
  recentEmpty: string;
  clear: string;
}>;

export interface WorkingDirPickerProps {
  /**
   * Currently selected local working directory shown inline with a clear
   * button, or null to show only the "select" label (e.g. when the selection
   * is surfaced elsewhere, like a project composer's linked-dir chips).
   */
  workingDir: string | null;
  /** Most-recently-used directories, most-recent-first. */
  recentDirs: string[];
  /** Open the native folder picker. */
  onPickDirectory: () => void;
  /** Re-select a previously used directory. */
  onSelectRecent: (dir: string) => void;
  /** Clear the current selection. Only reachable when `workingDir` is set. */
  onClear?: () => void;
  /** Extra class applied to the outer wrapper, for layout by the host. */
  className?: string;
  /** The selected directory no longer exists on disk — flag it in red. */
  invalid?: boolean;
  /**
   * Panel direction. `'down'` (default) suits a composer with room below;
   * `'up'` suits a composer whose trigger sits at the bottom of the
   * viewport, so a downward panel would be clipped.
   */
  placement?: WorkingDirPlacement;
  /** Fired when the panel opens, so the host can re-validate freshness. */
  onOpen?: () => void;
  /** Copy — all host-supplied, no built-in i18n. */
  labels?: WorkingDirLabels;
  /** Custom hook override for dependency injection / testing. */
  useWorkingDirPicker?: typeof useWorkingDirPicker;
}

export const DEFAULT_WORKING_DIR_LABELS = {
  missing: 'Directory no longer exists',
  hint: 'Select a working directory',
  trigger: 'Working directory',
  replace: 'Change folder',
  pick: 'Choose folder',
  recent: 'Recent folders',
  recentEmpty: 'No recent folders',
  clear: 'Clear',
};

export type ResolvedWorkingDirLabels = typeof DEFAULT_WORKING_DIR_LABELS;

/** Merge host label overrides onto the built-in English defaults. */
export function resolveWorkingDirLabels(labels?: WorkingDirLabels): ResolvedWorkingDirLabels {
  return { ...DEFAULT_WORKING_DIR_LABELS, ...labels };
}

/** Last path segment of a `/`- or `\`-separated dir; the whole input if empty. */
export function basename(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? dir;
}

export interface UseDismissablePanelResult {
  /** Whether the panel is currently open. */
  open: boolean;
  /** Attach to the outer wrapper; an outside pointer press dismisses. */
  wrapRef: MutableRefObject<HTMLDivElement | null>;
  /** Flip open/closed; fires `onOpen` only on the closed→open edge. */
  toggle: () => void;
  /** Close the panel. */
  close: () => void;
}

/**
 * Owns the panel's open/closed boolean plus the "click outside or press
 * Escape to dismiss" behavior. While open, it listens on `document` for a
 * pointer press outside `wrapRef` or an Escape keypress and closes.
 * `toggle` flips the state and invokes `onOpen` only on the closed→open
 * transition. Exported so the behavior is testable without a render.
 */
export function useDismissablePanel(onOpen?: () => void): UseDismissablePanelResult {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  // Read `open` directly and fire `onOpen` from this handler rather than from
  // inside the `setOpen` updater: an updater must stay a pure function of
  // previous state, and calling a caller-supplied callback there can run it
  // while React is mid-render of a different component (a synchronous
  // setState inside `onOpen` then trips "Cannot update a component while
  // rendering a different component"), and React may invoke an updater more
  // than once (e.g. StrictMode), which would fire `onOpen` twice.
  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) onOpen?.();
  }, [open, onOpen]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, wrapRef, toggle, close };
}

export interface UseRecentFlyoutResult {
  /** Whether the "Recent folders" flyout is expanded. */
  recentOpen: boolean;
  /** Expand the flyout. */
  show: () => void;
  /** Collapse the flyout. */
  hide: () => void;
  /** Toggle the flyout. */
  toggle: () => void;
}

/**
 * Owns the "Recent folders" flyout's open boolean. Auto-collapses whenever the
 * parent panel closes (`panelOpen` goes false), matching the original's
 * single-effect reset. Exported for isolated testing.
 */
export function useRecentFlyout(panelOpen: boolean): UseRecentFlyoutResult {
  const [recentOpen, setRecentOpen] = useState(false);
  useEffect(() => {
    if (!panelOpen) setRecentOpen(false);
  }, [panelOpen]);
  const show = useCallback(() => setRecentOpen(true), []);
  const hide = useCallback(() => setRecentOpen(false), []);
  const toggle = useCallback(() => setRecentOpen((v) => !v), []);
  return { recentOpen, show, hide, toggle };
}

export interface UseWorkingDirPickerInput {
  onPickDirectory: () => void;
  onSelectRecent: (dir: string) => void;
  // `| undefined` (not just `?`) so the component can forward its own optional
  // props straight through under `exactOptionalPropertyTypes`.
  onClear?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  labels?: WorkingDirLabels | undefined;
}

export interface UseWorkingDirPickerResult {
  open: boolean;
  recentOpen: boolean;
  wrapRef: MutableRefObject<HTMLDivElement | null>;
  labels: ResolvedWorkingDirLabels;
  toggle: () => void;
  /** Close the panel, then open the native folder picker. */
  pick: () => void;
  /** Forward a recent dir to the host, then close the panel. */
  selectRecent: (dir: string) => void;
  /** Clear the selection (if a handler is supplied), then close the panel. */
  clear: () => void;
  showRecent: () => void;
  hideRecent: () => void;
  toggleRecent: () => void;
}

/**
 * Composes {@link useDismissablePanel} and {@link useRecentFlyout} and builds
 * the picker's action handlers (each closes the panel and forwards to the host
 * callback). `clear` tolerates a missing `onClear` — a defensive guard the
 * dumb component never reaches (it only renders the clear button when
 * `onClear` is set), but reachable directly through this hook.
 * {@link WorkingDirPicker} is the dumb consumer of this result.
 */
export function useWorkingDirPicker(input: UseWorkingDirPickerInput): UseWorkingDirPickerResult {
  const { onPickDirectory, onSelectRecent, onClear, onOpen, labels } = input;
  const panel = useDismissablePanel(onOpen);
  const flyout = useRecentFlyout(panel.open);
  const resolved = resolveWorkingDirLabels(labels);

  const pick = useCallback(() => {
    panel.close();
    onPickDirectory();
  }, [onPickDirectory, panel]);

  const selectRecent = useCallback((dir: string) => {
    onSelectRecent(dir);
    panel.close();
  }, [onSelectRecent, panel]);

  const clear = useCallback(() => {
    onClear?.();
    panel.close();
  }, [onClear, panel]);

  return {
    open: panel.open,
    recentOpen: flyout.recentOpen,
    wrapRef: panel.wrapRef,
    labels: resolved,
    toggle: panel.toggle,
    pick,
    selectRecent,
    clear,
    showRecent: flyout.show,
    hideRecent: flyout.hide,
    toggleRecent: flyout.toggle,
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';
const RECENT_ITEM_SELECTOR = '[data-testid="working-dir-recent"]';
const RECENT_LIST_SELECTOR = '[data-testid="working-dir-recent-list"]';

/**
 * The menu item a navigation key moves focus to, or `null` for any other key. `count` is never 0:
 * the "Choose folder" item is always rendered and never disabled. ArrowUp from `currentIndex` -1
 * (focus on no menu item) yields `count - 2`, pinned as-is by the component tests.
 */
function resolveMenuNavigationIndex({ key, currentIndex, count }: { key: string; currentIndex: number; count: number }): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count;
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return null;
}

/** Arrow/Home/End roving focus across the panel's enabled menu items; true when the key was handled. */
function handleMenuNavigationKey({ event }: { event: ReactKeyboardEvent<HTMLDivElement> }): boolean {
  const menuItems = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];
  const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
  const nextIndex = resolveMenuNavigationIndex({ key: event.key, currentIndex, count: menuItems.length });
  if (nextIndex === null) return false;
  event.preventDefault();
  menuItems[nextIndex]?.focus();
  return true;
}

/** ArrowRight on "Recent folders" opens its flyout; ArrowLeft inside the flyout closes it again. */
function handleRecentFlyoutKey({ event, showRecent, hideRecent }: {
  event: ReactKeyboardEvent<HTMLDivElement>; showRecent: () => void; hideRecent: () => void;
}): void {
  const panel = event.currentTarget;
  if (event.key === 'ArrowRight' && event.target === panel.querySelector(RECENT_ITEM_SELECTOR)) {
    event.preventDefault();
    showRecent();
    window.setTimeout(() => {
      panel.querySelector<HTMLElement>(`${RECENT_LIST_SELECTOR} [role="menuitem"]`)?.focus();
    }, 0);
    return;
  }
  if (
    event.key === 'ArrowLeft'
    && event.target instanceof HTMLElement
    && event.target.closest(RECENT_LIST_SELECTOR)
  ) {
    event.preventDefault();
    hideRecent();
    panel.querySelector<HTMLElement>(RECENT_ITEM_SELECTOR)?.focus();
  }
}

/** Focus the first menu item on open; return focus to the trigger after the panel closes. */
function useWorkingDirFocusHandoff({ open, triggerRef, panelRef }: {
  open: boolean;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
}): void {
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      panelRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const timeout = window.setTimeout(() => triggerRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [open, panelRef, triggerRef]);
}

function WorkingDirTrigger({ triggerRef, workingDir, invalid, open, panelId, t, toggle }: {
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  workingDir: string | null;
  invalid: boolean;
  open: boolean;
  panelId: string;
  t: ResolvedWorkingDirLabels;
  toggle: () => void;
}) {
  return (
    <div className="jini-working-dir-trigger-row">
      <button
        ref={triggerRef}
        type="button"
        className={`jini-working-dir-trigger${invalid ? ' invalid' : ''}`}
        data-testid="working-dir-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        title={invalid ? t.missing : (workingDir ?? t.hint)}
        onClick={toggle}
      >
        <Icon name="folder" size={13} className="jini-working-dir-trigger-icon" />
        <span className="jini-working-dir-trigger-label">
          {workingDir ? basename(workingDir) : t.trigger}
        </span>
        <Icon name="chevron-down" size={11} className="jini-working-dir-trigger-chevron" />
      </button>
    </div>
  );
}

function WorkingDirRecentFlyout({ recentDirs, placement, t, selectRecent }: {
  recentDirs: string[];
  placement: WorkingDirPlacement;
  t: ResolvedWorkingDirLabels;
  selectRecent: (dir: string) => void;
}) {
  return (
    <div
      className={`jini-working-dir-flyout${placement === 'up' ? ' up' : ''}`}
      role="menu"
      data-testid="working-dir-recent-list"
    >
      {recentDirs.length === 0 ? (
        <div className="jini-working-dir-empty">{t.recentEmpty}</div>
      ) : (
        recentDirs.map((dir) => (
          <button
            key={dir}
            type="button"
            role="menuitem"
            className="jini-working-dir-recent-item"
            title={dir}
            onClick={() => selectRecent(dir)}
          >
            <Icon name="folder" size={13} className="jini-working-dir-item-icon" />
            <span className="jini-working-dir-recent-name">{basename(dir)}</span>
            <span className="jini-working-dir-recent-path">{dir}</span>
          </button>
        ))
      )}
    </div>
  );
}

function WorkingDirPanel({ panelRef, panelId, placement, workingDir, recentDirs, canClear, t, picker, onKeyDown }: {
  panelRef: MutableRefObject<HTMLDivElement | null>;
  panelId: string;
  placement: WorkingDirPlacement;
  workingDir: string | null;
  recentDirs: string[];
  canClear: boolean;
  t: ResolvedWorkingDirLabels;
  picker: Pick<UseWorkingDirPickerResult, 'recentOpen' | 'pick' | 'selectRecent' | 'clear' | 'showRecent' | 'hideRecent' | 'toggleRecent'>;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const { recentOpen, pick, selectRecent, clear, showRecent, hideRecent, toggleRecent } = picker;
  return (
    <div
      ref={panelRef}
      id={panelId}
      className={`jini-working-dir-panel${placement === 'up' ? ' up' : ''}`}
      role="menu"
      data-testid="working-dir-panel"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        className="jini-working-dir-item"
        data-testid="working-dir-pick"
        onClick={pick}
      >
        <Icon name="folder" size={14} className="jini-working-dir-item-icon" />
        <span>{workingDir ? t.replace : t.pick}</span>
      </button>

      <div
        className="jini-working-dir-submenu-row"
        onMouseEnter={showRecent}
        onMouseLeave={hideRecent}
      >
        <button
          type="button"
          role="menuitem"
          className="jini-working-dir-item"
          aria-haspopup="menu"
          aria-expanded={recentOpen}
          data-testid="working-dir-recent"
          onClick={toggleRecent}
        >
          <Icon name="history" size={14} className="jini-working-dir-item-icon" />
          <span>{t.recent}</span>
          <Icon name="chevron-right" size={12} className="jini-working-dir-item-chevron" />
        </button>
        {recentOpen ? (
          <WorkingDirRecentFlyout recentDirs={recentDirs} placement={placement} t={t} selectRecent={selectRecent} />
        ) : null}
      </div>

      {canClear ? (
        <button
          type="button"
          role="menuitem"
          className="jini-working-dir-item"
          data-testid="working-dir-clear"
          onClick={clear}
        >
          <Icon name="close" size={14} className="jini-working-dir-item-icon" />
          <span>{t.clear}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Working-directory picker: a borderless trigger that opens a panel with
 * "Choose folder" and a "Recent folders" submenu. Layout is left to the host
 * via `className`; all open/close/keyboard state lives in
 * {@link useWorkingDirPicker}. This component is a dumb render.
 */
export function WorkingDirPicker({
  workingDir,
  recentDirs,
  onPickDirectory,
  onSelectRecent,
  onClear,
  className,
  placement = 'down',
  invalid = false,
  onOpen,
  labels,
  useWorkingDirPicker: useWorkingDirPickerHook = useWorkingDirPicker,
}: WorkingDirPickerProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const picker = useWorkingDirPickerHook({ onPickDirectory, onSelectRecent, onClear, onOpen, labels });
  const { open, wrapRef, labels: t, toggle, showRecent, hideRecent } = picker;
  useWorkingDirFocusHandoff({ open, triggerRef, panelRef });

  const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (handleMenuNavigationKey({ event })) return;
    handleRecentFlyoutKey({ event, showRecent, hideRecent });
  }, [hideRecent, showRecent]);

  return (
    <div
      ref={wrapRef}
      className={`jini-working-dir-picker${className ? ` ${className}` : ''}`}
      data-testid="working-dir-picker"
    >
      <WorkingDirTrigger
        triggerRef={triggerRef}
        workingDir={workingDir}
        invalid={invalid}
        open={open}
        panelId={panelId}
        t={t}
        toggle={toggle}
      />

      {open ? (
        <WorkingDirPanel
          panelRef={panelRef}
          panelId={panelId}
          placement={placement}
          workingDir={workingDir}
          recentDirs={recentDirs}
          canClear={Boolean(workingDir && onClear)}
          t={t}
          picker={picker}
          onKeyDown={handlePanelKeyDown}
        />
      ) : null}
    </div>
  );
}
