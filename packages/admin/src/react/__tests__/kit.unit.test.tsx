import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminKitProvider, Button, Icon, InfoTip, TabBar, type AdminKitChat, type KitIconName, useAdminKitChatPosters, useAdminKitValues, useAdminThemeKit, useChatT, useDirtyGuard, useFetchQuery, useMediaProviderRules, useT } from '../kit.js';
import {
  CodeWithLines, CodeWrapToggle, I18nProvider, PreviewModalShell, RemixIcon, SettingsDialogShell, Toast,
  useAdminKitChatValues, useCodeWrap, useCopyToClipboard, useFabPosition, useInfoTip, usePanelPosition, useSelectDropdown, useSerialWrites, useTabBarKeyboard,
  useTabbedDialog, useCursorPages, useDebouncedHtmlPreview, useExecutionCredential, useI18n, useSettingsSlice, useStandingDraftAutosave, useWiredCopyToClipboard,
  type AdminKit, type AdminKitHooks, type AdminKitValues, type ChatPaneAgent, type FabPositionInput,
} from '../kit.js';
import { fakeAdminKit, fixtureQuery } from '../testing-kit.js';
import { renderWithAdminKit } from './render-with-admin-kit.js';

describe('admin kit contract', () => {
  it('throws a plain-words error when a facade renders outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Button>x</Button>)).toThrow(/need <AdminKitProvider kit=/);
    spy.mockRestore();
  });

  it('keeps the first kit when the provider re-renders with another', () => {
    const second = vi.fn(() => <span>second</span>);
    const first = fakeAdminKit();
    const other = fakeAdminKit({ components: { Button: second } });
    const view = render(<AdminKitProvider kit={first}><Button>one</Button></AdminKitProvider>);
    view.rerender(<AdminKitProvider kit={other}><Button>one</Button></AdminKitProvider>);
    expect(second).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'one' })).toBeTruthy();
  });

  it('forwards props and the ref to the kit component', () => {
    const received = vi.fn();
    const kit = fakeAdminKit({ components: { Button: (p) => <button ref={p.ref} onClick={() => p.onPress?.({})}>{p.children}</button> } });
    const ref = createRef<HTMLButtonElement>();
    renderWithAdminKit(<Button ref={ref} onPress={received}>go</Button>, { kit });
    screen.getByRole('button', { name: 'go' }).click();
    expect(received).toHaveBeenCalledWith({});
    expect(ref.current).toBe(screen.getByRole('button', { name: 'go' }));
  });

  it('hook facades return the kit values', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdminKitProvider kit={fakeAdminKit({ query: fixtureQuery({ data: 'rows' }) })}>{children}</AdminKitProvider>
    );
    expect(renderHook(() => useDirtyGuard({ current: 1, original: 2 }), { wrapper }).result.current.isDirty).toBe(true);
    expect(renderHook(() => useFetchQuery({ key: ['a'], fetch: async () => 'x' }), { wrapper }).result.current.data).toBe('rows');
    expect(renderHook(() => useMediaProviderRules(), { wrapper }).result.current.maskedKeyLabel({ entry: undefined })).toBeNull();
    expect(renderHook(() => useAdminThemeKit(), { wrapper }).result.current.resolveColorScheme({ preference: 'dark' })).toBe('dark');
  });
});


it('uses an injected kit and forwards the original button ref without the hook prop', () => {
  const received = vi.fn();
  const kit = fakeAdminKit({ components: { Button: (props) => {
    received(props);
    return <button ref={props.ref}>{props.children}</button>;
  } } });
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref} useAdminKitHook={() => kit}>Injected button</Button>);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Injected button' }));
  expect(received.mock.calls[0]![0]).not.toHaveProperty('useAdminKitHook');
});

describe('admin kit: UI icon, UI translator and injected values (A-K2-0a)', () => {
  it('renders the injected Icon with the props the screen passes, through the provider', () => {
    const received = vi.fn();
    const kit = fakeAdminKit({ components: { Icon: (props) => {
      received(props);
      return <svg role="img" aria-label={props['aria-label']} data-icon={props.name} />;
    } } });
    renderWithAdminKit(<Icon name="play" size={18} aria-label="Video file" />, { kit });
    expect(screen.getByRole('img', { name: 'Video file' }).getAttribute('data-icon')).toBe('play');
    // The slot always hands the implementation a `ref` (null here); every screen prop arrives unchanged.
    expect(received).toHaveBeenCalledWith({ name: 'play', size: 18, 'aria-label': 'Video file', ref: null });
  });

  it('the useT facade returns the UI translator the host injected', () => {
    const uiTranslator = (key: string) => `ui-sentinel:${key}`;
    const kit = fakeAdminKit({ hooks: { useT: () => uiTranslator } });
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
    const t = renderHook(() => useT(), { wrapper }).result.current;
    expect(t).toBe(uiTranslator);
    expect(t('Save')).toBe('ui-sentinel:Save');
  });

  it('routes the glyphs the migrating admin screens render through the injected Icon', () => {
    // Database, import-export, library, media and skills screens render these once they import the kit Icon.
    const names = [
      'timeline', 'migrate-forward', 'tray-export', 'tray-import', 'more-horizontal-outline', 'tray-upload', 'document-lines',
      'tiles-four', 'picture-frame', 'video-frame', 'cloud-outline', 'bin-lidded', 'document-marked',
    ] as const satisfies readonly KitIconName[];
    const kit = fakeAdminKit({ components: { Icon: (props) => <svg role="img" aria-label={props.name} data-icon={props.name} /> } });
    renderWithAdminKit(<>{names.map((name) => <Icon key={name} name={name} />)}</>, { kit });
    expect(screen.getAllByRole('img').map((el) => el.getAttribute('data-icon'))).toEqual([...names]);
  });

  it('the useT and values facades take empty required/optional objects and still return the injected objects', () => {
    const uiTranslator = (key: string, vars?: Readonly<Record<string, string | number>>) => `${key}:${vars?.n ?? ''}`;
    const kit = fakeAdminKit({ hooks: { useT: () => uiTranslator } });
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
    const read = renderHook(() => ({ t: useT({}, {}), values: useAdminKitValues({}, {}), bare: useAdminKitValues() }), { wrapper }).result.current;
    expect(read.t).toBe(uiTranslator);
    expect(read.t('Count', { n: 2 })).toBe('Count:2');
    expect(read.values).toBe(kit.values);
    expect(read.bare).toBe(kit.values);
  });

  it('hands screens the exact injected values, not copies', () => {
    const values = {
      SETTINGS_DIALOG_DICTIONARIES: { en: { Save: 'Save' } },
      DEFAULT_NOTIFICATIONS_PREFERENCES: { soundEnabled: false, successSoundId: 'ding', failureSoundId: 'buzz', desktopEnabled: false },
      UNREACHABLE_RETRY_DELAYS_MS: [1_000, 2_000],
      LOCAL_BACKUP_PRINCIPAL_ID: 'local-tab-backup',
    };
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({ values })}>{children}</AdminKitProvider>;
    const read = renderHook(() => useAdminKitValues(), { wrapper }).result.current;
    expect(read.SETTINGS_DIALOG_DICTIONARIES).toBe(values.SETTINGS_DIALOG_DICTIONARIES);
    expect(read.DEFAULT_NOTIFICATIONS_PREFERENCES).toBe(values.DEFAULT_NOTIFICATIONS_PREFERENCES);
    expect(read.UNREACHABLE_RETRY_DELAYS_MS).toBe(values.UNREACHABLE_RETRY_DELAYS_MS);
    expect(read.LOCAL_BACKUP_PRINCIPAL_ID).toBe('local-tab-backup');
  });
});

describe('admin kit: chat translator and run posters (A-K2-0b)', () => {
  it('keeps the UI and chat translators distinct: each facade returns its own injected sentinel', () => {
    const kit = fakeAdminKit({ hooks: { useT: () => (key: string) => `ui-sentinel:${key}` }, chat: { useT: () => (key: string) => `chat-sentinel:${key}` } });
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
    expect(renderHook(() => useChatT(), { wrapper }).result.current('Stop')).toBe('chat-sentinel:Stop');
    expect(renderHook(() => useT(), { wrapper }).result.current('Stop')).toBe('ui-sentinel:Stop');
    expect(renderHook(() => useChatT({}, {}), { wrapper }).result.current('Send')).toBe('chat-sentinel:Send');
  });

  it('hands each poster factory both argument objects intact, and returns its poster unchanged', () => {
    const typed = Object.assign(async () => 'delivered' as const, { toolName: 'ask-choice' });
    const midRun = async () => 'delivered' as const;
    const a2ui = async () => ({ ok: true }) as const;
    const chat: Partial<AdminKitChat> = {
      createTypedAnswerPoster: vi.fn(() => typed),
      createMidRunMessagePoster: vi.fn(() => midRun),
      createA2uiActionPoster: vi.fn(() => a2ui),
    };
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({ chat })}>{children}</AdminKitProvider>;
    const posters = renderHook(() => useAdminKitChatPosters(), { wrapper }).result.current;
    const onSecretRedacted = () => {};
    const reportFailure = () => {};
    const typedRequired = { baseUrl: '', fetch: globalThis.fetch, toolName: 'ask-choice' };
    const typedOptional = { path: '/host/tool-calls', onSecretRedacted };
    expect(posters.createTypedAnswerPoster(typedRequired, typedOptional)).toBe(typed);
    expect(chat.createTypedAnswerPoster).toHaveBeenCalledWith(typedRequired, typedOptional);
    const midRequired = { baseUrl: '', fetch: globalThis.fetch };
    const midOptional = { onSecretRedacted };
    expect(posters.createMidRunMessagePoster(midRequired, midOptional)).toBe(midRun);
    expect(chat.createMidRunMessagePoster).toHaveBeenCalledWith(midRequired, midOptional);
    const a2uiRequired = { baseUrl: '', path: '/host/a2ui', fetch: globalThis.fetch, reportFailure };
    const a2uiOptional = { timeoutMs: 5 };
    expect(posters.createA2uiActionPoster(a2uiRequired, a2uiOptional)).toBe(a2ui);
    expect(chat.createA2uiActionPoster).toHaveBeenCalledWith(a2uiRequired, a2uiOptional);
    expect(vi.mocked(chat.createA2uiActionPoster!).mock.calls[0]![0]).toBe(a2uiRequired);
  });

  it('passes the TabBar tab disabled/dot/dotLabel fields through to the injected TabBar', () => {
    const seen: unknown[] = [];
    const kit = fakeAdminKit({ components: { TabBar: (props) => { seen.push(...props.tabs); return <div role="tablist" aria-label={props.ariaLabel} />; } } });
    const tabs = [{ id: 'a', label: 'A', dot: true, dotLabel: 'Unsaved changes' }, { id: 'b', label: 'B', disabled: true }];
    renderWithAdminKit(<TabBar tabs={tabs} activeId="a" onChange={() => {}} ariaLabel="Sections" />, { kit });
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    expect(seen).toEqual(tabs);
  });
});

describe('admin kit: B5 additions (A-K2-0a remainder + A-K2-0.J)', () => {
  const wrap = (kit: AdminKit) => ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;

  it('renders each new UI component through the provider with the props the screen passes', () => {
    const seen: Record<string, unknown> = {};
    const record = (name: string) => (props: object) => { seen[name] = props; return <span data-testid={name}>{(props as { children?: ReactNode }).children}</span>; };
    const kit = fakeAdminKit({ components: {
      RemixIcon: record('RemixIcon'), Toast: record('Toast'), I18nProvider: record('I18nProvider'), SettingsDialogShell: record('SettingsDialogShell'),
      CodeWithLines: record('CodeWithLines'), CodeWrapToggle: record('CodeWrapToggle'), PreviewModalShell: record('PreviewModalShell'),
    } });
    const onDismiss = () => {};
    const onToggle = () => {};
    const onClose = () => {};
    const t = (key: string) => key;
    const tabs = [{ id: 'general', label: 'General', panel: <p>panel</p> }];
    const views = [{ id: 'source', label: 'Source', custom: <p>code</p> }];
    const icons = { 'fullscreen-exit': () => <i /> };
    renderWithAdminKit(
      <I18nProvider initialLocale="en" fallbackLocale="en" syncDocumentAttributes={false}>
        <RemixIcon name="group-line" size={16} />
        <Toast message="Saved" role="status" tone="success" ttlMs={5000} onDismiss={onDismiss} />
        <SettingsDialogShell tabs={tabs} presentation="inline" fullscreenEnabled={false} />
        <CodeWithLines text={'a\nb'} wrap />
        <CodeWrapToggle wrap={false} onToggle={onToggle} t={t} agentHandleId="wrap-toggle" />
        <PreviewModalShell title="theme.html" views={views} onClose={onClose} icons={icons} />
      </I18nProvider>, { kit });
    expect(screen.getByTestId('I18nProvider')).toBeTruthy();
    expect(seen.RemixIcon).toEqual({ name: 'group-line', size: 16, ref: null });
    expect(seen.Toast).toEqual({ message: 'Saved', role: 'status', tone: 'success', ttlMs: 5000, onDismiss, ref: null });
    expect(seen.SettingsDialogShell).toEqual({ tabs, presentation: 'inline', fullscreenEnabled: false, ref: null });
    expect(seen.CodeWithLines).toEqual({ text: 'a\nb', wrap: true, ref: null });
    expect(seen.CodeWrapToggle).toEqual({ wrap: false, onToggle, t, agentHandleId: 'wrap-toggle', ref: null });
    expect(seen.PreviewModalShell).toEqual({ title: 'theme.html', views, onClose, icons, ref: null });
    expect((seen.I18nProvider as { initialLocale: string }).initialLocale).toBe('en');
  });

  it('each new UI hook facade returns the injected sentinel and passes both argument objects through', () => {
    const sentinels = {
      useTabBarKeyboard: { onKeyDown: () => {} }, useSerialWrites: { run: async <T,>({ task }: { task: () => Promise<T> }) => task() },
      useCodeWrap: { wrap: true, toggleWrap: () => {} },
    };
    const useInfoTipImpl = vi.fn(() => 'info-tip-sentinel' as unknown as ReturnType<AdminKitHooks['useInfoTip']>);
    const usePanelPositionImpl = vi.fn(() => 'panel-sentinel' as unknown as ReturnType<AdminKitHooks['usePanelPosition']>);
    const useSelectDropdownImpl = vi.fn(() => 'dropdown-sentinel' as unknown as ReturnType<AdminKitHooks['useSelectDropdown']>);
    const useTabBarKeyboardImpl = vi.fn(() => sentinels.useTabBarKeyboard);
    const kit = fakeAdminKit({ hooks: {
      useTabBarKeyboard: useTabBarKeyboardImpl, useSerialWrites: () => sentinels.useSerialWrites, useCodeWrap: () => sentinels.useCodeWrap,
      useInfoTip: useInfoTipImpl, usePanelPosition: usePanelPositionImpl, useSelectDropdown: useSelectDropdownImpl,
    } });
    const tabBarArgs = { tabs: [{ id: 'a', label: 'A' }], activeId: 'a', onChange: () => {} };
    const panelArgs = { open: true, triggerRef: createRef<HTMLButtonElement>(), panelRef: createRef<HTMLDivElement>(),
      searchInputRef: createRef<HTMLInputElement>(), showSearch: false, onOutOfView: () => {} };
    const dropdownArgs = { value: 'b', onChange: () => {}, options: [{ value: 'b', label: 'B', group: 'Pages' }] };
    const read = renderHook(() => ({
      tabBar: useTabBarKeyboard(tabBarArgs, {}), serial: useSerialWrites(), codeWrap: useCodeWrap({}, {}),
      infoTip: useInfoTip({}, { placement: 'bottom' }), panel: usePanelPosition(panelArgs, {}), dropdown: useSelectDropdown(dropdownArgs, { disabled: true }),
    }), { wrapper: wrap(kit) }).result.current;
    expect(read.tabBar).toBe(sentinels.useTabBarKeyboard);
    expect(read.serial).toBe(sentinels.useSerialWrites);
    expect(read.codeWrap).toBe(sentinels.useCodeWrap);
    expect(read.infoTip).toBe('info-tip-sentinel');
    expect(read.panel).toBe('panel-sentinel');
    expect(read.dropdown).toBe('dropdown-sentinel');
    expect(useTabBarKeyboardImpl).toHaveBeenCalledWith(tabBarArgs, {});
    expect(useInfoTipImpl).toHaveBeenCalledWith({}, { placement: 'bottom' });
    expect(usePanelPositionImpl).toHaveBeenCalledWith(panelArgs, {});
    expect(useSelectDropdownImpl).toHaveBeenCalledWith(dropdownArgs, { disabled: true });
  });

  it('the tabbed-dialog and copy facades return the injected controller and pass every argument through', () => {
    const tabbed = { activeTabId: 'a', setActiveTabId: () => {} };
    const copier = { copied: false, copy: async () => true };
    const useTabbedDialogImpl = vi.fn(() => tabbed);
    const useCopyToClipboardImpl = vi.fn(() => copier);
    const kit = fakeAdminKit({ hooks: { useTabbedDialog: useTabbedDialogImpl, useCopyToClipboard: useCopyToClipboardImpl } });
    const tabArgs = { tabs: [{ id: 'a', label: 'A', panel: null }], initialActiveTabId: 'a' };
    const clipboard = { copyText: async () => true };
    const read = renderHook(() => ({ tabbed: useTabbedDialog(tabArgs, {}), copier: useCopyToClipboard(clipboard, 25) }), { wrapper: wrap(kit) }).result.current;
    expect(read.tabbed).toBe(tabbed);
    expect(read.copier).toBe(copier);
    expect(useTabbedDialogImpl).toHaveBeenCalledWith(tabArgs, {});
    expect(useCopyToClipboardImpl).toHaveBeenCalledWith(clipboard, 25);
  });

  it('the values reader hands back the injected UI functions by identity', () => {
    const values: Partial<AdminKitValues> = {
      buildSandboxProxyDataUrl: () => 'data:sentinel', openLightboxDialog: () => {}, closeLightboxDialog: () => {},
      resolveTabBarTabIndex: () => 0, hasPermission: () => true, standingDraftRecoveryMessage: () => 'recover',
      createStandingDraftLocalBackup: () => ({ write: () => {}, read: () => null, clear: () => {} }),
      createFailureChannel: () => ({ publish: () => {}, subscribe: () => () => {}, getSnapshot: () => null, getGeneration: () => 0, reset: () => {} }),
      resolveInitialActiveTabId: () => 'a', findActiveTab: () => undefined,
    };
    const read = renderHook(() => useAdminKitValues(), { wrapper: wrap(fakeAdminKit({ values })) }).result.current;
    for (const name of Object.keys(values) as (keyof AdminKitValues)[]) expect(read[name]).toBe(values[name]);
  });

  it('the fake values behave like the host ones: failure channel drops stale publishes, the backup skips a null principal', () => {
    const values = renderHook(() => useAdminKitValues(), { wrapper: wrap(fakeAdminKit()) }).result.current;
    const channel = values.createFailureChannel({}, {});
    const stale = channel.getGeneration();
    channel.reset();
    channel.publish({ failure: { message: 'old' } as never, generation: stale });
    expect(channel.getSnapshot()).toBeNull();
    const backup = values.createStandingDraftLocalBackup({ keyPrefix: 'k.', getStorage: () => localStorage }, {});
    const draft = { bodyFormat: 'html' as const, bodyHtml: '<p>x</p>', title: 'T', slug: 't', baseVersion: 1 };
    backup.write({ entryId: 'e', draft, savedAt: 'now' }, { principalId: null });
    expect(backup.read({ entryId: 'e' })).toBeNull();
    backup.write({ entryId: 'e', draft, savedAt: 'now' });
    expect(backup.read({ entryId: 'e' })).toMatchObject({ title: 'T', savedAt: 'now' });
  });

  it('useFabPosition forwards its input to the injected chat hook; the chat values reader returns the injected chat group', () => {
    const fab = { style: { right: 1, bottom: 2 }, onPointerDown: () => {}, consumeDragFlag: () => true, isDragging: false };
    const useFabPositionImpl = vi.fn(() => fab);
    const resolveChatPaneSelection = vi.fn(() => ({ agentId: 'claude', model: 'm' }));
    const kit = fakeAdminKit({ chat: { useFabPosition: useFabPositionImpl, resolveChatPaneSelection, SECRET_REDACTED_NOTICE: 'redacted-sentinel', CREDENTIAL_CARD_GUIDANCE: 'guidance-sentinel' } });
    const input: FabPositionInput = { dockOpen: false, avoidBottomPx: 0, storageKey: 'fab', storage: localStorage, viewport: window,
      pointerEvents: document, edgeMargin: 20, sizePx: 56, dragThresholdPx: 5 };
    const read = renderHook(() => ({ fab: useFabPosition(input, {}), chat: useAdminKitChatValues() }), { wrapper: wrap(kit) }).result.current;
    expect(read.fab).toBe(fab);
    expect(useFabPositionImpl).toHaveBeenCalledWith(input, {});
    expect(read.chat).toBe(kit.chat);
    expect(read.chat.SECRET_REDACTED_NOTICE).toBe('redacted-sentinel');
    expect(read.chat.CREDENTIAL_CARD_GUIDANCE).toBe('guidance-sentinel');
    const agents: ChatPaneAgent[] = [{ id: 'claude', name: 'Claude' }];
    expect(read.chat.resolveChatPaneSelection({ agents, requested: { agentId: 'claude' } })).toEqual({ agentId: 'claude', model: 'm' });
    expect(resolveChatPaneSelection).toHaveBeenCalledWith({ agents, requested: { agentId: 'claude' } });
  });
});

it('passes the InfoTip placement, icon, trigger label and description id through to the injected InfoTip', () => {
  const seen: unknown[] = [];
  const kit = fakeAdminKit({ components: { InfoTip: (props) => { seen.push(props); return <span role="note">{props.label}</span>; } } });
  const icon = <svg data-testid="tip-icon" />;
  renderWithAdminKit(<InfoTip label="Runs locally" placement="bottom" icon={icon} triggerLabel="About runs" descriptionId="run-desc" />, { kit });
  expect(screen.getByRole('note').textContent).toBe('Runs locally');
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ label: 'Runs locally', placement: 'bottom', icon, triggerLabel: 'About runs', descriptionId: 'run-desc' });
});

describe('admin kit: settings-slice values, visible interval and chat title/slot values (A-K2-0 batch 2)', () => {
  it('hands screens the exact injected functions and constants, not copies', () => {
    const readableTextColor = vi.fn(() => 'x');
    const mergeSaveStates = vi.fn(() => ({ status: 'saved' as const }));
    const canAcceptRefresh = vi.fn(() => false);
    const startVisibleInterval = vi.fn(() => () => {});
    const values = { ...fakeAdminKit().values, readableTextColor, mergeSaveStates, canAcceptRefresh, startVisibleInterval, SAVE_DEBOUNCE_MS: 5 };
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({ values })}>{children}</AdminKitProvider>;
    const got = renderHook(() => useAdminKitValues({}, {}), { wrapper }).result.current;
    expect(got.readableTextColor({ hex: 'fff' })).toBe('x');
    expect(readableTextColor).toHaveBeenCalledWith({ hex: 'fff' });
    expect(got.mergeSaveStates({ states: [] })).toEqual({ status: 'saved' });
    expect(got.canAcceptRefresh({ timerPending: false, hasUnsavedEdits: false, mounted: true, commitsUnchanged: true })).toBe(false);
    got.startVisibleInterval({ tick: () => {}, periodMs: 10 });
    expect(startVisibleInterval).toHaveBeenCalledOnce();
    expect(got.SAVE_DEBOUNCE_MS).toBe(5);
  });

  it('chat values facade returns the injected title, slot-key functions and ext-event names', () => {
    const deriveConversationTitle = vi.fn(() => 'derived');
    const chat = { ...fakeAdminKit().chat, deriveConversationTitle, MCP_UI_EXT_EVENT_NAME: 'mcp-x', MID_RUN_USER_MESSAGE_EXT_EVENT_NAME: 'mid-x' };
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={fakeAdminKit({ chat })}>{children}</AdminKitProvider>;
    const got = renderHook(() => useAdminKitChatValues({}, {}), { wrapper }).result.current;
    expect(got.deriveConversationTitle({ prompt: 'p' })).toBe('derived');
    expect(deriveConversationTitle).toHaveBeenCalledWith({ prompt: 'p' });
    expect(got.conversationTitleForDisplay({ title: null, titleSource: 'fallback', firstPrompt: 'first' })).toBe('first');
    expect(got.mcpUiSurfaceSlotKey({ data: { id: 'a' } })).toBe('a');
    expect(got.midRunUserMessageSlotKey({ data: {} })).toBeUndefined();
    expect([got.MCP_UI_EXT_EVENT_NAME, got.MID_RUN_USER_MESSAGE_EXT_EVENT_NAME]).toEqual(['mcp-x', 'mid-x']);
  });
});

describe('admin kit: execution, settings-slice and editor hooks and values (A-K2-0 batch 3)', () => {
  const wrap = (kit: AdminKit) => ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;

  it('each new hook facade forwards its arguments to the injected hook and returns its result unchanged', () => {
    const useSettingsSliceSpy = vi.fn(() => ({ value: 7, loadError: null, saveState: { status: 'idle' as const }, onChange: () => {}, refresh: async () => {} }));
    const useWiredCopySpy = vi.fn(() => ({ copied: true, copy: async () => true }));
    const useI18nSpy = vi.fn(() => ({ locale: 'fr', setLocale: () => {}, t: (key: string) => key }));
    const kit = fakeAdminKit({ hooks: { useSettingsSlice: useSettingsSliceSpy as unknown as AdminKitHooks['useSettingsSlice'], useWiredCopyToClipboard: useWiredCopySpy, useI18n: useI18nSpy } });
    const options = { load: async () => 1, save: async () => [], defaultValue: 1, refreshPort: { publish: () => {}, subscribe: () => () => {} } };
    expect(renderHook(() => useSettingsSlice(options), { wrapper: wrap(kit) }).result.current.value).toBe(7);
    expect(useSettingsSliceSpy).toHaveBeenCalledWith(options);
    expect(renderHook(() => useWiredCopyToClipboard(250), { wrapper: wrap(kit) }).result.current.copied).toBe(true);
    expect(useWiredCopySpy).toHaveBeenCalledWith(250);
    expect(renderHook(() => useI18n(), { wrapper: wrap(kit) }).result.current.locale).toBe('fr');
  });

  it('the fake kit hooks behave like a quiet host: slice holds its default, preview echoes the source, i18n is English', () => {
    const wrapper = wrap(fakeAdminKit());
    const slice = renderHook(() => useSettingsSlice({ load: async () => 'a', save: async () => [], defaultValue: 'a', refreshPort: { publish: () => {}, subscribe: () => () => {} } }), { wrapper });
    expect(slice.result.current.value).toBe('a');
    expect(renderHook(() => useDebouncedHtmlPreview({ source: '<p>x</p>', render: async () => '' }), { wrapper }).result.current).toEqual({ document: '<p>x</p>', loading: false, error: null });
    expect(renderHook(() => useI18n(), { wrapper }).result.current.locale).toBe('en');
    const draft = renderHook(() => useStandingDraftAutosave({ port: {} as never, backup: {} as never, entryId: null, enabled: false }), { wrapper }).result.current;
    expect(draft.recoverableDraft).toBeNull();
    expect(renderHook(() => useExecutionCredential({ byok: {} as never, onByokChange: () => {}, port: {} as never, effects: {} as never }), { wrapper }).result.current.canSaveKey).toBe(false);
  });

  it('the fake cursor pages load the first page for the initial filters and refetch when the filters change', async () => {
    const fetchPage = vi.fn(async ({ filters }: { filters: string }) => ({ items: [filters], nextCursor: null }));
    const view = renderHook(() => useCursorPages({ key: ({ filters }) => ['k', filters], fetchPage, initialFilters: 'a' }), { wrapper: wrap(fakeAdminKit()) });
    await waitFor(() => expect(view.result.current.rows).toEqual(['a']));
    act(() => view.result.current.applyFilters('b'));
    await waitFor(() => expect(view.result.current.rows).toEqual(['b']));
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('the fake values behave like the host ones for config writers, preset lookup, response guard, accent and markdown', () => {
    const v = fakeAdminKit().values;
    const config = { mode: 'local-cli' as const, byok: { protocol: 'openai' as const, providerId: 'p1', apiKey: '', baseUrl: '', model: '' }, localCli: { agentId: null } };
    expect(v.nextConfigForAgentSelect({ config, agentId: 'a' }).localCli.agentId).toBe('a');
    expect(v.nextConfigForAgentModel({ config, agentId: 'a', model: 'm' }).localCli.modelByAgentId).toEqual({ a: 'm' });
    expect(v.nextConfigForAgentReasoning({ config, agentId: 'a', reasoning: 'high' }).localCli.reasoningByAgentId).toEqual({ a: 'high' });
    expect(v.resolveSelectedPreset({ presets: [], config: config.byok })).toBeNull();
    expect(v.requireExecutionResponseData({ response: { data: 5 }, callSite: 'x' })).toBe(5);
    expect(() => v.requireExecutionResponseData({ response: null, callSite: 'loadThing' })).toThrow(/loadThing/);
    expect(v.normalizeAccentColor({ value: 3 })).toBeNull();
    expect(v.resolveAccentColor({ value: 3 })).toBe('black');
    expect(v.renderMarkdownToSafeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(v.sourceDisplayLabel({ source: { id: 'i', fields: { url: 'u' } }, fieldSpecs: [{ key: 'url', label: 'U', kind: 'url' }] })).toBe('u');
    expect(v.isEditorSourceError({ error: new Error('x') })).toBe(false);
    expect(v.resolveSelectTriggerLabel({ selectedOption: null, placeholder: 'pick' }).text).toBe('pick');
  });

  it('the fake retry makes one attempt and the fake folder-drop maps files through the host port', async () => {
    const v = fakeAdminKit().values;
    const load = vi.fn(async () => 'ok');
    await expect(v.retryWhileUnreachable({ load, signal: new AbortController().signal, isUnreachable: () => true })).resolves.toBe('ok');
    expect(load).toHaveBeenCalledOnce();
    const file = new File(['x'], 'a.txt');
    expect(v.folderPathsFromDataTransfer({ dataTransfer: { files: [file] } as unknown as DataTransfer, port: { getPathForFile: () => '/p' } })).toEqual(['/p']);
  });
});
