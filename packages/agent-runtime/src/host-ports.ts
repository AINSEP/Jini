/**
 * @module host-ports
 * Collaborators the composing host injects so this package never imports another package's
 * implementation (owner rule K5, cross-package step XC-3; the why lives in
 * `ADS-memory/reports/jini-port/extraction-plan.md`). The host binds them once, on
 * `createNativeAgentRuntime`, and the runtime keeps them on its `AgentRuntimeState`.
 * A legacy state without ports degrades: PATH-only executable search, no proxy normalization,
 * and no default provider base URLs.
 */

/** Environment shape accepted by the proxy merge: inherited process env or plain configured values. */
export type ProxyEnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** User-level toolchain bin directories (Homebrew, ~/.local/bin, version managers, npm prefixes)
 * searched beyond PATH. `env` is empty when detection is scoped to an override home. */
export type ToolchainBinsPort = (required: { home: string; includeSystemBins: boolean; env: NodeJS.ProcessEnv }) => string[];

/** System proxy discovery and the proxy-consistent merge of spawn env sources (later sources win). */
export interface ProxyEnvPort {
  resolveSystemProxyEnv(): NodeJS.ProcessEnv;
  mergeProxyAwareEnv(required: { platform: NodeJS.Platform; sources: ProxyEnvSource[] }): NodeJS.ProcessEnv;
}

/** Vendors whose default API base URL model discovery may need. */
export type ProviderCatalogVendor = 'anthropic' | 'google' | 'openrouter' | 'openai';

/** The slice of the host's media-provider catalog model discovery reads. */
export interface ProviderBaseUrlCatalog {
  readonly VENDOR_API_BASE_URLS: Readonly<Record<ProviderCatalogVendor, string>>;
}

/** Lazy catalog loader: called only when a default provider URL is needed, so hosts may defer
 * loading the catalog owner until then. */
export type ProviderCatalogImport = () => Promise<ProviderBaseUrlCatalog>;

/** Everything the composing host supplies to one native agent runtime. */
export interface AgentRuntimeHostPorts {
  readonly toolchainBins: ToolchainBinsPort;
  readonly proxyEnv: ProxyEnvPort;
  /** Optional: without it, discovery needs an explicit `*_BASE_URL` or an injected credential port. */
  readonly providerCatalog?: ProviderCatalogImport;
}

/** Legacy fallback when no host port is bound: no system proxy lookup and a plain left-to-right
 * merge without proxy-variable normalization. Pure, O(total keys). */
export const passthroughProxyEnv: ProxyEnvPort = {
  resolveSystemProxyEnv: () => ({}),
  mergeProxyAwareEnv: ({ sources }) => {
    const merged: NodeJS.ProcessEnv = {};
    for (const source of sources) {
      for (const [key, value] of Object.entries(source)) if (value != null) merged[key] = value;
    }
    return merged;
  },
};
