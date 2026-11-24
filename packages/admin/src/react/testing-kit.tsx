import { forwardRef, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FetchQueryAdapter, QueryResult } from '@jini-ai/core/fetch';
import { type AdminKit, type DialogProps, type NativeDialogView, type SettlementGeneration, type ButtonProps, type IconButtonProps, type AdminKitComponents, type AdminKitHooks, type AdminKitValues, type AdminThemeKit, type KitTranslator, type AdminKitChat, type KitDeliverTypedAnswer, type PanelPosition, type FailureChannel, type StandingDraftAutosaveSnapshot, type StandingDraftLocalBackup, type SaveState } from './kit.js';
import type { UserFacingError } from '@jini-ai/core';
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
  Icon: (p) => <svg data-icon={p.name} width={p.size} height={p.size} className={p.className} aria-hidden={p['aria-hidden']} aria-label={p['aria-label']} />,
  RemixIcon: (p) => <i data-remix-icon={p.name} className={p.className} aria-hidden="true" />,
  Toast: (p) => <div role={p.role ?? 'status'} data-tone={p.tone}>{p.message}{p.onDismiss ? <button type="button" onClick={p.onDismiss}>Dismiss</button> : null}</div>,
  I18nProvider: (p) => <>{p.children}</>,
  SettingsDialogShell: (p) => {
    const [own, setOwn] = useState(p.initialActiveTabId ?? p.tabs[0]?.id);
    const active = p.activeTabId ?? own;
    const select = (id: string) => { setOwn(id); p.onActiveTabIdChange?.(id); };
    return (
      <div className={p.className}>
        <div role="tablist">{p.tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={t.id === active} onClick={() => select(t.id)}>{t.label}</button>)}</div>
        <div role="tabpanel">{p.tabs.find((t) => t.id === active)?.panel}</div>
      </div>
    );
  },
  CodeWithLines: (p) => <pre data-wrap={p.wrap ? 'true' : 'false'}>{p.text}</pre>,
  CodeWrapToggle: (p) => <button type="button" aria-pressed={p.wrap} className={p.className} onClick={p.onToggle}>{p.t('Wrap lines')}</button>,
  PreviewModalShell: (p) => (
    <div role="dialog" aria-label={p.title} className={p.className}>{p.headerExtras}{p.views.map((v) => <section key={v.id} aria-label={v.label}>{v.custom}</section>)}
      <button type="button" onClick={p.onClose}>Close</button>
    </div>
  ),
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

// One module-level function: a host's translator keeps its identity across renders, and callers list it in deps.
const passthroughTranslator: KitTranslator = (key, vars = {}) => key.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));

const fakeHooks: AdminKitHooks = {
  // A fixed English locale: tests that care about the locale inject their own hook.
  useAdminLocale: () => 'en',
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
  useT: () => passthroughTranslator,
  useTabBarKeyboard: () => ({ onKeyDown: () => {} }),
  // Runs each task straight away: tests that check ordering inject their own queue.
  useSerialWrites: () => ({ run: ({ task }) => task() }),
  useCodeWrap: () => {
    const [wrap, setWrap] = useState(false);
    return { wrap, toggleWrap: () => setWrap((w) => !w) };
  },
  useInfoTip: () => {
    const iconRef = useRef<HTMLSpanElement | null>(null);
    const [open, setOpen] = useState(false);
    return { open, placement: 'below', coords: { top: 0, left: 0 }, iconRef, show: () => setOpen(true), hide: () => setOpen(false),
      leave: () => setOpen(false), toggle: () => setOpen((o) => !o), handleIconKeyDown: () => {} };
  },
  usePanelPosition: () => {
    const [position, setPosition] = useState<PanelPosition | null>(null);
    return { position, setPosition, updatePosition: () => {} };
  },
  useSelectDropdown: (r, o) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const optionRefs = useRef(new Map<number, HTMLLIElement>());
    const filtered = query ? r.options.filter((x) => x.label.toLowerCase().includes(query.toLowerCase())) : r.options;
    return {
      open, query, setQuery, highlightedIndex, setHighlightedIndex, position: null, triggerRef, panelRef, searchInputRef, optionRefs,
      listboxId: 'fake-listbox', showSearch: false, filtered, selectedOption: r.options.find((x) => x.value === r.value) ?? null,
      openPanel: () => { if (!o?.disabled) setOpen(true); }, closePanel: () => setOpen(false),
      selectOption: (option) => { r.onChange(option.value); setOpen(false); },
      handleTriggerKeyDown: () => {}, handlePanelKeyDown: () => {}, optionId: (index) => `fake-listbox-option-${index}`,
    };
  },
  useTabbedDialog: (r) => {
    const [activeTabId, setActiveTabId] = useState<string | null>(r.initialActiveTabId ?? r.tabs[0]?.id ?? null);
    return { activeTabId, setActiveTabId };
  },
  // No reset timer: `copied` stays as the last copy left it. A test that checks the reset injects the real hook.
  useCopyToClipboard: (clipboard) => {
    const [copied, setCopied] = useState(false);
    return { copied, copy: async (text) => { const ok = await clipboard.copyText(text); setCopied(ok); return ok; } };
  },  useExecutionCredential: () => ({
    stored: null, apiKeyStoredExternally: false, apiKeyPlaceholder: undefined, storedKeyIsForOtherEndpoint: false, canDiscoverModels: false,
    saveState: { status: 'idle' }, settingsSaveState: { status: 'idle' }, canSaveKey: false, saveKey: async () => {}, saveSettings: async () => {},
    legacyKey: null, migrateLegacyKey: async () => {}, dismissLegacyPrompt: () => {},
  }),
  // Holds the default until changed; never loads or saves. A test that checks persistence injects its own hook.
  useSettingsSlice: (options) => {
    const [value, setValue] = useState<typeof options.defaultValue | null>(options.defaultValue);
    return { value, loadError: null, saveState: { status: 'idle' }, onChange: setValue, refresh: async () => {} };
  },
  useStandingDraftAutosave: () => ({
    recoverableDraft: null, staleBasis: null, dismissRecoverable: () => {}, scheduleAutosave: () => {}, clearStandingDraft: async () => ({ discarded: false }),
    supersedeBasis: () => {}, preserveFailedSave: () => {},
  }),
  useWiredCopyToClipboard: () => {
    const [copied, setCopied] = useState(false);
    return { copied, copy: async () => { setCopied(true); return true; } };
  },
  useCursorPages: (r) => {
    const [filters, setFilters] = useState(r.initialFilters);
    const [page, setPage] = useState<Awaited<ReturnType<typeof r.fetchPage>> | null>(null);
    useEffect(() => { void r.fetchPage({ filters }).then(setPage); }, [filters]);
    return { rows: page?.items ?? null, nextCursor: page?.nextCursor ?? null, failure: null, appliedFilters: filters, applyFilters: setFilters, loadingMore: false, loadMore: async () => {} };
  },
  useI18n: () => ({ locale: 'en', setLocale: () => {}, t: passthroughTranslator }),
  useDebouncedHtmlPreview: (r) => ({ document: r.source, loading: false, error: null }),
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

// Neutral stand-ins with the hosts' runtime shapes; a test that cares about a value injects its own.
const fakeValuesDraft: AdminKitValues = {
  SETTINGS_DIALOG_DICTIONARIES: Object.freeze({}),
  DEFAULT_NOTIFICATIONS_PREFERENCES: Object.freeze({ soundEnabled: false, successSoundId: 'fake-success', failureSoundId: 'fake-failure', desktopEnabled: false }),
  UNREACHABLE_RETRY_DELAYS_MS: Object.freeze([1, 2]),
  LOCAL_BACKUP_PRINCIPAL_ID: 'fake-local-backup',
  buildSandboxProxyDataUrl: () => 'data:text/html,fake-sandbox-proxy',
  openLightboxDialog: (dialog: HTMLDialogElement) => dialog.setAttribute('open', ''),
  closeLightboxDialog: (dialog: HTMLDialogElement) => dialog.removeAttribute('open'),
  resolveTabBarTabIndex: (r: { activeId: string; tab: { id: string } }) => (r.tab.id === r.activeId ? 0 : -1),
  hasPermission: (r: { permissions: readonly string[]; permission: string }) => r.permissions.includes(r.permission),
  standingDraftRecoveryMessage: (r: { draft: StandingDraftAutosaveSnapshot; t: (key: string) => string }) => `${r.t('Unsaved draft from')} ${r.draft.savedAt}`,
  // In-memory, not the tab's storage: each factory call gets its own map.
  createStandingDraftLocalBackup: (): StandingDraftLocalBackup => {
    const rows = new Map<string, StandingDraftAutosaveSnapshot>();
    return {
      write: ({ entryId, draft, savedAt }, { principalId } = {}) => { if (principalId !== null) rows.set(entryId, { ...draft, savedAt, savedByPrincipalId: principalId ?? 'fake-local-backup' }); },
      read: ({ entryId }, { principalId } = {}) => (principalId === null ? null : rows.get(entryId) ?? null),
      clear: ({ entryId }) => { rows.delete(entryId); },
    };
  },
  createFailureChannel: (_r: Record<string, never>, o: { onPublish?: (input: { failure: UserFacingError }) => void } = {}): FailureChannel => {
    let snapshot: UserFacingError | null = null;
    let generation = 0;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((l) => l());
    return {
      publish: ({ failure, generation: g = generation }) => { if (g !== generation) return; snapshot = failure; notify(); o.onPublish?.({ failure }); },
      subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
      getSnapshot: () => snapshot, getGeneration: () => generation,
      reset: () => { generation += 1; snapshot = null; notify(); },
    };
  },
  resolveInitialActiveTabId: (r: { tabs: readonly { id: string }[] }, o: { initialTabId?: string | null | undefined } = {}) =>
    (o.initialTabId != null && r.tabs.some((tab) => tab.id === o.initialTabId) ? o.initialTabId : r.tabs[0]?.id ?? null),
  readableTextColor: ({ hex }: { hex: string }) => (hex.length > 4 ? 'black' : 'white'),
  canAcceptRefresh: (state: { timerPending: boolean; hasUnsavedEdits: boolean; mounted: boolean; commitsUnchanged: boolean }) => !state.timerPending && !state.hasUnsavedEdits && state.mounted && state.commitsUnchanged,
  mergeSaveStates: ({ states }: { states: readonly SaveState[] }): SaveState => states.find((state) => state.status === 'error') ?? states.find((state) => state.status === 'saving')
    ?? states.find((state) => state.status === 'saved') ?? { status: 'idle' },
  SAVE_DEBOUNCE_MS: 600,
  startVisibleInterval: ({ tick, periodMs }: { tick: () => void; periodMs: number }) => { const id = setInterval(tick, periodMs); return () => clearInterval(id); },
  findActiveTab: <T extends { id: string }>(r: { tabs: readonly T[]; activeTabId: string | null }) => r.tabs.find((tab) => tab.id === r.activeTabId),
  nextConfigForAgentSelect: ({ config, agentId }) => ({ ...config, localCli: { ...config.localCli, agentId } }),
  nextConfigForAgentModel: ({ config, agentId, model }) => ({ ...config, localCli: { ...config.localCli, modelByAgentId: { ...config.localCli.modelByAgentId, [agentId]: model } } }),
  nextConfigForAgentReasoning: ({ config, agentId, reasoning }) => ({ ...config, localCli: { ...config.localCli, reasoningByAgentId: { ...config.localCli.reasoningByAgentId, [agentId]: reasoning } } }),
  resolveSelectedPreset: ({ presets, config }) => presets.find((preset) => preset.id === config.providerId) ?? null,
  // A port with no key and no network: detection answers from the transport, a connection test never succeeds.
  createExecutionHttpAdapter: ({ transport }) => ({
    createPort: () => ({ detectLocalAgents: async () => (await transport.detectExecutionAgents({})).data, testConnection: async () => ({ ok: false, message: 'fake-kit' }) }),
    resetDetectionCache: () => {},
  }),
  requireExecutionResponseData: <T,>({ response, callSite }: { response: { data?: T | null } | null | undefined; callSite: string }): T => {
    if (response?.data == null) throw new Error(`${callSite}: the response carried no data`);
    return response.data;
  },
  // One attempt, no waiting: the delays are the host's.
  retryWhileUnreachable: ({ load }) => load(),
  createBrowserViewerClipboard: () => ({ copyText: async () => false }),
  folderPathsFromDataTransfer: ({ dataTransfer, port }) => Array.from(dataTransfer.files, (file) => port.getPathForFile(file)).filter((path) => path !== ''),
  findEditorBlockOpening: () => undefined,
  isEditorSourceError: ({ error }) => error instanceof Error && (error as { code?: unknown }).code === 'EDITOR_SOURCE_INTEGRITY',
  resolveAccentColor: ({ value }) => (typeof value === 'string' && value !== '' ? value : 'black'),
  normalizeAccentColor: ({ value }) => (typeof value === 'string' && value !== '' ? value : null),
  resolveSelectTriggerLabel: ({ selectedOption, placeholder }) => (selectedOption ? { text: selectedOption.label, className: 'fake-select-value' } : { text: placeholder ?? '', className: 'fake-select-placeholder' }),
  infoTipBubbleStyle: ({ top, left }) => ({ top, left }),
  renderMarkdownToSafeHtml: (markdown) => markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  sourceDisplayLabel: ({ source, fieldSpecs }) => source.label ?? source.fields[fieldSpecs[0]?.key ?? ''] ?? source.id,
};
const fakeValues: AdminKitValues = Object.freeze(fakeValuesDraft);

// Posters that never reach a server: a typed answer finds no pending question, a mid-run message finds no
// running agent, an A2UI action fails with a reason. A test that checks delivery injects its own factory.
const chatPassthroughTranslator = (key: string): string => key;
const fakeChat: AdminKitChat = {
  useT: () => chatPassthroughTranslator,
  createMidRunMessagePoster: () => async () => 'not-running',
  createTypedAnswerPoster: (required) => Object.assign(async () => 'not-pending' as const, { toolName: required.toolName }) satisfies KitDeliverTypedAnswer,
  createA2uiActionPoster: () => async () => ({ ok: false, reason: 'fake-kit' }),
  useFabPosition: () => ({ style: { right: 20, bottom: 20 }, onPointerDown: () => {}, consumeDragFlag: () => false, isDragging: false }),
  // Keeps an available requested agent, else falls back to the first available one; models pass through.
  resolveChatPaneSelection: ({ agents, requested }) => {
    const agent = agents.find((a) => a.id === requested.agentId && a.available !== false) ?? agents.find((a) => a.available !== false);
    return agent ? { ...requested, agentId: agent.id } : { agentId: '' };
  },
  conversationTitleForDisplay: ({ title, firstPrompt }) => title ?? firstPrompt ?? null,
  deriveConversationTitle: ({ prompt }) => prompt.slice(0, 40),
  mcpUiSurfaceSlotKey: ({ data }) => (typeof data === 'object' && data !== null && 'id' in data ? String((data as { id: unknown }).id) : undefined),
  midRunUserMessageSlotKey: ({ data }) => (typeof data === 'object' && data !== null && 'messageId' in data ? String((data as { messageId: unknown }).messageId) : undefined),
  MCP_UI_EXT_EVENT_NAME: 'fake-mcp-ui',
  MID_RUN_USER_MESSAGE_EXT_EVENT_NAME: 'fake-user-message',
  SECRET_REDACTED_NOTICE: 'fake secret-redacted notice',
  CREDENTIAL_CARD_GUIDANCE: 'fake credential-card guidance',
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
    values: { ...fakeValues, ...overrides.values },
    chat: { ...fakeChat, ...overrides.chat },
  } satisfies AdminKit;
}
