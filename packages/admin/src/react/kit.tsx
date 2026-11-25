/**
 * @file The UI contract every @jini-ai/admin React screen renders through. Admin imports no UI
 * package (owner 2026-11-15: everything injected): it states the primitives, hooks, fetch-query
 * and theme functions it needs, with only the props it passes, and the host supplies them once via
 * <AdminKitProvider kit={...}>. Shapes are local copies so this package's published types pin no
 * UI library; the host proves compatibility with `const kit = {...} satisfies AdminKit`, so a UI
 * library prop change fails the host's typecheck at that line.
 *
 * Hook slots are only legal because the provider keeps the FIRST kit it receives: a kit whose hooks
 * changed identity between renders would break React's hook order (same rule as fetch-query's
 * FetchQueryBinding, "keep the adapter fixed for this provider's lifetime").
 */
import { createContext, forwardRef, useContext, useState } from 'react';
import type { ComponentProps, ComponentType, CSSProperties, Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent,
  ReactElement, ReactNode, Ref, RefObject, SetStateAction, SyntheticEvent } from 'react';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';
import type { Translate } from '@jini-ai/core/text';
import type { MediaProviderCatalogPolicy, MediaProviderOption } from '@jini-ai/core';
import type { UserFacingError } from '@jini-ai/core';
import type { AdminMediaProvidersKit } from './kit-media-providers.js';
import type { AdminSurfaceProtocolKit } from './kit-admin-surfaces.js';
import type { AdminPluginProviderSettingField } from '../screens/plugins/api/plugins-api.types.js';
import type { ByokConfig, ExecutionConfig } from '@jini-ai/core/contracts/execution';
import type { CreateExecutionPortOptions, CursorPages, ExecutionCredentialController, ExecutionCredentialEffects, ExecutionCredentialPort, ExecutionCredentialView,
  ExecutionProbeTransport, FolderPathDropPort, HtmlPreviewPort, HtmlPreviewState, KitSaveState, SettingsSlice, SettingsSliceOptions, SourceConfigItem, SourceFieldSpec,
  UseExecutionCredentialInput, SecretInputProps, SeeMoreProps, SearchableModelSelectProps, PackageFileTreeController, PackageFileTreeInput, FileDropzoneProps } from './kit-ui-types.js';
import type { ExecutionPort, ProviderPreset } from '@jini-ai/core/contracts/execution';
import type { QueryKey } from '@jini-ai/core/fetch';

/* ---------- shared shapes (local; structurally equal to the host kit's) ---------- */
/** Opaque host metadata; implementations spread it onto the documented focus target. */
export type KitAttrs = Readonly<{ id?: string; 'data-jini-part'?: string }>
  & Readonly<Partial<Record<`data-${string}` | `aria-${string}`, string | number | boolean | undefined>>>;
/** The host owns handle validation and its agent runtime. */
export type AgentAttrsPort = (required: { handle: string }, optional?: { role?: 'button' | 'field' | 'select'; label?: string }) => KitAttrs;
type Action = (required: Record<string, never>, optional?: Record<string, never>) => void;
type ValuePort<T> = (required: { value: T }, optional?: Record<string, never>) => void;
type Tone = 'info' | 'success' | 'warning' | 'danger';
interface Base { readonly attrs?: KitAttrs; readonly className?: string; readonly agentHandle?: string | false }

/* ---------- component props: only what admin passes ---------- */
export interface ButtonProps extends Base {
  readonly children?: ReactNode; readonly onPress?: Action; readonly disabled?: boolean; readonly pending?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost'; readonly type?: 'button' | 'submit' | 'reset';
  readonly ref?: Ref<HTMLButtonElement>;
}
export interface IconButtonProps extends ButtonProps { readonly label: string }
export interface TextFieldProps extends Base {
  readonly label: string; readonly value: string; readonly onValueChange: ValuePort<string>;
  readonly disabled?: boolean; readonly required?: boolean; readonly placeholder?: string;
  readonly type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel' | 'number'; readonly ref?: Ref<HTMLInputElement>;
}
export interface TextAreaProps extends Base {
  readonly label: string; readonly value: string; readonly onValueChange: ValuePort<string>;
  readonly disabled?: boolean; readonly rows?: number; readonly ref?: Ref<HTMLTextAreaElement>;
}
export interface SelectOption { readonly value: string; readonly label: string; readonly disabled?: boolean }
export interface SelectProps extends Base {
  readonly label: string; readonly value: string; readonly options: readonly SelectOption[];
  readonly onValueChange: ValuePort<string>; readonly disabled?: boolean; readonly ref?: Ref<HTMLSelectElement>;
}
export interface SwitchProps extends Base {
  readonly label: string; readonly checked: boolean; readonly disabled?: boolean;
  readonly onCheckedChange: (required: { checked: boolean }, optional?: Record<string, never>) => void;
}
export interface DialogProps extends Base {
  readonly open: boolean; readonly title: string; readonly children?: ReactNode; readonly onClose: Action;
  readonly pending?: boolean; readonly closeLabel?: string; readonly ref?: Ref<HTMLDialogElement>;
}
export type KitConfirmTone = 'default' | 'warning' | 'danger';
/** The host kit's confirm dialog. Admin's own ConfirmDialog (components/ConfirmDialog) is separate. */
export interface KitConfirmDialogProps extends Base {
  readonly open: boolean; readonly title: string; readonly confirmLabel: string; readonly cancelLabel?: string;
  readonly tone?: KitConfirmTone; readonly pending?: boolean; readonly consequence?: string; readonly agentMayConfirm?: boolean;
  readonly body?: ReactNode; readonly errorLabel?: string;
  readonly onConfirm: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
  readonly onCancel: Action;
  readonly actionAccessibleNames?: { readonly cancel: string; readonly confirm: string };
}
export interface TabItem { readonly id: string; readonly label: string; readonly content: ReactNode; readonly disabled?: boolean; readonly attrs?: KitAttrs }
export interface TabsProps extends Base { readonly label: string; readonly value: string; readonly items: readonly TabItem[]; readonly onValueChange: ValuePort<string> }
export interface MenuItem { readonly id: string; readonly label: string; readonly disabled?: boolean; readonly onPress: Action; readonly attrs?: KitAttrs }
export interface MenuProps extends Base { readonly label: string; readonly items: readonly MenuItem[]; readonly disabled?: boolean }
export interface NoticeProps extends Base { readonly children: ReactNode; readonly tone?: Tone }
export interface SpinnerProps extends Base { readonly label?: string }
export interface BadgeProps extends Base { readonly children: ReactNode; readonly tone?: Tone }
export interface InfoTipProps {
  label: string; agentHandle?: string | false | undefined;
  /** The trigger's accessible name when it differs from the tip text; `descriptionId` ties the tip to a described control. */
  triggerLabel?: string | undefined; descriptionId?: string | undefined;
  placement?: 'top' | 'bottom' | 'inline' | undefined; icon?: ReactNode | undefined;
  /** Replaces the tip's own controller (e.g. a padlock whose press follows a link instead of pinning the tip). */
  useTip?: ((required?: Record<string, never>, optional?: { placement?: 'top' | 'bottom' | undefined }) => InfoTipController) | undefined;
}
type LightboxPart = 'dialog' | 'close' | 'previous' | 'next';
export interface LightboxProps {
  open: boolean; title: string; onClose: () => void; children?: ReactNode;
  index?: number | undefined; count?: number | undefined; onNavigate?: ((index: number) => void) | undefined;
  labels?: Partial<Record<'close' | 'previous' | 'next', string>> | undefined; className?: string | undefined;
  partAttrs?: Partial<Record<LightboxPart, Record<string, string>>> | undefined;
}
/** Option rows for the searchable listbox; `group` runs must arrive ordered. */
export interface WidgetSelectOption { value: string; label: string; group?: string | undefined; badge?: string | undefined; detail?: string | undefined }
export interface WidgetSelectProps {
  value: string; onChange: (value: string) => void; options: WidgetSelectOption[];
  placeholder?: string | undefined; id?: string | undefined; 'aria-label'?: string | undefined;
  disabled?: boolean | undefined; agentHandle?: string | false | undefined; translate?: Translate | undefined;
}
/** `disabled` greys the tab out of the tab order; `dot` marks it (e.g. unsaved or failing), with `dotLabel` as the dot's accessible name. */
export interface TabBarTab {
  readonly id: string; readonly label: string; readonly icon?: ReactNode | undefined; readonly count?: number | undefined; readonly tag?: string | undefined;
  readonly disabled?: boolean | undefined; readonly handle?: string | undefined; readonly handleLabel?: string | undefined;
  readonly dot?: boolean | undefined; readonly dotLabel?: string | undefined;
}
export interface TabBarProps { tabs: readonly TabBarTab[]; activeId: string; onChange: (id: string) => void; ariaLabel: string; containerHandle?: string | undefined }
export interface CanvasEmbedPlaceholderDescriptor { kindLabel: string; identityLabel: string }
export interface CanvasContentWrapperNode { tagName: string; attributes?: Readonly<Record<string, string>> }
export interface CanvasStyling {
  adminTheme?: AdminTheme; colorScheme?: ColorScheme; stylesheets?: readonly string[]; css?: string;
  contentWrapper?: readonly CanvasContentWrapperNode[];
}
/** `flush()` before save/unmount syncs an open rich-text session's pending edit into onChange. */
export interface InteractiveHtmlEditorHandle { flush(): Promise<string | undefined> }
/** Which source element a protected block stands for: its tag, optional id, and occurrence among matches. */
export interface HtmlEditorTarget { occurrenceIndex: number; tagName: string; id?: string }
/** Structural mirror of the editor's options, so a host's editor keeps its HTML-source and error callbacks. */
export interface HtmlEditorProps {
  html: string; onChange: (html: string) => void; className?: string; canvasStyling?: CanvasStyling;
  isProtectedElement?: (el: Element) => boolean;
  describeEmbedPlaceholder?: (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined;
  /** Opens the HTML source for a block the canvas cannot edit visually. */
  onRequestEditHtml?: ((target: HtmlEditorTarget, options: object) => void | Promise<void>) | undefined;
  /** Called when a visual edit cannot be written back to the source (the error carries a `code`). */
  onSerializationError?: ((error: Error & { readonly code: string }) => void) | undefined;
  translate?: Translate | undefined;
  ref?: Ref<InteractiveHtmlEditorHandle>;
}
/**
 * The icon names admin screens render. A closed subset of the host icon set's names, never a
 * general string: the host's Icon accepts only its own names, so `satisfies AdminKit` fails the
 * moment a screen asks for a glyph the host cannot draw. A moved screen that needs another glyph
 * adds its name here.
 */
export type KitIconName =
  | 'alert-triangle' | 'arrow-left' | 'arrow-up' | 'check-long' | 'chevron-down' | 'chevron-right'
  | 'chevron-right-wide' | 'close' | 'folder' | 'image' | 'package-check' | 'package-outline' | 'play'
  | 'plus' | 'puzzle' | 'refresh' | 'settings' | 'storefront' | 'trash-compact' | 'volume'
  // Database, import-export, library, media and skills screens, when they switch to the kit Icon.
  | 'timeline' | 'migrate-forward' | 'tray-export' | 'tray-import' | 'more-horizontal-outline' | 'tray-upload'
  | 'document-lines' | 'tiles-four' | 'picture-frame' | 'video-frame' | 'cloud-outline' | 'bin-lidded' | 'document-marked'
  // The sites list's card badges.
  | 'flag-triangle' | 'star-filled';
type SvgLineCap = 'butt' | 'round' | 'square' | 'inherit';
type SvgLineJoin = 'miter' | 'round' | 'bevel' | 'inherit';
type Booleanish = boolean | 'true' | 'false';
/** The SVG attributes admin's icon call sites pass, line-icon styling included. */
export interface IconProps {
  readonly name: KitIconName; readonly size?: number | string; readonly className?: string | undefined;
  readonly strokeWidth?: number | string | undefined; readonly stroke?: string | undefined; readonly fill?: string | undefined;
  readonly viewBox?: string | undefined; readonly strokeLinecap?: SvgLineCap | undefined; readonly strokeLinejoin?: SvgLineJoin | undefined;
  readonly focusable?: Booleanish | 'auto' | undefined; readonly 'aria-hidden'?: Booleanish | undefined; readonly 'aria-label'?: string | undefined;
}
export interface ErrorNoticeProps {
  readonly failure: UserFacingError; readonly t?: Translate; readonly className?: string; readonly role?: 'alert' | 'status';
  /** The UI library's injectable clipboard write port, for "Copy details" where browser copying is unavailable. */
  readonly clipboard?: { writeText(requiredArgs: { text: string }): Promise<void> };
}
/**
 * A RemixIcon webfont glyph (`ri-<name>`). Unlike `Icon`, the host's own RemixIcon takes any string
 * (it renders whatever `ri-` class it is given), so there is no narrower host name set to pin here.
 */
export interface RemixIconProps { readonly name: string; readonly size?: number; readonly className?: string }
export type KitToastTone = 'default' | 'success' | 'error' | 'loading';
export interface ToastProps {
  readonly message: string; readonly className?: string; readonly details?: string | null; readonly actionLabel?: string | null;
  readonly actionAriaLabel?: string; readonly onAction?: () => void; readonly code?: string | null; readonly ttlMs?: number;
  readonly onDismiss?: () => void; readonly role?: 'status' | 'alert'; readonly tone?: KitToastTone; readonly placement?: 'bottom' | 'top';
}
/** The UI library's locale code (a plain string tag such as `en`). */
export type Locale = string;
/** The UI library's locale provider: admin passes the settings dictionaries and pins the locale. */
export interface I18nProviderProps {
  readonly dictionaries?: KitDictionaries; readonly fallbackLocale?: Locale; readonly initialLocale?: Locale;
  readonly syncDocumentAttributes?: boolean; readonly children: ReactNode;
}
/** One tab of the settings dialog shell: its nav entry plus the panel it shows. */
export interface SettingsDialogTab<TId extends string = string> {
  id: TId; label: string; navHint?: string; title?: string; subtitle?: string; icon?: ReactNode; panel: ReactNode;
}
export interface SettingsDialogShellProps {
  readonly tabs: readonly SettingsDialogTab[]; readonly initialActiveTabId?: string; readonly activeTabId?: string;
  readonly onActiveTabIdChange?: (tabId: string) => void; readonly onClose?: () => void; readonly presentation?: 'modal' | 'inline';
  readonly welcome?: boolean; readonly defaultSidebarCollapsed?: boolean; readonly fullscreenEnabled?: boolean; readonly defaultFullscreen?: boolean;
  readonly chromeExtra?: ReactNode; readonly dialogAriaLabelledBy?: string; readonly className?: string;
  /** Chrome labels the shell renders itself; mirrors the UI owner's `TabbedDialogChromeLabels` (all optional). */
  readonly labels?: SettingsDialogChromeLabels | undefined;
}
/** Kit mirror of the UI shell's chrome labels (kicker, welcome copy, close/fullscreen/sidebar labels). */
export interface SettingsDialogChromeLabels {
  readonly kicker?: string; readonly welcomeKicker?: string; readonly welcomeTitle?: string; readonly welcomeSubtitle?: string;
  readonly closeLabel?: string; readonly fullscreenLabel?: string; readonly exitFullscreenLabel?: string;
  readonly collapseSidebarLabel?: string; readonly expandSidebarLabel?: string; readonly sidebarAriaLabel?: string;
}
export interface CodeWithLinesProps { readonly text: string; readonly wrap?: boolean }
export interface CodeWrapToggleProps { readonly wrap: boolean; readonly onToggle: () => void; readonly t: Translate; readonly agentHandleId: string; readonly className?: string }
export type KitPreviewModalIconName = 'close' | 'chevron-down' | 'fullscreen' | 'fullscreen-exit';
export interface PreviewModalView {
  id: string; label: string; html?: string | null | undefined; error?: string | null | undefined; custom?: ReactNode;
}
export interface PreviewModalSidebar {
  label: string; content: ReactNode; defaultOpen?: boolean | undefined; onToggle?: ((open: boolean) => void) | undefined;
  contentKey?: string | number | undefined;
}
/** The read-only preview modal around admin's code viewers: views, header extras and icon overrides. */
export interface PreviewModalShellProps {
  readonly title: string; readonly subtitle?: string | undefined; readonly views: PreviewModalView[]; readonly initialViewId?: string | undefined;
  readonly onView?: ((viewId: string) => void) | undefined; readonly onClose: () => void; readonly sidebar?: PreviewModalSidebar | undefined;
  readonly designWidth?: number | undefined; readonly headerExtras?: ReactNode; readonly hideSidebarToggle?: boolean | undefined;
  readonly onFullscreenClick?: (() => void) | undefined; readonly onSidebarToggleClick?: ((open: boolean) => void) | undefined;
  readonly icons?: Partial<Record<KitPreviewModalIconName, () => ReactElement>> | undefined; readonly className?: string | undefined;
}

export interface AdminKitComponents {
  Button: ComponentType<ButtonProps>; IconButton: ComponentType<IconButtonProps>; TextField: ComponentType<TextFieldProps>;
  TextArea: ComponentType<TextAreaProps>; Select: ComponentType<SelectProps>; Switch: ComponentType<SwitchProps>;
  Dialog: ComponentType<DialogProps>; ConfirmDialog: ComponentType<KitConfirmDialogProps>; Tabs: ComponentType<TabsProps>;
  Menu: ComponentType<MenuProps>; Notice: ComponentType<NoticeProps>; Spinner: ComponentType<SpinnerProps>;
  Badge: ComponentType<BadgeProps>; InfoTip: ComponentType<InfoTipProps>; Lightbox: ComponentType<LightboxProps>;
  WidgetSelect: ComponentType<WidgetSelectProps>; TabBar: ComponentType<TabBarProps>; HtmlEditor: ComponentType<HtmlEditorProps>;
  ErrorNotice: ComponentType<ErrorNoticeProps>; Icon: ComponentType<IconProps>;
  RemixIcon: ComponentType<RemixIconProps>; Toast: ComponentType<ToastProps>; I18nProvider: ComponentType<I18nProviderProps>;
  SettingsDialogShell: ComponentType<SettingsDialogShellProps>; CodeWithLines: ComponentType<CodeWithLinesProps>;
  CodeWrapToggle: ComponentType<CodeWrapToggleProps>; PreviewModalShell: ComponentType<PreviewModalShellProps>;
  /** A masked password/token/key input with an eye toggle; every `<input>` prop passes through, and the ref reaches the input. */
  SecretInput: ComponentType<SecretInputProps & { ref?: Ref<HTMLInputElement> }>;
  /* settings screens' own slots (x8-w3) */
  /** Clamps long text to N lines with a More/Less toggle. */
  SeeMore: ComponentType<SeeMoreProps>;
  /** A model dropdown with a search box once the list is long enough to need one. */
  SearchableModelSelect: ComponentType<SearchableModelSelectProps>;
  /** A drag/drop/click-to-browse zone that resolves whatever the user hands it to a flat `File[]`. */
  FileDropzone: ComponentType<FileDropzoneProps>;
}

/* ---------- hooks ---------- */
export interface AgentControlProps {
  readonly agentHandle?: string | false | undefined; readonly 'data-agent-element'?: string | undefined;
  readonly 'data-agent-private'?: string | boolean | undefined; readonly 'data-agent-page'?: string | undefined;
}
export interface DirtyGuard {
  isDirty: boolean;
  confirmLeave: (required?: Record<string, never>, optional?: { unsavedBeyondTracked?: boolean }) => boolean;
}
export type DirtyGuardHostPort = Pick<Window, 'addEventListener' | 'removeEventListener' | 'confirm'>;
export interface SettlementGeneration { next: () => number; isCurrent: (required: { generation: number }) => boolean }
/** The fields of the host's confirm view model admin's ConfirmDialog reads. */
export interface ConfirmControllerView {
  readonly pending: boolean; readonly error: ReactNode;
  readonly cancel: { readonly attrs?: KitAttrs; readonly onPress?: Action };
  readonly confirm: { readonly attrs?: KitAttrs; readonly onPress?: Action };
  requestDismiss(required: { reason: 'cancel-button' | 'escape' | 'backdrop' | 'close' }, optional?: Record<string, never>): boolean;
}
export interface NativeDialogView {
  readonly titleId: string;
  readonly props: {
    readonly ref: RefObject<HTMLDialogElement | null>;
    readonly onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
    readonly onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  };
}
export interface TabBarKeyboardHandlers { onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void }
/** Runs writes one at a time (per `key`), so a later save never lands before an earlier one. */
export interface SerialWrites { run<T>(required: { task: () => Promise<T> }, optional?: { key?: string }): Promise<T> }
export interface CodeWrapController { wrap: boolean; toggleWrap: () => void }
export interface InfoTipController {
  open: boolean; placement: 'above' | 'below'; coords: { top: number; left: number; arrowLeft?: number | undefined };
  iconRef: RefObject<HTMLSpanElement | null>; bubbleRef?: RefObject<HTMLSpanElement | null>;
  show: () => void; hide: () => void; leave: () => void; toggle: () => void;
  pointerDown?: (e: { pointerType: string }) => void; handleIconKeyDown: (e: ReactKeyboardEvent<HTMLSpanElement>) => void;
}
/** Fixed viewport coordinates for a dropdown panel; exactly one of `top`/`bottom` anchors it. */
export interface PanelPosition { top?: number | undefined; bottom?: number | undefined; left: number; width: number; maxHeight: number }
export interface PanelPositionController {
  position: PanelPosition | null; setPosition: Dispatch<SetStateAction<PanelPosition | null>>; updatePosition: () => void;
}
/** The searchable listbox's state and handlers (options use `WidgetSelectOption`, the host's admin-widgets option row). */
export interface SelectDropdownController {
  open: boolean; query: string; setQuery: Dispatch<SetStateAction<string>>; highlightedIndex: number;
  setHighlightedIndex: Dispatch<SetStateAction<number>>; position: PanelPosition | null;
  triggerRef: RefObject<HTMLButtonElement | null>; panelRef: RefObject<HTMLDivElement | null>; searchInputRef: RefObject<HTMLInputElement | null>;
  optionRefs: RefObject<Map<number, HTMLLIElement>>; listboxId: string; showSearch: boolean; filtered: WidgetSelectOption[];
  selectedOption: WidgetSelectOption | null; openPanel: () => void; closePanel: (required: { refocusTrigger: boolean }) => void;
  selectOption: (option: WidgetSelectOption) => void; handleTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  handlePanelKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void; optionId: (index: number) => string;
}
/** The tabbed-dialog controller fields admin reads; the UI library's controller carries more. */
export interface TabbedDialogView { activeTabId: string | null; setActiveTabId: (tabId: string) => void }
export interface KitClipboardPort { copyText(text: string): Promise<boolean> }
/** A copy action plus its short-lived "copied" flag. */
export interface CopyToClipboardController { copied: boolean; copy: (text: string) => Promise<boolean> }
/**
 * The host's bound admin locale hook: zero inputs, the current locale out. The host builds it once
 * from `useAdminLocale` (`@jini-ai/admin/shell/hooks/use-admin-locale.hooks`) and passes the same
 * function here and to every mount that declares a required `useAdminLocaleHook` prop.
 */
export type UseAdminLocaleHook = (required: Record<string, never>, optional?: Record<string, never>) => string;

export interface AdminKitHooks {
  /** The operator's admin locale; see {@link UseAdminLocaleHook}. */
  useAdminLocale: UseAdminLocaleHook;
  useAgentHandle(required: AgentControlProps, optional?: Record<string, never>): string | undefined;
  useFocusTrap(required: { containerRef: RefObject<HTMLElement | null> }, optional?: { active?: boolean | undefined }): void;
  useDirtyGuard<T>(required: { current: T; original: T | null }, optional?: { translate?: Translate | undefined; host?: DirtyGuardHostPort | undefined }): DirtyGuard;
  useSettlementGeneration(): SettlementGeneration;
  useConfirmController(required: KitConfirmDialogProps, optional?: { agent?: AgentAttrsPort }): ConfirmControllerView;
  useNativeDialog(required: DialogProps, optional?: { initialFocus?: () => void; document?: Pick<Document, 'activeElement'> }): NativeDialogView;
  /** The UI library's translator (its locale context), distinct from any chat translator the host has. */
  useT(): KitTranslator;
  useTabBarKeyboard(required: { tabs: readonly TabBarTab[]; activeId: string; onChange: (id: string) => void }, optional?: Record<string, never>): TabBarKeyboardHandlers;
  useSerialWrites(): SerialWrites;
  useCodeWrap(): CodeWrapController;
  /** The package-files tree's expansion, focus and keys (the host's agent-plugins hook); `locale` orders siblings the way the host sorts. */
  useAgentPluginFileTree(required: PackageFileTreeInput, optional?: { locale?: string | string[] | undefined }): PackageFileTreeController;
  useInfoTip(required?: Record<string, never>, optional?: { placement?: 'top' | 'bottom' | undefined }): InfoTipController;
  usePanelPosition(required: {
    open: boolean; triggerRef: RefObject<HTMLButtonElement | null>; panelRef: RefObject<HTMLDivElement | null>;
    searchInputRef: RefObject<HTMLInputElement | null>; showSearch: boolean; onOutOfView: () => void;
  }, optional?: Record<string, never>): PanelPositionController;
  useSelectDropdown(required: { value: string; onChange: (value: string) => void; options: WidgetSelectOption[] },
    optional?: { disabled?: boolean | undefined }): SelectDropdownController;
  useTabbedDialog(required: { tabs: readonly SettingsDialogTab[]; initialActiveTabId?: string | undefined }, optional?: Record<string, never>): TabbedDialogView;
  /** `copied` turns true after a successful copy and back to false after `resetMs`. */
  useCopyToClipboard(clipboard: KitClipboardPort, resetMs?: number): CopyToClipboardController;
  /** Reads the admin-stored execution credential and saves/migrates it; the host supplies the port and effects. */
  useExecutionCredential<TStored extends ExecutionCredentialView>(required: UseExecutionCredentialInput & {
    port: ExecutionCredentialPort<TStored>; effects: ExecutionCredentialEffects<TStored>;
  }, optional?: Record<string, never>): ExecutionCredentialController<TStored>;
  /** One settings slice: loaded once, saved after a debounce, refreshed when another slice publishes its namespace. */
  useSettingsSlice<T>(options: SettingsSliceOptions<T>): SettingsSlice<T>;
  useStandingDraftAutosave(deps: StandingDraftAutosaveOptions, options?: Record<string, never>): StandingDraftAutosaveController;
  /** `useCopyToClipboard` over the browser's own clipboard. */
  useWiredCopyToClipboard(resetMs?: number): CopyToClipboardController;
  /** Cursor-paged list: re-fetches from the first page when the filters change. */
  useCursorPages<Filters, Item>(required: {
    key: (required: { filters: Filters }) => QueryKey;
    fetchPage: (required: { filters: Filters }, optional?: { cursor?: string | undefined }) => Promise<{ items: Item[]; nextCursor: string | null }>;
    initialFilters: Filters;
  }, optional?: Record<string, never>): CursorPages<Filters, Item>;
  /** The UI library's locale context: the active locale, its setter and the translator. */
  useI18n(): { locale: Locale; setLocale: (next: Locale) => void; t: KitTranslator };
  useDebouncedHtmlPreview(required: { source: string; render: HtmlPreviewPort }, optional?: { revision?: string; delayMs?: number }): HtmlPreviewState;
}
/** A translator with optional interpolation variables, as the UI library's `useT` returns. */
export type KitTranslator = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/* ---------- fetch-query (core's adapter + the scope hook) ---------- */
export interface AdminQueryKit extends FetchQueryAdapter {
  useFetchQueryScope(required: { owner: object }, optional?: Record<string, never>): number;
}

/* ---------- theme (admin is ui/theme's only Jini consumer: shapes restated, DESIGN B4) ---------- */
export interface AdminThemeColors {
  readonly primary: string; readonly primaryInk: string; readonly bg: string; readonly surface: string; readonly text: string;
  readonly muted: string; readonly border: string; readonly danger: string; readonly success: string; readonly warning: string;
}
export interface AdminTheme {
  readonly name: string;
  readonly fonts: { readonly body: string; readonly heading: string; readonly mono?: string; readonly load?: readonly string[] };
  readonly light: AdminThemeColors; readonly dark: AdminThemeColors; readonly radius?: string; readonly density?: number;
}
export type ColorScheme = 'light' | 'dark';
export type ColorSchemePreference = ColorScheme | 'system';
export type MatchMediaPort = (query: string) => {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};
export type AdminThemeTarget = Pick<HTMLElement, 'style' | 'getAttribute' | 'setAttribute' | 'removeAttribute'>;
export type AdminThemeDocument = Pick<Document, 'head' | 'createElement' | 'baseURI'>;
export interface AdminThemeKit {
  applyAdminTheme(required: { readonly theme: AdminTheme }, optional: { readonly target: AdminThemeTarget; readonly document: AdminThemeDocument }): () => void;
  resolveColorScheme(required: { readonly preference: ColorSchemePreference }, optional?: { readonly matchMedia?: MatchMediaPort }): ColorScheme;
  readonly defaultAdminTheme: AdminTheme;
}

/* ---------- plain values (data the UI library owns; injected so admin imports no UI package) ---------- */
/** Locale code -> settings-dialog dictionary (key -> translated string). */
export type KitDictionaries = Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>;
export interface KitNotificationsPreferences {
  readonly soundEnabled: boolean; readonly successSoundId: string; readonly failureSoundId: string; readonly desktopEnabled: boolean;
}
/** A post/page draft as the autosave writes it (block document or raw HTML body). */
export type StandingDraftAutosaveInput =
  | { bodyFormat: 'doc'; bodyJson: Record<string, unknown>; title: string; slug: string; baseVersion: number }
  | { bodyFormat: 'html'; bodyHtml: string; title: string; slug: string; baseVersion: number };
export interface StandingDraftAutosaveSnapshot {
  bodyFormat: 'doc' | 'html'; bodyJson?: Record<string, unknown>; bodyHtml?: string; title: string; slug: string; baseVersion: number;
  savedAt: string; savedByPrincipalId: string; serverUpdatedAt?: string | undefined;
}
type BackupPrincipal = { principalId?: string | null | undefined };
/** The local-tab mirror of an unsaved draft; a `null` principal skips storage entirely. */
export interface StandingDraftLocalBackup {
  write: (required: { entryId: string; draft: StandingDraftAutosaveInput; savedAt: string }, optional?: BackupPrincipal) => void;
  read: (required: { entryId: string }, optional?: BackupPrincipal) => StandingDraftAutosaveSnapshot | null;
  clear: (required: { entryId: string }, optional?: BackupPrincipal) => void;
}
/** One published failure at a time; `reset()` bumps the generation so a stale publish is dropped. */
export interface FailureChannel {
  publish(input: { failure: UserFacingError; generation?: number }): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): UserFacingError | null;
  getGeneration(): number;
  reset(): void;
}
/** The slice of `document` a visibility-aware interval reads. */
export interface VisibilitySource {
  readonly visibilityState: 'hidden' | 'visible';
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}
/* ---------- restated shapes (A-K2-0c) ---------- */
/** A settings slice's save status (the UI library's panel-kit shape). */
export type SaveState = KitSaveState;
/** The settings dialog's theme choice. */
export type SettingsThemeChoice = 'system' | 'light' | 'dark';
/** The host's notifications preferences (same shape as {@link KitNotificationsPreferences}). */
export type NotificationsPreferences = KitNotificationsPreferences;
/** The editor's target for a protected block (same shape as {@link HtmlEditorTarget}). */
export type EditorHtmlTarget = HtmlEditorTarget;
/** The editor's "open the HTML source for this block" callback. */
export type RequestEditHtml = (target: EditorHtmlTarget, options: object) => void | Promise<void>;
/** How a conversation title was produced; decides whether it is shown as saved or re-derived. */
export type KitConversationTitleSource = 'fallback' | 'generated' | 'manual';
export interface AdminKitValues extends AdminSurfaceProtocolKit {
  /** Whether a plugin provider setting must be filled given the other entered values. */
  readonly isProviderSettingRequired: (required: { field: Pick<AdminPluginProviderSettingField, 'required' | 'requiredUnless' | 'requiredWhen'>; values: Readonly<Record<string, unknown>> },
    optional?: Record<string, never>) => boolean;
  readonly SETTINGS_DIALOG_DICTIONARIES: KitDictionaries;
  readonly DEFAULT_NOTIFICATIONS_PREFERENCES: KitNotificationsPreferences;
  /** The waits between retries while the host is unreachable. */
  readonly UNREACHABLE_RETRY_DELAYS_MS: readonly number[];
  /** The principal id a local-tab draft backup is saved under. */
  readonly LOCAL_BACKUP_PRINCIPAL_ID: string;
  /** The MCP-UI sandbox proxy as an opaque-origin `data:` URL with the host origin baked in. */
  readonly buildSandboxProxyDataUrl: (required: { hostOrigin: string }, optional?: Record<string, never>) => string;
  /** Idempotent native `<dialog>` open/close with the attribute fallback for DOMs without `showModal`. */
  readonly openLightboxDialog: (dialog: HTMLDialogElement) => void;
  readonly closeLightboxDialog: (dialog: HTMLDialogElement) => void;
  /** Roving tabindex for a TabBar tab: 0 for the active (or first enabled) tab, -1 otherwise. */
  readonly resolveTabBarTabIndex: (required: { tabs: readonly TabBarTab[]; activeId: string; tab: TabBarTab }, optional?: Record<string, never>) => 0 | -1;
  readonly hasPermission: (required: { permissions: readonly string[]; permission: string }) => boolean;
  readonly standingDraftRecoveryMessage: (required: { draft: StandingDraftAutosaveSnapshot; t: (key: string) => string; serverUpdatedAt?: string },
    optional?: { formatSavedAt?: (iso: string) => string }) => string;
  readonly createStandingDraftLocalBackup: (required: {
    keyPrefix: string; getStorage: (required: Record<string, never>, optional?: Record<string, never>) => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  }, optional?: Record<string, never>) => StandingDraftLocalBackup;
  readonly createFailureChannel: (required: Record<string, never>, optional?: { onPublish?: (input: { failure: UserFacingError }) => void }) => FailureChannel;
  /** The requested tab when it is present, else the first tab, else null. */
  readonly resolveInitialActiveTabId: <T extends SettingsDialogTab>(required: { tabs: readonly T[] }, optional?: { initialTabId?: string | null | undefined }) => string | null;
  readonly findActiveTab: <T extends SettingsDialogTab>(required: { tabs: readonly T[]; activeTabId: string | null }, optional?: Record<string, never>) => T | undefined;
  /** Black or white, whichever reads on the given hex background. */
  readonly readableTextColor: (required: { hex: string }, optional?: Record<string, never>) => string;
  /** Whether an external refresh may replace a settings slice's value right now. */
  readonly canAcceptRefresh: (required: { timerPending: boolean; hasUnsavedEdits: boolean; mounted: boolean; commitsUnchanged: boolean }, optional?: Record<string, never>) => boolean;
  readonly mergeSaveStates: (required: { states: readonly SaveState[] }, optional?: Record<string, never>) => SaveState;
  /** Debounce (ms) for text fields in a settings slice. */
  readonly SAVE_DEBOUNCE_MS: number;
  /** Runs `tick` every `periodMs` while the document is visible; returns the stop function. */
  readonly startVisibleInterval: (required: { tick: () => void; periodMs: number }, optional?: { doc?: VisibilitySource }) => () => void;  /** Execution-config writers: switch the selected agent, set its model or its reasoning level, returning the next config. */
  readonly nextConfigForAgentSelect: (required: { config: ExecutionConfig; agentId: string }, optional?: Record<string, never>) => ExecutionConfig;
  readonly nextConfigForAgentModel: (required: { config: ExecutionConfig; agentId: string; model: string }, optional?: Record<string, never>) => ExecutionConfig;
  readonly nextConfigForAgentReasoning: (required: { config: ExecutionConfig; agentId: string; reasoning: string }, optional?: Record<string, never>) => ExecutionConfig;
  /** The preset the BYOK config points at, or null when it matches none. */
  readonly resolveSelectedPreset: (required: { presets: readonly ProviderPreset[]; config: ByokConfig }, optional?: Record<string, never>) => ProviderPreset | null;
  readonly createExecutionHttpAdapter: (required: { transport: ExecutionProbeTransport }, optional?: Record<string, never>) => {
    createPort: (required?: Record<string, never>, options?: CreateExecutionPortOptions) => ExecutionPort;
    resetDetectionCache: (required?: Record<string, never>, optional?: Record<string, never>) => void;
  };
  /** The response's `data`, or a plain-words error naming the call site when it is missing. */
  readonly requireExecutionResponseData: <T>(required: { response: { data?: T | null } | null | undefined; callSite: string }, optional?: Record<string, never>) => T;
  /** Runs `load`, retrying on the host's unreachable delays while `isUnreachable` says the failure is a lost connection. */
  readonly retryWhileUnreachable: <T>(required: { load: () => Promise<T>; signal: AbortSignal; isUnreachable: (error: unknown) => boolean },
    optional?: { delaysMs?: readonly number[]; wait?: (required: { ms: number; signal: AbortSignal }) => Promise<void> }) => Promise<T>;
  readonly createBrowserViewerClipboard: () => KitClipboardPort;
  /** The folder paths of the dropped files, through the host's path port. */
  readonly folderPathsFromDataTransfer: (required: { dataTransfer: DataTransfer; port: FolderPathDropPort }, optional?: Record<string, never>) => string[];
  readonly findEditorBlockOpening: (required: { html: string; target: EditorHtmlTarget }, optional?: object) => { start: number; end: number; openingTag: string } | undefined;
  readonly isEditorSourceError: (required: { error: unknown }, optional?: object) => boolean;
  readonly resolveAccentColor: (required: { value: unknown }) => string;
  readonly normalizeAccentColor: (required: { value: unknown }) => string | null;
  readonly resolveSelectTriggerLabel: (required: { selectedOption: WidgetSelectOption | null; placeholder: string | undefined },
    optional?: { t?: Translate | undefined }) => { text: string; className: string };
  readonly infoTipBubbleStyle: (coords: { top: number; left: number; arrowLeft?: number | undefined }) => CSSProperties;
  /** Markdown to HTML that is safe to inject (scripts and event handlers stripped). */
  readonly renderMarkdownToSafeHtml: (markdown: string) => string;
  readonly sourceDisplayLabel: (required: { source: SourceConfigItem; fieldSpecs: readonly SourceFieldSpec[] }, optional?: Record<string, never>) => string;
}

/** The host's execution contract lives in core; admin re-exports it by name so screens import one kit. */
export type { ApiProtocol, ByokConfig, ByokProviderCredentials, ExecutionCardAgent, ExecutionConfig, ExecutionMode, ExecutionPort, LocalCliConfig, ProviderPreset } from '@jini-ai/core/contracts/execution';
export type { DetectedAgent } from '@jini-ai/core/contracts/site/agent-runtime';
export type { FetchQueryEnvironmentPort, QueryKey } from '@jini-ai/core/fetch';
export type { AddSourceInput, AddSourceResult, CreateExecutionPortOptions, CursorPage, CursorPages, ExecutionCredentialController, ExecutionCredentialEffects,
  ExecutionCredentialPatch, ExecutionCredentialPort, ExecutionCredentialSaveState, ExecutionCredentialView, ExecutionProbeFlags, ExecutionProbeTransport, FolderPathDropPort,
  HtmlPreviewPort, HtmlPreviewState, MemoryConfigFlagKey, MemoryEntrySummary, MemoryExtractionPhase, MemoryExtractionProvider, MemoryExtractionRecord,
  MemoryExtractionSkipReason, MemoryType, PrivacyConsentState, SecretInputProps, SearchableModelSelectProps, SeeMoreProps, FileDropzoneProps, SettingsRefreshScope, SettingsSlice, SettingsSliceOptions, SettingsSliceRefreshPort,
  SourceConfigDependencies, SourceConfigItem, SourceConfigPort, SourceConnectionStatus, SourceFieldKind, SourceFieldOption, SourceFieldSpec, SourceFieldValues,
  SourceTestResult, SourceUpdateInput, TelemetryPreferences, UseExecutionCredentialInput, PackageFileTreeController, PackageFileTreeInput, PackageFileTreeRowView } from './kit-ui-types.js';
/** The standing-draft autosave's port, controller and options (the UI library's panel-kit shapes). */
export interface StandingDraftAutosavePort {
  getBackupPrincipalId?: (required: Record<string, never>, optional?: Record<string, never>) => string | null;
  putAutosave(required: { id: string; draft: StandingDraftAutosaveInput }, options?: { keepalive?: boolean }): Promise<{ applied: boolean }>;
  getAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ autosave: StandingDraftAutosaveSnapshot | null }>;
  discardAutosave(required: { id: string }, optional?: Record<string, never>): Promise<{ ok: boolean }>;
}
export interface StandingDraftStaleBasis { baseVersion: number; draft: StandingDraftAutosaveInput }
export interface StandingDraftAutosaveController {
  recoverableDraft: StandingDraftAutosaveSnapshot | null; staleBasis: StandingDraftStaleBasis | null; dismissRecoverable: () => void;
  scheduleAutosave: (draft: StandingDraftAutosaveInput) => void;
  clearStandingDraft: (required?: Record<string, never>, optional?: { keepOnFailure?: boolean }) => Promise<{ discarded: boolean }>;
  supersedeBasis: (baseVersion: number) => void;
  preserveFailedSave: (required: { error: unknown; draft: StandingDraftAutosaveInput }, optional?: Record<string, never>) => void;
}
export interface StandingDraftAutosaveOptions {
  port: StandingDraftAutosavePort; backup: StandingDraftLocalBackup; entryId: string | null; enabled: boolean; serverUpdatedAt?: string | undefined;
}

/* ---------- chat (the host's chat library: its translator and the run posters; shapes restated) ---------- */
export type { A2uiSurfaceCardProps, AgentEvent, ChatAttachment, ChatMessage, ChatPaneAgent, ChatPaneAgentOption, ChatPaneAgentSelection, ChatPaneRuntimeAccess, ChatPaneComposerHandle, ChatPaneWorkingDirectoryAccess, ChatRole, ChatRunStatus, ChatTransport, ExtEventCall, ExtEventRenderProps, FabPositionInput, FabPositionResult, FeedbackChange, I18nAdapter, KitA2uiActionDeliveryOutcome, KitA2uiActionPosterInput, KitChatAttachment, KitChatTranslator, KitDeliverMidRunMessage, KitDeliverTypedAnswer, KitMidRunMessageDelivery, KitPosterRequestOptions, KitRedactUserText, KitSecretRedactionSignal, KitTypedAnswerDelivery, KitUserTextRedactionOptions, ReattachRunOptions, RunHandlers, SecretRedactionSignal, StartRunInput, ToolResultMediaBlock } from './kit-chat-types.js';
export type { AgentInventoryEntry, AgentInventorySnapshot, AgentInventorySnapshotArgs, AssistantChatsClient, AssistantChatsClientPorts, AssistantChatsPort, AssistantConversation,
  AttemptResult, ChatAttachmentValidatorInput, ChatAttachmentValidatorOptions, ComposerDiscoveryArgument, ComposerDiscoveryGroup, ComposerDiscoveryItem, ComposerDiscoveryOutcome,
  ComposerDiscoverySelection, CreateA2uiActionPosterOptions, DeliverTypedAnswer, DurableRunBinding, DurableSubscriptionPorts, ExtEventRenderer, ExtEventRendererOptions,
  ExtEventRendererRegistry, ExtEventSlotKey, LastConversationStorage, LastConversationStore, SaveFailureInput, SaveOutcome, UseAssistantChats, UserTextRedactionOptions } from './kit-chat-types.js';
export type { FrontendSessionBridge, KitByokRuntimeSummary, KitChatPaneAgentBridgeAccess, KitChatPaneAgentControlOptions, KitChatPaneAgentToolAction, KitChatPaneAttachmentUploadOptions,
  KitChatPaneComposerSlots, KitChatPaneProps, KitChatPaneRunContext, KitChatPermissionsPort, KitChatSettingsDialogProps, KitChatSettingsSection, KitChatSettingsSegmentedProps,
  KitA2uiSurfaceCardProps, KitConversationListItem, KitConversationListProps, KitDaemonAttachmentUploaderOptions, KitJiniChatProviderProps,
  KitMcpUiSurfaceCardProps, KitMcpUiToolCall, KitSurfaceExpiryClock, KitToolCallDisplay, KitUploadAttachments } from './kit-chat-component-types.js';
import type { KitA2uiSurfaceCardProps, KitChatPaneProps, KitChatSettingsDialogProps, KitChatSettingsSegmentedProps, KitConversationListProps, KitDaemonAttachmentUploaderOptions,
  KitJiniChatProviderProps, KitMcpUiSurfaceCardProps, KitUploadAttachments } from './kit-chat-component-types.js';
import type { AgentEvent, ChatAttachment, ChatMessage, ChatPaneAgent, ChatPaneAgentOption, ChatPaneAgentSelection, ChatPaneRuntimeAccess, ChatPaneComposerHandle, ChatRole, ChatRunStatus, ChatTransport, ExtEventCall, ExtEventRenderProps, FabPositionInput, FabPositionResult, FeedbackChange, I18nAdapter, KitA2uiActionDeliveryOutcome, KitA2uiActionPosterInput, KitChatAttachment, KitChatTranslator, KitDeliverMidRunMessage, KitDeliverTypedAnswer, KitMidRunMessageDelivery, KitPosterRequestOptions, KitRedactUserText, KitSecretRedactionSignal, KitTypedAnswerDelivery, KitUserTextRedactionOptions, ReattachRunOptions, RunHandlers, SecretRedactionSignal, StartRunInput, ToolResultMediaBlock } from './kit-chat-types.js';
import type { AgentInventoryEntry, AgentInventorySnapshot, AgentInventorySnapshotArgs, AssistantChatsClient, AssistantChatsClientPorts, ChatAttachmentValidatorInput,
  ChatAttachmentValidatorOptions, ExtEventRendererRegistry, LastConversationStorage, LastConversationStore } from './kit-chat-types.js';

export interface AdminKitChat {
  /** The chat translator hook. Screens receive it as an injected hook prop (`useChatT`), never a direct import. */
  useT(): KitChatTranslator;
  createMidRunMessagePoster(required: { baseUrl: string; fetch: typeof globalThis.fetch },
    optional?: KitUserTextRedactionOptions & KitPosterRequestOptions): KitDeliverMidRunMessage;
  createTypedAnswerPoster(required: { baseUrl: string; fetch: typeof globalThis.fetch; toolName: string },
    optional?: KitUserTextRedactionOptions & KitPosterRequestOptions & { readonly path?: string }): KitDeliverTypedAnswer;
  createA2uiActionPoster(required: KitA2uiActionPosterInput, optional?: KitPosterRequestOptions)
    : (runId: string | undefined, message: unknown) => Promise<KitA2uiActionDeliveryOutcome>;
  /** The chat FAB's drag/persist position hook. */
  useFabPosition(required: FabPositionInput, optional?: Record<string, never>): FabPositionResult;
  /** Normalizes a requested agent/model/effort against the inventory, as the chat pane does. */
  resolveChatPaneSelection(required: { agents: readonly ChatPaneAgent[]; requested: ChatPaneAgentSelection }, optional?: Record<string, never>): ChatPaneAgentSelection;
  /** The title to display for a conversation, or null when it has none yet. */
  conversationTitleForDisplay(required: { title: string | null; titleSource: KitConversationTitleSource; firstPrompt?: string | undefined }, optional?: Record<string, never>): string | null;
  /** The heuristic title derived from a first prompt. */
  deriveConversationTitle(required: { prompt: string }, optional?: Record<string, never>): string;
  /** One transcript slot per MCP-UI surface / mid-run user message; `undefined` when the event carries no id. */
  mcpUiSurfaceSlotKey(required: { data: unknown }, optional?: Record<string, never>): string | undefined;
  midRunUserMessageSlotKey(required: { data: unknown }, optional?: Record<string, never>): string | undefined;
  /** The ext-event names those slots render under. */
  readonly MCP_UI_EXT_EVENT_NAME: string;
  readonly MID_RUN_USER_MESSAGE_EXT_EVENT_NAME: string;
  /** The chat library's own copy shown after a typed secret was redacted, and the credential-card guidance line. */
  readonly SECRET_REDACTED_NOTICE: string;
  readonly CREDENTIAL_CARD_GUIDANCE: string;
  /** True for a run status that will not change again (succeeded, failed or canceled). */
  isTerminalRunStatus(required: { status: ChatRunStatus | undefined }, optional?: Record<string, never>): boolean;
  /** A private registry of ext-event renderers (the host builds one per dock instead of using the library's shared one). */
  createExtEventRendererRegistry(required?: Record<string, never>, optional?: Record<string, never>): ExtEventRendererRegistry;
  /** Remembers which conversation was last open under `scope`; `storage: null` disables persistence. */
  createLastConversationStore(required: { scope: string }, optional?: { storage?: LastConversationStorage | null }): LastConversationStore;
  /** The saved-conversation hook and its save/retry helpers, over the host's ports. */
  createAssistantChatsClient(required: { ports: AssistantChatsClientPorts }, optional?: Record<string, never>): AssistantChatsClient;
  /** Session-scoped cache of the last agent list, under the host's storage key. */
  createAgentInventorySnapshot<T extends AgentInventoryEntry>(required: AgentInventorySnapshotArgs, optional?: Record<string, never>): AgentInventorySnapshot<T>;
  /** Reads a conversation's messages, reusing the last answer when the host reports it unchanged. */
  createConditionalHistoryRead(required: {
    read: (required: { conversationId: string }, optional: { version?: string | undefined }) => Promise<{ messages?: ChatMessage[]; version?: string | undefined; unchanged?: boolean }>;
  }, optional?: Record<string, never>): (required: { conversationId: string }, optional?: Record<string, never>) => Promise<ChatMessage[]>;
  /** Drops attachments whose files no longer exist on the host. */
  createChatAttachmentValidator(required: ChatAttachmentValidatorInput, optional?: Omit<ChatAttachmentValidatorOptions, 'fetchImpl'>)
    : (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]>;
  /** The chat pane, its settings dialog and provider, the conversation switcher and the two ext-event cards (props restated; see `kit-chat-component-types.ts`). */
  ChatPane: ComponentType<KitChatPaneProps>;
  ChatSettingsDialog: ComponentType<KitChatSettingsDialogProps>;
  JiniChatProvider: ComponentType<KitJiniChatProviderProps>;
  ConversationList: ComponentType<KitConversationListProps>;
  ChatSettingsSegmented: ComponentType<KitChatSettingsSegmentedProps>;
  McpUiSurfaceCard: ComponentType<KitMcpUiSurfaceCardProps>;
  A2uiSurfaceCard: ComponentType<KitA2uiSurfaceCardProps>;
  /** Uploads composer files to the daemon's attachment route; `baseUrl: ''` keeps the same-origin proxy. */
  createDaemonAttachmentUploader(required: { baseUrl: string; fetch?: typeof globalThis.fetch }, optional?: KitDaemonAttachmentUploaderOptions): KitUploadAttachments;
}

export interface AdminKit {
  readonly components: AdminKitComponents;
  readonly hooks: AdminKitHooks;
  readonly query: AdminQueryKit;
  readonly mediaProviders: AdminMediaProvidersKit;
  readonly theme: AdminThemeKit;
  readonly values: AdminKitValues;
  readonly chat: AdminKitChat;
}

/* ---------- provider ---------- */
const AdminKitContext = createContext<AdminKit | null>(null);

/** Mount once at the host root. The first kit is kept: hook slots must not change identity. */
export function AdminKitProvider(required: { kit: AdminKit; children: ReactNode }) {
  const [kit] = useState(() => required.kit);
  return <AdminKitContext.Provider value={kit}>{required.children}</AdminKitContext.Provider>;
}

export function useAdminKit(): AdminKit {
  const kit = useContext(AdminKitContext);
  if (!kit) throw new Error('@jini-ai/admin screens need <AdminKitProvider kit={...}> above them. '
    + 'The host builds the kit from its UI library and mounts it once at its root.');
  return kit;
}

/* ---------- same-name facades: moved/repointed code changes only its import line ---------- */
function slot<K extends keyof AdminKitComponents>(name: K): AdminKitComponents[K] & ComponentType<ComponentProps<AdminKitComponents[K]> & { useAdminKitHook?: typeof useAdminKit }> {
  const Slot = forwardRef<unknown, ComponentProps<AdminKitComponents[K]> & { useAdminKitHook?: typeof useAdminKit }>(function AdminKitSlot({ useAdminKitHook = useAdminKit, ...props }, ref) {
    const Impl = useAdminKitHook().components[name] as ComponentType<Record<string, unknown>>;
    return <Impl {...(props as Record<string, unknown>)} ref={ref} />;
  });
  Slot.displayName = `AdminKit.${name}`;
  return Slot as unknown as AdminKitComponents[K] & ComponentType<ComponentProps<AdminKitComponents[K]> & { useAdminKitHook?: typeof useAdminKit }>;
}
export const Button = slot('Button');
export const IconButton = slot('IconButton');
export const TextField = slot('TextField');
export const TextArea = slot('TextArea');
export const Select = slot('Select');
export const Switch = slot('Switch');
export const Dialog = slot('Dialog');
export const ConfirmDialog = slot('ConfirmDialog');
export const Tabs = slot('Tabs');
export const Menu = slot('Menu');
export const Notice = slot('Notice');
export const Spinner = slot('Spinner');
export const Badge = slot('Badge');
export const InfoTip = slot('InfoTip');
export const Lightbox = slot('Lightbox');
export const WidgetSelect = slot('WidgetSelect');
export const TabBar = slot('TabBar');
export const HtmlEditor = slot('HtmlEditor');
export const ErrorNotice = slot('ErrorNotice');
export const Icon = slot('Icon');
export const RemixIcon = slot('RemixIcon');
export const Toast = slot('Toast');
export const I18nProvider = slot('I18nProvider');
export const SettingsDialogShell = slot('SettingsDialogShell');
export const CodeWithLines = slot('CodeWithLines');
export const CodeWrapToggle = slot('CodeWrapToggle');
export const PreviewModalShell = slot('PreviewModalShell');
export const SecretInput = slot('SecretInput');
export const SeeMore = slot('SeeMore');
export const SearchableModelSelect = slot('SearchableModelSelect');
export const FileDropzone = slot('FileDropzone');

export const useAgentHandle: AdminKitHooks['useAgentHandle'] = (r, o) => useAdminKit().hooks.useAgentHandle(r, o);
export const useFocusTrap: AdminKitHooks['useFocusTrap'] = (r, o) => useAdminKit().hooks.useFocusTrap(r, o);
export function useDirtyGuard<T>(required: { current: T; original: T | null }, optional?: { translate?: Translate | undefined; host?: DirtyGuardHostPort | undefined }): DirtyGuard {
  return useAdminKit().hooks.useDirtyGuard<T>(required, optional);
}
export const useSettlementGeneration: AdminKitHooks['useSettlementGeneration'] = () => useAdminKit().hooks.useSettlementGeneration();
export const useConfirmController: AdminKitHooks['useConfirmController'] = (r, o) => useAdminKit().hooks.useConfirmController(r, o);
export const useNativeDialog: AdminKitHooks['useNativeDialog'] = (r, o) => useAdminKit().hooks.useNativeDialog(r, o);
/** The host's UI translator, returned as is. The empty objects keep the screen-facing required/optional shape. */
export function useT(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): KitTranslator {
  return useAdminKit().hooks.useT();
}

export const useTabBarKeyboard: AdminKitHooks['useTabBarKeyboard'] = (r, o) => useAdminKit().hooks.useTabBarKeyboard(r, o);
export function useSerialWrites(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SerialWrites {
  return useAdminKit().hooks.useSerialWrites();
}
export function useCodeWrap(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CodeWrapController {
  return useAdminKit().hooks.useCodeWrap();
}
export const useAgentPluginFileTree: AdminKitHooks['useAgentPluginFileTree'] = (r, o) => useAdminKit().hooks.useAgentPluginFileTree(r, o);
export const useInfoTip: AdminKitHooks['useInfoTip'] = (r, o) => useAdminKit().hooks.useInfoTip(r, o);
export const usePanelPosition: AdminKitHooks['usePanelPosition'] = (r, o) => useAdminKit().hooks.usePanelPosition(r, o);
export const useSelectDropdown: AdminKitHooks['useSelectDropdown'] = (r, o) => useAdminKit().hooks.useSelectDropdown(r, o);
export const useTabbedDialog: AdminKitHooks['useTabbedDialog'] = (r, o) => useAdminKit().hooks.useTabbedDialog(r, o);
export const useCopyToClipboard: AdminKitHooks['useCopyToClipboard'] = (clipboard, resetMs) => useAdminKit().hooks.useCopyToClipboard(clipboard, resetMs);
export const useExecutionCredential: AdminKitHooks['useExecutionCredential'] = (r, o) => useAdminKit().hooks.useExecutionCredential(r, o);
export const useSettingsSlice: AdminKitHooks['useSettingsSlice'] = (options) => useAdminKit().hooks.useSettingsSlice(options);
export const useStandingDraftAutosave: AdminKitHooks['useStandingDraftAutosave'] = (deps, options) => useAdminKit().hooks.useStandingDraftAutosave(deps, options);
export const useWiredCopyToClipboard: AdminKitHooks['useWiredCopyToClipboard'] = (resetMs) => useAdminKit().hooks.useWiredCopyToClipboard(resetMs);
export const useCursorPages: AdminKitHooks['useCursorPages'] = (r, o) => useAdminKit().hooks.useCursorPages(r, o);
export const useI18n: AdminKitHooks['useI18n'] = () => useAdminKit().hooks.useI18n();
export const useDebouncedHtmlPreview: AdminKitHooks['useDebouncedHtmlPreview'] = (r, o) => useAdminKit().hooks.useDebouncedHtmlPreview(r, o);

/** The host's CHAT translator (the chat library's locale context), distinct from the UI `useT` above. */
export function useChatT(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): KitChatTranslator {
  return useAdminKit().chat.useT();
}
/** The chat poster factories, read once per render; the caller passes both argument objects through untouched. */
export function useAdminKitChatPosters(_required: Record<string, never> = {}, _optional: Record<string, never> = {})
  : Pick<AdminKitChat, 'createMidRunMessagePoster' | 'createTypedAnswerPoster' | 'createA2uiActionPoster'> {
  return useAdminKit().chat;
}

export const useFabPosition: AdminKitChat['useFabPosition'] = (r, o) => useAdminKit().chat.useFabPosition(r, o);
/** Builds a same-name facade of one chat component: it renders the kit's implementation, and the kit hook is an injectable prop like `slot`'s. */
type ChatComponentName = 'ChatPane' | 'ChatSettingsDialog' | 'JiniChatProvider' | 'ConversationList' | 'ChatSettingsSegmented' | 'McpUiSurfaceCard' | 'A2uiSurfaceCard';
function chatSlot<K extends ChatComponentName>(name: K): ComponentType<ComponentProps<AdminKitChat[K]> & { useAdminKitHook?: typeof useAdminKit }> {
  return function AdminKitChatSlot({ useAdminKitHook = useAdminKit, ...props }) {
    const Impl = useAdminKitHook().chat[name] as unknown as ComponentType<Record<string, unknown>>;
    return <Impl {...props} />;
  };
}
/* Same-name facades of the chat components: each renders the kit's real implementation, so moved admin code imports them from here, never from the chat library. */
export const ChatPane = chatSlot('ChatPane');
export const ChatSettingsDialog = chatSlot('ChatSettingsDialog');
export const JiniChatProvider = chatSlot('JiniChatProvider');
export const ConversationList = chatSlot('ConversationList');
export const ChatSettingsSegmented = chatSlot('ChatSettingsSegmented');
export const McpUiSurfaceCard = chatSlot('McpUiSurfaceCard');
export const A2uiSurfaceCard = chatSlot('A2uiSurfaceCard');
/** The attachment uploader factory, read once per render: the injected function, never copied. */
export function useAdminKitChatRunValues(_required: Record<string, never> = {}, _optional: Record<string, never> = {})
  : Pick<AdminKitChat, 'createDaemonAttachmentUploader'> {
  return useAdminKit().chat;
}
/** The chat library's plain values (selection resolver and notice copy), read once per render: the injected object, never copied. */
export function useAdminKitChatValues(_required: Record<string, never> = {}, _optional: Record<string, never> = {})
  : Pick<AdminKitChat, 'resolveChatPaneSelection' | 'SECRET_REDACTED_NOTICE' | 'CREDENTIAL_CARD_GUIDANCE' | 'conversationTitleForDisplay' | 'deriveConversationTitle'
    | 'mcpUiSurfaceSlotKey' | 'midRunUserMessageSlotKey' | 'MCP_UI_EXT_EVENT_NAME' | 'MID_RUN_USER_MESSAGE_EXT_EVENT_NAME'
    | 'isTerminalRunStatus' | 'createExtEventRendererRegistry' | 'createLastConversationStore' | 'createAssistantChatsClient' | 'createAgentInventorySnapshot'
    | 'createConditionalHistoryRead' | 'createChatAttachmentValidator'> {
  return useAdminKit().chat;
}

export const useFetchQuery: FetchQueryAdapter['useFetchQuery'] = (r, o) => useAdminKit().query.useFetchQuery(r, o);
export const useFetchMutation: FetchQueryAdapter['useFetchMutation'] = (r, o) => useAdminKit().query.useFetchMutation(r, o);
export const useInvalidate: FetchQueryAdapter['useInvalidate'] = () => useAdminKit().query.useInvalidate();
export const useCachedLoader: FetchQueryAdapter['useCachedLoader'] = (r, o) => useAdminKit().query.useCachedLoader(r, o);
export const useFetchQueryScope: AdminQueryKit['useFetchQueryScope'] = (r, o) => useAdminKit().query.useFetchQueryScope(r, o);

export const useMediaProvidersTab: AdminMediaProvidersKit['useMediaProvidersTab'] = (options) => useAdminKit().mediaProviders.useMediaProvidersTab(options);
/** The pure media-provider rules, read once per render by the hook that calls them. */
export function useMediaProviderRules(): AdminMediaProvidersKit['rules'] { return useAdminKit().mediaProviders.rules; }
/** applyAdminTheme / resolveColorScheme / defaultAdminTheme, read once per render. */
export function useAdminThemeKit(): AdminThemeKit { return useAdminKit().theme; }
/** The injected plain values, read once per render. The same objects the host passed: never copied. */
export function useAdminKitValues(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): AdminKitValues { return useAdminKit().values; }

export type * from './kit-admin-surfaces.js';
export type { MediaProviderCatalogPolicy, MediaProviderOption };
