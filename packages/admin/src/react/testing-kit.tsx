import { forwardRef, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { FetchQueryAdapter, QueryResult } from '@jini-ai/core/fetch';
import { type AdminKit, type DialogProps, type NativeDialogView, type SettlementGeneration, type ButtonProps, type IconButtonProps, type AdminKitComponents, type AdminKitHooks, type AdminThemeKit } from './kit.js';
import { fakeMediaProviders } from './testing-kit-media-providers.js';

const fakeComponents: AdminKitComponents = {
  Button: forwardRef<HTMLButtonElement, Omit<ButtonProps, 'ref'>>((p, ref) => <button ref={ref} {...p.attrs} type={p.type ?? 'button'} className={p.className} disabled={p.disabled || p.pending} onClick={() => p.onPress?.({})}>{p.children}</button>),
  IconButton: forwardRef<HTMLButtonElement, Omit<IconButtonProps, 'ref'>>((p, ref) => <button ref={ref} {...p.attrs} type={p.type ?? 'button'} aria-label={p.label} disabled={p.disabled || p.pending} onClick={() => p.onPress?.({})}>{p.children}</button>),
  TextField: (p) => <label>{p.label}<input {...p.attrs} type={p.type} value={p.value} disabled={p.disabled} onChange={(e) => p.onValueChange({ value: e.target.value })} /></label>,
  TextArea: (p) => <label>{p.label}<textarea {...p.attrs} value={p.value} disabled={p.disabled} onChange={(e) => p.onValueChange({ value: e.target.value })} /></label>,
  Select: (p) => (
    <label>{p.label}
      <select {...p.attrs} value={p.value} disabled={p.disabled} onChange={(e) => p.onValueChange({ value: e.target.value })}>
        {p.options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  ),
  Switch: (p) => <label>{p.label}<input type="checkbox" role="switch" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onCheckedChange({ checked: e.target.checked })} /></label>,
  Dialog: (p) => (p.open ? <div role="dialog" aria-label={p.title}><h2>{p.title}</h2>{p.children}<button type="button" onClick={() => p.onClose({})}>{p.closeLabel ?? 'Close'}</button></div> : null),
  ConfirmDialog: (p) => (p.open ? (
    <div role="dialog" aria-label={p.title}>{p.body}
      <button type="button" onClick={() => p.onCancel({})}>{p.cancelLabel ?? 'Cancel'}</button>
      <button type="button" onClick={() => void p.onConfirm({})}>{p.confirmLabel}</button>
    </div>
  ) : null),
  Tabs: (p) => (
    <div role="tablist" aria-label={p.label}>
      {p.items.map((i) => <button key={i.id} type="button" role="tab" aria-selected={i.id === p.value} disabled={i.disabled} onClick={() => p.onValueChange({ value: i.id })}>{i.label}</button>)}
      {p.items.find((i) => i.id === p.value)?.content}
    </div>
  ),
  Menu: (p) => <div role="menu" aria-label={p.label}>{p.items.map((i) => <button key={i.id} type="button" role="menuitem" disabled={i.disabled} onClick={() => i.onPress({})}>{i.label}</button>)}</div>,
  Notice: (p) => <div role="status" data-tone={p.tone}>{p.children}</div>,
  Spinner: (p) => <span role="progressbar" aria-label={p.label} />,
  Badge: (p) => <span data-tone={p.tone}>{p.children}</span>,
  InfoTip: (p) => <span title={p.label} />,
  Lightbox: (p) => (p.open ? <div role="dialog" aria-label={p.title}>{p.children}<button type="button" onClick={() => p.onClose()}>Close</button></div> : null),
  WidgetSelect: (p) => (
    <select id={p.id} aria-label={p['aria-label']} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)}>
      {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  TabBar: (p) => <div role="tablist" aria-label={p.ariaLabel}>{p.tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={t.id === p.activeId} onClick={() => p.onChange(t.id)}>{t.label}</button>)}</div>,
  HtmlEditor: (p) => <textarea value={p.html} className={p.className} onChange={(e) => p.onChange(e.target.value)} />,
  ErrorNotice: (p) => <p role={p.role ?? 'alert'}>{p.failure.message}</p>,
};

fakeComponents.Button.displayName = 'FakeButton';
fakeComponents.IconButton.displayName = 'FakeIconButton';

// Mirrors the real hook's one observable duty: a `<dialog>` is only visible/accessible once opened, so follow `open`.
function useFakeNativeDialog(required: DialogProps): NativeDialogView {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Attribute, not showModal(): jsdom has no dialog top layer, and the attribute is all accessibility queries read.
    el.toggleAttribute('open', required.open);
  }, [required.open]);
  return { titleId: 'fake-title', props: { ref, onCancel: () => required.onClose({}), onClick: () => {} } };
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
// Mirrors the real trap's contract: while active, Tab and Shift+Tab wrap at the container's first/last focusable.
function useFakeFocusTrap({ containerRef }: { containerRef: RefObject<HTMLElement | null> }, { active = true }: { active?: boolean | undefined } = {}): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (!edge || document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [containerRef, active]);
}

const fakeHooks: AdminKitHooks = {
  useAgentHandle: (r) => (r.agentHandle === false ? undefined : r.agentHandle ?? 'fake-handle'),
  useFocusTrap: useFakeFocusTrap,
  useDirtyGuard: (r, o) => {
    const isDirty = r.original !== null && JSON.stringify(r.current) !== JSON.stringify(r.original);
    // The contract: clean (and nothing untracked) leaves freely; otherwise the operator's answer decides.
    return { isDirty, confirmLeave: (_required = {}, { unsavedBeyondTracked = false } = {}) => (!isDirty && !unsavedBeyondTracked) || (o?.host ?? window).confirm('You have unsaved changes. Leave without saving?') };
  },
  useSettlementGeneration: () => {
    const ref = useRef(0);
    // Stable identity across renders, like a host's: callers list it in effect deps.
    return useMemo<SettlementGeneration>(() => ({ next: () => ++ref.current, isCurrent: (r) => r.generation === ref.current }), []);
  },
  useConfirmController: (r) => ({
    pending: !!r.pending, error: null,
    cancel: { onPress: () => r.onCancel({}) },
    confirm: { onPress: () => void r.onConfirm({}) },
    requestDismiss: () => { r.onCancel({}); return true; },
  }),
  useNativeDialog: useFakeNativeDialog,
};

/** Query hooks that answer immediately with `data`; mutations resolve at once. */
export function fixtureQuery(fixture: { data?: unknown } = {}): AdminKit['query'] {
  const adapter: FetchQueryAdapter = {
    useFetchQuery: <T,>() => ({ data: fixture.data as T | undefined, error: null, status: 'success', isFetching: false, refetch: () => {} }) satisfies QueryResult<T>,
    useFetchMutation: ({ run }) => ({ mutate: run, status: 'idle', error: null, reset: () => {} }),
    useInvalidate: () => () => {},
    useCachedLoader: <T,>(required: { key: readonly (string | number)[]; fetch?: (() => Promise<T>) | undefined }) => ({
      peek: () => undefined,
      load: async () => (required.fetch ? required.fetch() : (fixture.data as T)),
      replace: () => {},
    }),
  };
  return { ...adapter, useFetchQueryScope: () => 1 };
}

// Named colors only: admin source carries no literal color values (theme-boundaries), the host owns the palette.
const neutralColors = Object.freeze({ primary: 'black', primaryInk: 'white', bg: 'white', surface: 'white', text: 'black', muted: 'dimgray', border: 'lightgray', danger: 'firebrick', success: 'green', warning: 'darkorange' });
const fakeTheme: AdminThemeKit = {
  applyAdminTheme: () => () => {},
  resolveColorScheme: (r) => (r.preference === 'dark' ? 'dark' : 'light'),
  defaultAdminTheme: Object.freeze({ name: 'fake', fonts: Object.freeze({ body: 'sans-serif', heading: 'sans-serif' }), light: neutralColors, dark: neutralColors }),
};

/** Test-only kit for admin AND for consumer packages whose screens render under it (`@jini-ai/admin/react/testing-kit`).
 *  Plain elements, no UI library: package tests check admin's behaviour, not a kit's markup. */
export function fakeAdminKit(overrides: Partial<{ [G in keyof AdminKit]: Partial<AdminKit[G]> }> = {}): AdminKit {
  return {
    components: { ...fakeComponents, ...overrides.components },
    hooks: { ...fakeHooks, ...overrides.hooks },
    query: { ...fixtureQuery(), ...overrides.query },
    mediaProviders: { ...fakeMediaProviders, ...overrides.mediaProviders },
    theme: { ...fakeTheme, ...overrides.theme },
  } satisfies AdminKit;
}
