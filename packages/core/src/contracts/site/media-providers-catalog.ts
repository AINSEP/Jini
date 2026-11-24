/**
 * @file Media-provider catalogue shapes. Types only; this module owns the declarations that
 * `@jini-ai/integrations/media-providers` (`types.ts`, re-exported by its `catalog` subpath) used to
 * declare. That package imports them from here and keeps its runtime values.
 */

/**
 * A third-party media-generation vendor (e.g. OpenAI, Fal.ai, ElevenLabs).
 * Reference/catalogue data, not a live connection — a host resolves
 * `credentialsRequired`/`defaultBaseUrl` into its own credential storage.
 */
export interface MediaProvider {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /**
   * Whether this package's dispatch engine has a real adapter/renderer registered for this
   * provider (vs. a planned/future integration that exists only as this catalogue entry). See
   * `dispatch/vendor-registry.ts`'s `mediaVendorRegistry` and `dispatch/engine.ts`'s `ROUTES`
   * table for where that registration actually lives — `providers.test.ts` asserts every
   * `true` entry with a catalogued model resolves to one, so this flag can't drift from
   * reality the way it did for `hyperframes`/`fal`/`leonardo` (all three claimed `true` with
   * no adapter anywhere).
   */
  readonly integrated: boolean;
  readonly defaultBaseUrl?: string;
  readonly docsUrl?: string;
  readonly credentialsRequired?: boolean;
  readonly settingsVisible?: boolean;
  readonly supportsCustomModel?: boolean;
  readonly customModelPlaceholder?: string;
}

/** A specific generation model offered by a `MediaProvider`. */
export interface MediaModel {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly provider: string;
  /** Capability tags, e.g. `t2i`/`i2i`/`inpaint`/`t2v`/`i2v`/`tts`. Open-ended by design — see `archived provenance ledger`. */
  readonly caps: readonly string[];
  readonly default?: boolean;
}
