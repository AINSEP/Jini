import { render, type RenderResult } from '@testing-library/react';
import { forwardRef, useRef, type ReactElement } from 'react';
import type { FetchQueryAdapter, QueryResult } from '@jini-ai/core/fetch';
import { AdminKitProvider, type AdminKit, type ButtonProps, type IconButtonProps, type AdminKitComponents, type AdminKitHooks, type AdminThemeKit } from '../kit.js';
import type { AdminMediaProvidersKit } from '../kit-media-providers.js';

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
  Switch: (p) => <label>{p.label}<input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onCheckedChange({ checked: e.target.checked })} /></label>,
  Dialog: (p) => (p.open ? <div role="dialog" aria-label={p.title}>{p.children}<button type="button" onClick={() => p.onClose({})}>{p.closeLabel ?? 'Close'}</button></div> : null),
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

const fakeHooks: AdminKitHooks = {
  useAgentHandle: (r) => (r.agentHandle === false ? undefined : r.agentHandle ?? 'fake-handle'),
  useFocusTrap: () => {},
  useDirtyGuard: (r) => ({ isDirty: r.original !== null && JSON.stringify(r.current) !== JSON.stringify(r.original), confirmLeave: () => true }),
  useSettlementGeneration: () => {
    const ref = useRef(0);
    return { next: () => ++ref.current, isCurrent: (r) => r.generation === ref.current };
  },
  useConfirmController: (r) => ({
    pending: !!r.pending, error: null,
    cancel: { onPress: () => r.onCancel({}) },
    confirm: { onPress: () => void r.onConfirm({}) },
    requestDismiss: () => { r.onCancel({}); return true; },
  }),
  useNativeDialog: (r) => ({ titleId: 'fake-title', props: { ref: useRef<HTMLDialogElement | null>(null), onCancel: () => r.onClose({}), onClick: () => {} } }),
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

const fakeMediaProviders: AdminMediaProvidersKit = {
  useMediaProvidersTab: () => ({
    providers: {}, load: { status: 'ok' }, save: { status: 'idle' }, hasAnyConfigured: false,
    pendingProviderIds: new Set<string>(), updateProvider: () => {}, clearProvider: () => {}, saveChanges: () => {}, reload: () => {},
  }),
  rules: {
    sortProvidersByConfigured: (catalog) => catalog,
    isEntryPresent: (entry) => !!entry,
    isMarkerOnlyEntry: () => false,
    maskedKeyLabel: () => null,
    isProviderBaseUrlInvalid: () => false,
    invalidBaseUrlProviderIds: () => [],
  },
};

const neutralColors = Object.freeze({ primary: '#000', primaryInk: '#fff', bg: '#fff', surface: '#fff', text: '#000', muted: '#666', border: '#ccc', danger: '#c00', success: '#080', warning: '#c80' });
const fakeTheme: AdminThemeKit = {
  applyAdminTheme: () => () => {},
  resolveColorScheme: (r) => (r.preference === 'dark' ? 'dark' : 'light'),
  defaultAdminTheme: Object.freeze({ name: 'fake', fonts: Object.freeze({ body: 'sans-serif', heading: 'sans-serif' }), light: neutralColors, dark: neutralColors }),
};

/** Plain elements, no UI library: package tests check admin's behaviour, not a kit's markup. */
export function fakeAdminKit(overrides: Partial<{ [G in keyof AdminKit]: Partial<AdminKit[G]> }> = {}): AdminKit {
  return {
    components: { ...fakeComponents, ...overrides.components },
    hooks: { ...fakeHooks, ...overrides.hooks },
    query: { ...fixtureQuery(), ...overrides.query },
    mediaProviders: { ...fakeMediaProviders, ...overrides.mediaProviders },
    theme: { ...fakeTheme, ...overrides.theme },
  } satisfies AdminKit;
}

export function renderWithAdminKit(ui: ReactElement, options: { kit?: AdminKit } = {}): RenderResult {
  return render(<AdminKitProvider kit={options.kit ?? fakeAdminKit()}>{ui}</AdminKitProvider>);
}
