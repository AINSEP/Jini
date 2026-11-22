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
import type { ComponentProps, ComponentType, MouseEvent, ReactNode, Ref, RefObject, SyntheticEvent } from 'react';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';
import type { Translate } from '@jini-ai/core/text';
import type { MediaProviderCatalogPolicy, MediaProviderOption } from '@jini-ai/core';
import type { UserFacingError } from '@jini-ai/core';
import type { AdminMediaProvidersKit } from './kit-media-providers.js';

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
export interface InfoTipProps { label: string; agentHandle?: string | false | undefined }
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
export interface TabBarTab { readonly id: string; readonly label: string; readonly icon?: ReactNode | undefined; readonly count?: number | undefined; readonly tag?: string | undefined; readonly handle?: string | undefined; readonly handleLabel?: string | undefined }
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
  | 'document-lines' | 'tiles-four' | 'picture-frame' | 'video-frame' | 'cloud-outline' | 'bin-lidded' | 'document-marked';
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
export interface ErrorNoticeProps { readonly failure: UserFacingError; readonly t?: Translate; readonly className?: string; readonly role?: 'alert' | 'status' }

export interface AdminKitComponents {
  Button: ComponentType<ButtonProps>; IconButton: ComponentType<IconButtonProps>; TextField: ComponentType<TextFieldProps>;
  TextArea: ComponentType<TextAreaProps>; Select: ComponentType<SelectProps>; Switch: ComponentType<SwitchProps>;
  Dialog: ComponentType<DialogProps>; ConfirmDialog: ComponentType<KitConfirmDialogProps>; Tabs: ComponentType<TabsProps>;
  Menu: ComponentType<MenuProps>; Notice: ComponentType<NoticeProps>; Spinner: ComponentType<SpinnerProps>;
  Badge: ComponentType<BadgeProps>; InfoTip: ComponentType<InfoTipProps>; Lightbox: ComponentType<LightboxProps>;
  WidgetSelect: ComponentType<WidgetSelectProps>; TabBar: ComponentType<TabBarProps>; HtmlEditor: ComponentType<HtmlEditorProps>;
  ErrorNotice: ComponentType<ErrorNoticeProps>; Icon: ComponentType<IconProps>;
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
export interface AdminKitHooks {
  useAgentHandle(required: AgentControlProps, optional?: Record<string, never>): string | undefined;
  useFocusTrap(required: { containerRef: RefObject<HTMLElement | null> }, optional?: { active?: boolean | undefined }): void;
  useDirtyGuard<T>(required: { current: T; original: T | null }, optional?: { translate?: Translate | undefined; host?: DirtyGuardHostPort | undefined }): DirtyGuard;
  useSettlementGeneration(): SettlementGeneration;
  useConfirmController(required: KitConfirmDialogProps, optional?: { agent?: AgentAttrsPort }): ConfirmControllerView;
  useNativeDialog(required: DialogProps, optional?: { initialFocus?: () => void; document?: Pick<Document, 'activeElement'> }): NativeDialogView;
  /** The UI library's translator (its locale context), distinct from any chat translator the host has. */
  useT(): KitTranslator;
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
export interface AdminKitValues {
  readonly SETTINGS_DIALOG_DICTIONARIES: KitDictionaries;
  readonly DEFAULT_NOTIFICATIONS_PREFERENCES: KitNotificationsPreferences;
  /** The waits between retries while the host is unreachable. */
  readonly UNREACHABLE_RETRY_DELAYS_MS: readonly number[];
  /** The principal id a local-tab draft backup is saved under. */
  readonly LOCAL_BACKUP_PRINCIPAL_ID: string;
}

export interface AdminKit {
  readonly components: AdminKitComponents;
  readonly hooks: AdminKitHooks;
  readonly query: AdminQueryKit;
  readonly mediaProviders: AdminMediaProvidersKit;
  readonly theme: AdminThemeKit;
  readonly values: AdminKitValues;
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

export type { MediaProviderCatalogPolicy, MediaProviderOption };
