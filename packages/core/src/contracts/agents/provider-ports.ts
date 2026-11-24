/** @file The provider tool-turn runners and the pinned HTTP transport that `model-proxy` calls, stated as one port (consumed by `@jini-ai/daemon`'s model proxy).
 * The host binds it (the `server` preset or any host: the `run<Provider>ToolTurn` functions of `@jini-ai/agent-runtime`) and
 * proves the match with `satisfies ProviderToolTurnPort`. The vendor wire types (Anthropic, OpenAI, Azure, Google, Ollama
 * messages, tool definitions, events) stay out of daemon and core (vendor rule), so each member takes the loose shape the
 * proxy forwards: `messages: readonly unknown[]`, events as `{ type }`, a tool call as `unknown`. Method syntax makes the
 * check against the typed runner bivariant: it proves the argument names, the required-versus-optional split and the
 * result, not the wire payload. R7 threads this port into the route's deps as a required field.
 * The base-URL SSRF guard port lives here too: both are the outbound-provider seam a host binds. */
import type { DnsLookupAddress, DnsLookupFn } from './model-catalog.js';

export interface BaseUrlValidationResult {
  parsed?: URL;
  error?: string;
  forbidden?: boolean;
  /**
   * The validated address to pin the outbound connection to, present exactly when
   * {@link validateBaseUrlResolved} performed a DNS lookup and passed it (i.e. never set by
   * {@link validateBaseUrl} alone, and never set for the loopback-literal / IP-literal hosts that
   * skip resolution — see that function's doc for why those two cases need no pinning). Feed this
   * straight into {@link pinnedFetch} so the connection dials the exact address the guard approved
   * instead of re-resolving DNS when it dials.
   */
  pinnedAddress?: DnsLookupAddress;
}

/** The base-URL SSRF guard a provider route needs before it calls out (bound by the host; R7 wires it into the route deps). */
export interface BaseUrlGuardPort {
  validate(required: { baseUrl: string }): BaseUrlValidationResult;
}

/** Request options accepted by the pinned fetch: the subset of `fetch`'s `init` the provider adapters pass. `redirect` is documentation of intent: the pinned fetch never follows a redirect. */
export interface PinnedFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly redirect?: 'error';
  readonly signal?: AbortSignal;
}

/** The subset of `fetch`'s `Response` the provider adapters consume. */
export interface PinnedFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: AsyncIterable<Uint8Array> | null;
  text(): Promise<string>;
}

/** The SSRF-guarded, DNS-pinned transport; a test passes a fake through the `fetchImpl` seam. Never override it in production wiring: that bypasses the guard. */
export type PinnedFetch = (
  requiredArgs: { url: string; init: PinnedFetchInit; pinnedAddress: DnsLookupAddress | undefined },
) => Promise<PinnedFetchResponse>;

/** One event of a provider turn, as the proxy relays it: the discriminant is all the daemon reads. */
export interface ProviderTurnEventRecord { readonly type: string }

/** What every runner takes besides its provider-specific fields. */
interface ToolTurnRequired {
  readonly apiKey: string;
  readonly model: string;
  onEvent(event: ProviderTurnEventRecord): void;
}

/** Optional fields every runner accepts, forwarded only when the caller supplied them. */
interface ToolTurnOptional {
  readonly temperature?: number;
  readonly maxToolTurns?: number;
  readonly extraHeaders?: Record<string, string>;
  readonly tools?: readonly unknown[];
  readonly fetchImpl?: PinnedFetch;
  readonly dnsLookup?: DnsLookupFn;
  /** Host-owned tool execution; omit it to run a single request with no tool-result loop. */
  executeTool?(call: unknown): Promise<unknown>;
}

export interface ProviderToolTurnResult { readonly finishReason: string | null; readonly toolTurns: number }
export interface AnthropicToolTurnResult { readonly stopReason: string | null; readonly toolTurns: number }

export interface ProviderToolTurnPort {
  anthropic(
    required: ToolTurnRequired & { readonly maxTokens: number; readonly messages: readonly unknown[] },
    optional?: ToolTurnOptional & { readonly baseUrl?: string; readonly apiVersion?: string; readonly system?: string },
  ): Promise<AnthropicToolTurnResult>;
  openai(
    required: ToolTurnRequired & { readonly messages: readonly unknown[] },
    optional?: ToolTurnOptional & { readonly baseUrl?: string; readonly maxTokens?: number },
  ): Promise<ProviderToolTurnResult>;
  azure(
    required: ToolTurnRequired & { readonly baseUrl: string; readonly messages: readonly unknown[] },
    optional?: ToolTurnOptional & { readonly apiVersion?: string; readonly maxTokens?: number },
  ): Promise<ProviderToolTurnResult>;
  google(
    required: ToolTurnRequired & { readonly contents: readonly unknown[] },
    optional?: ToolTurnOptional & { readonly baseUrl?: string; readonly system?: string; readonly maxOutputTokens?: number },
  ): Promise<ProviderToolTurnResult>;
  ollama(
    required: ToolTurnRequired & { readonly messages: readonly unknown[] },
    optional?: ToolTurnOptional & { readonly baseUrl?: string; readonly maxTokens?: number },
  ): Promise<ProviderToolTurnResult>;
}
