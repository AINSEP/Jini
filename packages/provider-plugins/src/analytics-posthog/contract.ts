/** Structural copy of the `@jini-ai/cookie-consent` browser-adapter contract members this provider reads or returns; the
 * two-way drift guard (`__tests__/consent-contract-drift.typecheck.ts`) proves the fit. A plugin cannot import the domain
 * package, and the consent adapter is delivered to the browser as its own module. Providers never import each other. */

type Optional = 'functional' | 'analytics' | 'marketing';
type Flags = Record<Optional, boolean>;
type Choices = Readonly<{ necessary: true } & Flags>;

interface Contribution<K extends string = string> { readonly id: string; readonly kind: K }
export type RawContribution = Contribution & Record<string, unknown>;

export interface ConsentState {
  contract: 1;
  policy: string;
  status: 'pending' | 'set';
  region: 'opt-in' | 'opt-out';
  /** Effective privacy opt-out: GPC or DNT. The historical field name is retained on receipts. */
  gpc: boolean;
  /** Analytics adapters/collectors must enforce this level, not just allowed.analytics. */
  analyticsLevel: 'none' | 'anonymous' | 'full';
  choices: Choices;
  allowed: Choices;
  action: 'accept' | 'reject' | 'save' | 'do-not-sell' | 'withdraw' | null;
  at: number | null;
  receipt: 'none' | 'local' | 'pending' | 'stored';
}

export interface StoragePrefixes { cookies?: readonly string[]; local?: readonly string[] }
/** The shape of the consent client's `purgeStorage`, which the client hands to every adapter call. */
export type PurgeStorage = (required: { doc: Document; storage: StoragePrefixes }, optional?: object) => void;
/** revoke() true = fully stopped; false or missing = the page reloads to be clean. */
export interface Revoker { revoke?(): boolean | Promise<boolean> }
export interface GrantInput<C> { config: C; state: ConsentState; signal: AbortSignal; purge: PurgeStorage }
export interface ConsentAdapter<C = unknown> extends Contribution<'consent-adapter'> {
  category: Optional;
  supportsAnonymous?: true;
  config?: C;
  storage?: StoragePrefixes;
  grant(required: GrantInput<C>, optional?: object): Promise<Revoker | null> | Revoker | null;
  onState?(required: { state: ConsentState; purge: PurgeStorage }, optional?: object): void;
}
/** Page-config form: `src` is imported on grant, or for cleanup when off and supportsAnonymous. */
export interface LazyAdapter extends Contribution<'consent-adapter'> {
  category: Optional; src: string; config?: unknown; storage?: StoragePrefixes;
  supportsAnonymous?: true;
}
