/**
 * @file Cookie-consent contract types shared with hosts and plugins: the consent state, the saved
 * host policy, plugin contributions, the server region resolver and declared scripts. Moved from
 * `@jini-ai/cookie-consent` (`contract.ts`, `render/css.ts`), which re-exports them and keeps the
 * runtime constants (`OPTIONAL`, `CATEGORIES`, `ACTIONS`, `BANNER_MODES`, `REGION_KIND`), each
 * checked against the unions below with `satisfies`. Types only (XP4).
 */

/** Bounded appearance tokens; colors are opaque hex and must meet 4.5:1 contrast. */
export interface ConsentAppearanceTokens {
  backgroundColor?: string; textColor?: string; borderColor?: string; borderRadius?: string;
  padding?: string; fontSize?: string; maxWidth?: string; fontFamily?: string;
}

/** The optional categories; `OPTIONAL` in @jini-ai/cookie-consent lists them at runtime. */
export type Optional = 'functional' | 'analytics' | 'marketing';
/** `CATEGORIES` in @jini-ai/cookie-consent lists them at runtime. */
export type Category = 'necessary' | Optional;
export type Flags = Record<Optional, boolean>;
export type Choices = Readonly<{ necessary: true } & Flags>;
/** `ACTIONS` in @jini-ai/cookie-consent lists them at runtime. */
export type ConsentAction = 'accept' | 'reject' | 'save' | 'do-not-sell' | 'withdraw';
export type RegionMode = 'opt-in' | 'opt-out';
/** A resolver's definite answer. Resolvers return null for "unknown: ask the next one". */
export type RegionHint = 'us' | 'strict';
/** jini = the built-in banner; headless = "My own" banner; off = anonymous analytics only, no UI. */
export type BannerMode = 'jini' | 'headless' | 'off';
/** 'stored' = server receipt; 'pending' = sent, unconfirmed; 'local' = browser-only, labelled as such. */
export type ReceiptStatus = 'none' | 'local' | 'pending' | 'stored';

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
  /** Full category permissions; durable grants await their receipt. Never read `choices` as permission.
   * Anonymous analytics keeps allowed.analytics false; adapters/collectors use analyticsLevel. */
  allowed: Choices;
  action: ConsentAction | null;
  at: number | null;
  receipt: ReceiptStatus;
}

/** Saved host policy. Existing revisions keep their field names when execution moves to declarations. */
export interface ConsentConfig {
  enabled: boolean;
  /** @deprecated Retained for saved-setting compatibility; declared scripts do not evaluate this flag. */
  allowUnsafeEval?: boolean;
  regionMode: 'auto' | RegionMode;
  policyVersion: string;
  privacyPolicyUrl: string;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  preferencesLabel: string;
  placement?: 'bottom-bar' | 'bottom-left' | 'bottom-right' | 'top-bar';
  reopen?: 'corner' | 'link';
  secondaryLinkLabel?: string;
  secondaryLinkUrl?: string;
  appearance?: ConsentAppearanceTokens;
  customCss?: string;
  bannerMode?: BannerMode;
}

/** Internal delivery evidence; never an analytics property or visitor identity. */
export interface ConsentAnalyticsProof { receiptId: string; policyVersion: string }

// ---- Plugin slots: an OPEN set. A kind is a string; whoever consumes a kind defines it. ----
export interface Contribution<K extends string = string> { readonly id: string; readonly kind: K }
export type RawContribution = Contribution & Record<string, unknown>;

// ---- Slot kind: server region resolver ----
export interface RegionRequest { header(name: string): string | null; ip: string | null }
export interface RegionResolver extends Contribution<'region-resolver'> {
  resolve(required: { request: RegionRequest }, optional?: { signal?: AbortSignal }): RegionHint | null | Promise<RegionHint | null>;
}

export interface DeclaredScript { src: string; consent?: readonly Category[] }
