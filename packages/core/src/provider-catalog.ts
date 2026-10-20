/**
 * Neutral catalog contracts consumed by UI and implemented by host adapters.
 * Vendor identities, aliases and endpoint defaults belong to integrations.
 */

/** UI catalog identity policy. Operations are pure, synchronous and must agree on IDs.
 * Normalization returns a new map, preserves values, and resolves alias collisions
 * deterministically. The host keeps one policy for the lifetime of a mounted tab.
 *
 * @example
 * MediaProvidersTab({ port, catalog, catalogPolicy: mediaProviderCatalogPolicy });
 */
export interface MediaProviderCatalogPolicy {
  /** Canonicalize catalog entries, pinned IDs, edits and clears; preserve unknown IDs. */
  canonicalMediaProviderId(input: { id: string }, options?: Record<string, never>): string;
  /** Normalize initial state and daemon replies before reconciliation. Canonical entries win aliases. */
  normalizeMediaProviderMap<T>(
    input: { providers: Readonly<Record<string, T>> },
    options?: Record<string, never>,
  ): Record<string, T>;
}

/**
 * One selectable provider in the host-supplied catalog.
 */
export interface MediaProviderOption {
  id: string;
  label: string;
  /** Prefilled when the operator picks this provider and typed nothing. */
  defaultBaseUrl?: string;
  /** Model ids this provider advertises. A host that discovers models at
   *  runtime can leave this empty. */
  models?: readonly string[];
}


/** Whether a preset appears in the protocol or gateway chip row. */
export type ProviderPresetKind = 'protocol' | 'gateway';

/** One host-supplied endpoint preset, parameterized by the consumer's wire protocols. */
export interface ProviderPreset<Protocol extends string = string> {
  id: string;
  title: string;
  protocol: Protocol;
  baseUrl: string;
  /** Ranked suggestions shown in the model field. Never authoritative — a
   *  host with live model discovery should pass `ExecutionPort.listModels`. */
  preferredModels: readonly string[];
  kind?: ProviderPresetKind;
  /** Fixed-origin gateways resolve their base URL themselves, so the Base URL
   *  field is hidden rather than shown-and-ignored (origin: `isFixedOriginGateway`). */
  fixedOrigin?: boolean;
  /** Some local/self-hosted endpoints need no bearer credential. Defaults to
   *  `true` — i.e. an API key is required unless a preset opts out. */
  requiresApiKey?: boolean;
  /** Optional "Get key" deep link rendered beside the API-key field. */
  apiKeyConsoleUrl?: string;
  /**
   * The literal prefix that positively identifies a pasted key as belonging to THIS provider —
   * `'AIza'` for Google, `'sk-ant-'` for Anthropic. Omit it for a vendor whose keys carry no
   * distinguishing prefix (Azure OpenAI's are bare hex) rather than inventing one.
   *
   * Read in exactly one direction: to recognise a key as SOMEONE ELSE'S. It is deliberately NOT an
   * allowlist, and no code may ask "does the selected preset's key match this?" as a validity test.
   * That is the shape this field replaced, and it shipped a false positive within hours of landing:
   * a real Google Gemini key in a newer shape than `/^AIza/` was reported to its owner as not
   * looking like a Google key. Vendors add key formats without telling anyone, so a catalog can
   * prove a string belongs to vendor X, but never that it belongs to nobody. See
   * `apiKeyFormatWarning`.
   *
   * Data rather than an `if (providerId === …)` chain in the rule, so adding a provider stays a row
   * in the preset catalog — including for a host that supplies its own `presets` and never touches
   * this package.
   */
  apiKeyPrefix?: string;
  /** The synthetic "Custom" preset. Exactly one may carry this flag; it is
   *  never treated as configured-by-preset and never hides the Base URL. */
  custom?: boolean;
}

