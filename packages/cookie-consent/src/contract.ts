/** @file @jini-ai/cookie-consent contract: the only module a banner, plugin or host feature needs to import.
 * Types and constants only. Every call that injects something takes (required, optional): the first
 * argument is an object of required fields/ports, the second an object of optional ones. */
export const CONTRACT = 1 as const;
export const CONSENT_COOKIE = 'jini_consent';
/** 'us' or absent. Absent (unknown region) = strict, with Reject on the first layer. */
export const REGION_COOKIE = 'jini_region';
/** Dispatched on `document` on every change; detail: ConsentState. */
export const STATE_EVENT = 'jini:consent';
/** Dispatched on `document` once the client is installed; detail: JiniConsentApi. */
export const READY_EVENT = 'jini:consent-ready';
/** Dispatched on `document` when anything asks for the preferences UI (a footer link, the reopen button). */
export const OPEN_EVENT = 'jini:consent-open';
/** Id of the JSON <script> that carries the PageConfig. */
export const CONFIG_ID = 'jini-consent-config';

export const OPTIONAL = ['functional', 'analytics', 'marketing'] as const;
export type Optional = typeof OPTIONAL[number];
export const CATEGORIES = ['necessary', ...OPTIONAL] as const;
export type Category = typeof CATEGORIES[number];
export type Flags = Record<Optional, boolean>;
export type Choices = Readonly<{ necessary: true } & Flags>;
export const ACTIONS = ['accept', 'reject', 'save', 'do-not-sell', 'withdraw'] as const;
export type ConsentAction = typeof ACTIONS[number];
export type RegionMode = 'opt-in' | 'opt-out';
/** A resolver's definite answer. Resolvers return null for "unknown: ask the next one". */
export type RegionHint = 'us' | 'strict';
/** jini = the built-in banner; headless = "My own" banner; off = anonymous analytics only, no UI. */
export const BANNER_MODES = ['jini', 'headless', 'off'] as const;
export type BannerMode = typeof BANNER_MODES[number];
/** durable = a server stores receipts and grants wait for one; local = browser-only evidence (static
 * export, Electron, file:), labelled as such and never presented as a server receipt. */
export type Evidence = { mode: 'durable'; endpoint: string; waitMs?: number } | { mode: 'local' };
/** 'stored' = server receipt; 'pending' = sent, unconfirmed; 'local' = browser-only, labelled as such. */
export type ReceiptStatus = 'none' | 'local' | 'pending' | 'stored';

/** Cookie wire format (JSON, URI-encoded). `c` is what the visitor chose; GPC is applied on read.
 * v = format, p = policy version, t = choice time (ms), a = action, r = receipt id, q = receipt pending. */
export interface StoredChoice { v: 1; p: string; c: Flags; t: number; a: ConsentAction; r?: string; q?: 1 }

export interface ConsentState {
  contract: 1;
  policy: string;
  status: 'pending' | 'set';
  region: RegionMode;
  /** Effective privacy opt-out: GPC or DNT. The historical field name is retained on receipts. */
  gpc: boolean;
  /** Analytics adapters/collectors must enforce this level, not just allowed.analytics. */
  analyticsLevel: 'none' | 'anonymous' | 'full';
  /** What the banner shows: the choice (or region default), GPC-clamped. */
  choices: Choices;
  /** What may RUN. Anonymous analytics needs no choice; durable grants await their receipt.
   * Adapters, inert tags, host features and the server gate all read this, never `choices`. */
  allowed: Choices;
  action: ConsentAction | null;
  at: number | null;
  receipt: ReceiptStatus;
}

// ---- Plugin slots: an OPEN set. A kind is a string; whoever consumes a kind defines it. ----
export interface Contribution<K extends string = string> { readonly id: string; readonly kind: K }
export type RawContribution = Contribution & Record<string, unknown>;
export interface SlotKind<T extends Contribution = Contribution> {
  readonly kind: T['kind'];
  /** Trust boundary: the typed, normalized contribution, or a plain-language reason to refuse it. */
  accept(required: { contribution: RawContribution }, optional?: object): T | string;
}
export interface RegistrationOptions { priority?: number; source?: string }
export interface SlotProblem { id: string; kind: string; reason: string; source?: string }
export interface PluginRegistry {
  defineSlot(required: { slot: SlotKind }, optional?: object): void;
  /** A contribution for a kind nobody has defined yet is parked until defineSlot arrives. */
  registerPlugin(required: RawContribution, optional?: RegistrationOptions): () => void;
  list<T extends Contribution>(required: { kind: T['kind'] }, optional?: object): readonly T[];
  subscribe(required: { kind: string; listener: (items: readonly Contribution[]) => void }, optional?: object): () => void;
}

// ---- Slot kind: browser consent adapter ----
export const ADAPTER_KIND = 'consent-adapter';
export interface StoragePrefixes { cookies?: readonly string[]; local?: readonly string[] }
/** revoke() true = fully stopped; false or missing = the page reloads to be clean. */
export interface Revoker { revoke?(): boolean | Promise<boolean> }
export interface GrantInput<C> { config: C; state: ConsentState; signal: AbortSignal }
/** Lives in the vendor's plugin. grant() returns null when it ran no vendor code (signal aborted first). */
export interface ConsentAdapter<C = unknown> extends Contribution<typeof ADAPTER_KIND> {
  category: Optional;
  /** Only adapters explicitly implementing the anonymous restrictions may run at that level. */
  supportsAnonymous?: true;
  config?: C;
  storage?: StoragePrefixes;
  grant(required: GrantInput<C>, optional?: object): Promise<Revoker | null> | Revoker | null;
  onState?(required: { state: ConsentState }, optional?: object): void;
}
/** Page-config form: `src` is imported only on grant. An adapter that must signal before any grant (a
 * consent-mode default) registers a live adapter through window.jiniConsentQueue instead. */
export interface LazyAdapter extends Contribution<typeof ADAPTER_KIND> {
  category: Optional; src: string; config?: unknown; storage?: StoragePrefixes;
  supportsAnonymous?: true;
}
export type AdapterContribution = ConsentAdapter | LazyAdapter;

// ---- Slot kind: server region resolver ----
export const REGION_KIND = 'region-resolver';
export interface RegionRequest { header(name: string): string | null; ip: string | null }
export interface RegionResolver extends Contribution<typeof REGION_KIND> {
  resolve(required: { request: RegionRequest }, optional?: { signal?: AbortSignal }): RegionHint | null | Promise<RegionHint | null>;
}
/** Data-only form for a plugin manifest; the region slot turns it into a RegionResolver. */
export interface HeaderRegion extends Contribution<typeof REGION_KIND> { header: string; usValues?: readonly string[] }

// ---- Browser API ----
export interface ClientConfig {
  contract: 1; policy: string; regionMode: 'auto' | RegionMode; banner: BannerMode;
  /** LazyAdapter entries and any future browser kinds; unknown kinds wait for their slot. */
  plugins?: readonly RawContribution[];
  maxAgeDays?: number; cookieDomain?: string;
}
/** What #jini-consent-config holds: the config plus the evidence mode the host chose. */
export type PageConfig = ClientConfig & { evidence?: Evidence };
export interface JiniConsentApi {
  readonly contract: 1;
  readonly plugins: PluginRegistry;
  get(): ConsentState;
  subscribe(required: { listener: (state: ConsentState) => void }, optional?: object): () => void;
  /** Denial applies before any network; GPC clamps the result and nothing can lift it. */
  set(required: { action: ConsentAction }, optional?: { choices?: Partial<Flags> }): Promise<ConsentState>;
  /** Ask whichever banner is installed to show its preferences (dispatches OPEN_EVENT). */
  open(): void;
  /** A banner reports whether it is showing, so html[data-consent-open] stays truthful for CSS. */
  setOpen(required: { open: boolean }, optional?: object): void;
}
declare global {
  interface Window { jiniConsent?: JiniConsentApi; jiniConsentQueue?: { push(...items: RawContribution[]): unknown } }
}
