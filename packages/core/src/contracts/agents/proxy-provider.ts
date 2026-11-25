/**
 * @file The registration a host injects into the daemon's `/api/proxy/*` model proxy for one provider: the
 * request parser and the turn-runner call for that provider's wire dialect. The daemon owns generic HTTP work
 * (same-origin guard, body read, SSE transport, error redaction) and looks a provider up by `id` in the
 * registrations it was given; it holds no provider list of its own. Each vendor's registration factory lives
 * in a vendor plugin package (`@jini-ai/provider-plugins/model-proxy-<vendor>`), and the host composition
 * imports those factories and injects the results.
 */
import type { Result } from '../server.js';
import type { DnsLookupFn } from './model-catalog.js';
import type { PinnedFetch, ProviderToolTurnPort, ProviderTurnEventRecord } from './provider-ports.js';

/** The options every turn-runner call takes beyond its provider fields; the daemon fills each only when it has one (transport test seams, host-owned tool execution). */
export interface ProxyRunSharedOptions {
  readonly fetchImpl?: PinnedFetch;
  readonly dnsLookup?: DnsLookupFn;
  executeTool?(call: unknown): Promise<unknown>;
}

/** What the daemon hands a registration's `run`: the host-bound runners, the event sink for the open stream, and the shared options to spread into the runner's optional bag. */
export interface ProxyRunContext {
  readonly toolTurns: ProviderToolTurnPort;
  onEvent(event: ProviderTurnEventRecord): void;
  readonly shared: ProxyRunSharedOptions;
}

/**
 * One provider's proxy behaviour. `id` is the `:provider` path segment (and the `<id>ExecuteTool` option the
 * host may set). `parse` turns the JSON body into the provider's request or a 400; `run` starts the turn and
 * resolves when it ends. A provider's tool-turn runner is a member of `ProviderToolTurnPort`.
 */
export interface ProxyProviderRegistration<Parsed = unknown> {
  readonly id: string;
  parse(body: unknown): Result<Parsed>;
  run(parsed: Parsed, context: ProxyRunContext): Promise<unknown>;
}
