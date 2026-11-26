/**
 * @file The ports the mail screen renders through. These are types only: the host binds its own email
 * tabs, UI library components, dictionaries and rules once, and TypeScript checks at that call site that
 * they fit. Every shape here is a structural copy of just the members the views read, so this package
 * pins no admin or UI library type.
 */
import type { ComponentType, ReactNode } from 'react';

export type EmailTone = 'ok' | 'warning' | 'neutral' | 'error';
export type EmailTranslate = (required: { locale: string; key: string }) => string;
export type EmailSummary = 'not_set_up' | 'no_external_delivery' | 'needs_attention' | 'configured';
export type EmailLoadView<T> =
  | { readonly kind: 'loading' } | { readonly kind: 'forbidden' }
  | { readonly kind: 'error'; readonly message: string } | { readonly kind: 'loaded'; readonly data: T };
export type EmailStatusView<S> =
  | { readonly kind: 'loading' } | { readonly kind: 'forbidden' } | { readonly kind: 'error' }
  | { readonly kind: 'loaded'; readonly status: S };

/** Members of the host's mail status that these views read. */
export interface EmailStatusShape {
  readonly warnings?: readonly string[] | undefined;
  readonly lanes?: readonly { readonly lane: 'transactional' | 'bulk'; readonly providerId: string | null; readonly state: string }[] | undefined;
}
export interface EmailStatusControl<S extends EmailStatusShape> { readonly view: EmailStatusView<S>; readonly locale: string; readonly retry: () => void }

export interface EmailProviderField {
  readonly key: string; readonly label: string; readonly type: 'secret' | 'text' | 'url' | 'email';
  readonly placeholder?: string | undefined; readonly defaultValue?: string | undefined; readonly help?: string | undefined;
}
export interface EmailProviderView {
  readonly id: string; readonly label: string; readonly hosted: boolean;
  readonly lanes: readonly ('transactional' | 'bulk')[];
  readonly credential: { readonly required: boolean; readonly saved: boolean; readonly updatedAt?: string | undefined };
  readonly selectable: boolean; readonly refusal?: string | undefined;
  readonly setup: { readonly fields: readonly EmailProviderField[]; readonly helpUrl?: string | undefined };
}
export interface EmailProviderChoice { readonly pluginId: string; readonly summary?: string | null | undefined; readonly description: string | null }
export type EmailCredentialKey = 'token' | 'username' | 'baseUrl';
export interface EmailProviderControl<P extends EmailProviderView, Ch extends EmailProviderChoice> {
  readonly choices: readonly Ch[] | null; readonly adding: string | null;
  readonly addError: string | null; readonly addWarning: string | null;
  readonly retryAdd: () => Promise<string | undefined>;
  readonly addProvider: (required: { pluginId: string }) => Promise<string | undefined>;
  readonly view: EmailLoadView<{ readonly providers: readonly P[]; readonly refusals: readonly string[] }>;
  readonly reload: () => void;
  readonly drafts: Readonly<Record<string, { readonly token?: string; readonly username?: string; readonly baseUrl?: string }>>;
  readonly setDraftField: (providerId: string, key: EmailCredentialKey, value: string) => void;
  readonly busyId: string | null;
  readonly notice: { readonly providerId: string; readonly tone: 'ok' | 'error'; readonly text: string } | null;
  readonly saveKey: (provider: P) => Promise<void>;
  readonly pendingSwitch: P | null;
  readonly askSwitch: (provider: P | null) => void;
  readonly confirmSwitch: () => Promise<void>;
}

/** The host's concrete type set, instantiated once by the host as `Email<HostEmailTypes>`. */
export interface EmailTypes {
  readonly status: EmailStatusShape;
  readonly provider: EmailProviderView;
  readonly choice: EmailProviderChoice;
  readonly overview: unknown; readonly sender: unknown; readonly templates: unknown; readonly activity: unknown;
}

/** Each tab's state hook. All five are required; each is mounted only while its tab shows. */
export interface EmailTabHooks<T extends EmailTypes> {
  readonly overview: () => T['overview'];
  readonly provider: (optional: { onChanged?: () => void }) => EmailProviderControl<T['provider'], T['choice']>;
  readonly sender: (optional: { onChanged?: () => void }) => T['sender'];
  readonly templates: (optional: { newName?: string }) => T['templates'];
  readonly activity: () => T['activity'];
}

/** The four host tab views, as a component map. */
export interface EmailParts<T extends EmailTypes> {
  readonly Overview: ComponentType<{ controller: T['overview']; locale: string; part?: 'uses' | 'test' }>;
  readonly Sender: ComponentType<{ controller: T['sender']; warnings?: readonly string[]; locale: string; part?: 'sender' | 'dns' }>;
  readonly Activity: ComponentType<{ controller: T['activity']; locale: string; part?: 'sends' | 'blocked' | 'reports' }>;
  readonly Templates: ComponentType<{ controller: T['templates']; locale: string }>;
}

export interface EmailTabBarProps {
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly handle?: string | undefined; readonly handleLabel?: string | undefined }[];
  readonly activeId: string; readonly onChange: (id: string) => void; readonly ariaLabel: string; readonly containerHandle?: string | undefined;
}
export interface EmailSegmentedProps {
  readonly name: string;
  readonly items: readonly { readonly key: string; readonly label: string; readonly checked?: boolean | undefined; readonly change: () => void }[];
}
export interface EmailLoadedProps<T> { readonly view: EmailLoadView<T>; readonly locale: string; readonly retry?: () => void; readonly children: (data: T) => ReactNode }

/** Presentational components the views render with (the host's UI library and its email parts). */
export interface EmailKit<S extends EmailStatusShape> {
  readonly TabBar: ComponentType<EmailTabBarProps>;
  readonly Segmented: ComponentType<EmailSegmentedProps>;
  readonly Chip: ComponentType<{ tone: EmailTone; children: ReactNode }>;
  readonly Section: ComponentType<{ id: string; title: string; hideTitle?: boolean; children: ReactNode }>;
  readonly Loaded: <T>(props: EmailLoadedProps<T>) => ReactNode;
  /** The facts line under the status summary (e.g. the sender domain), bound to the status shape by the host. */
  readonly StatusFacts: ComponentType<{ status: S; locale: string }>;
}

/** Pure rules the views call; the host binds its own implementations so nothing is duplicated. */
export interface EmailRules<S extends EmailStatusShape, P extends EmailProviderView, Ch extends EmailProviderChoice> {
  readonly summarize: (required: { status: S }) => EmailSummary;
  readonly isFullyActive: (required: { provider: Pick<P, 'lanes'> }) => boolean;
  readonly when: (required: { iso: string; locale: string }) => string;
  readonly providerLabel: (required: { locale: string; providers: readonly P[] }) => (id: string | null) => string;
  readonly displayName: (choice: Ch) => string;
}

/** Copy: the screen dictionary and the navigation dictionary. */
export interface EmailCopy { readonly t: EmailTranslate; readonly navLabel: EmailTranslate }

export type EmailTabId = 'overview' | 'provider' | 'sender' | 'templates' | 'activity';
/** Tab and section navigation; the host owns the URL shape. */
export type EmailNavigate = (required: { tabId: EmailTabId; part: string | null }) => void;
export type EmailThemeBoundaryHook = (required: Record<string, never>, optional: Record<string, never>) => Readonly<Record<string, string>>;
