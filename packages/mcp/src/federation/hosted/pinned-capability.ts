/**
 * @file Immutable pinning and changing-capability delivery for a hosted MCP endpoint that one host
 * process owns and hands to the processes it spawns.
 *
 * Why this exists: the spawning process holds a loopback `{ url, token }` capability plus a private
 * handoff token. A child must be able to read the capability once, then lose the environment copy
 * (so nothing it spawns inherits it), and a different process must never be able to replace a
 * capability that is already pinned. The bearer supplier therefore answers only for the exact
 * pinned endpoint. When the listener binds late or rebinds, the new capability is delivered to the
 * child with the handoff token as bearer; delivery is cancellable and never replays tool calls.
 *
 * The endpoint policy (which URL spellings count as a capability) and the environment variable
 * NAMES are the host's: they arrive as `isCapability` and `names`.
 */
import type { McpBearerTokenSupplier } from "@jini-ai/core/contracts/hosted-mcp";

export interface PinnedCapability { readonly url: string; readonly token: string }

/** Environment variable names the spawn contract uses. They are scrubbed from `env` on capture. */
export interface PinnedCapabilityNames { readonly url: string; readonly token: string; readonly handoff: string }

export interface PinnedCapabilityRuntime {
  readonly handoffToken: string | undefined;
  /** True once this process was handed a capability or the authority to receive one. */
  readonly owned: boolean;
  /** Answers only for the exact pinned endpoint; anything else gets no token. */
  readonly bearerToken: McpBearerTokenSupplier;
  capability(required: Record<string, never>, optional?: Record<string, never>): PinnedCapability | null;
  accept(required: PinnedCapability, optional?: Record<string, never>): boolean;
}

export interface PinnedCapabilityRequired {
  /** Mutated: the three named keys are deleted before any child can inherit them. */
  readonly env: Record<string, string | undefined>;
  readonly names: PinnedCapabilityNames;
  /** Host endpoint policy: exact spelling and token shape of an acceptable capability. */
  readonly isCapability: (value: unknown) => value is PinnedCapability;
}

const HANDOFF_PATTERN = /^[a-f0-9]{64}$/;

/** Capture and scrub the spawn contract before any child can inherit it. An initial bind failure
 * leaves only the handoff authority; its authenticated later delivery can fill the endpoint once.
 * A different process can never replace a pinned endpoint. No I/O or persistence.
 * @example const runtime = createPinnedCapabilityRuntime({ env, names, isCapability });
 * @complexity O(1) time/state.
 */
export function createPinnedCapabilityRuntime(
  { env, names, isCapability }: PinnedCapabilityRequired,
  _optional: Record<string, never> = {},
): PinnedCapabilityRuntime {
  const candidate = { url: env[names.url], token: env[names.token] };
  let capability: PinnedCapability | undefined = isCapability(candidate) ? candidate : undefined;
  const suppliedHandoff = env[names.handoff];
  const handoffToken = suppliedHandoff && HANDOFF_PATTERN.test(suppliedHandoff) ? suppliedHandoff : undefined;
  for (const key of [names.url, names.token, names.handoff]) delete env[key];
  return {
    handoffToken,
    owned: capability !== undefined || handoffToken !== undefined,
    bearerToken: ({ url }) => (capability && url === capability.url ? capability.token : undefined),
    capability: (_required, _optional = {}) => capability ?? null,
    accept(input, _optional = {}) {
      if (!isCapability(input)) return false;
      if (capability && (capability.url !== input.url || capability.token !== input.token)) return false;
      capability = { ...input };
      return true;
    },
  };
}

/** The slice of a hosted tool-server runtime that capability delivery needs. */
export interface CapabilitySubscribable {
  subscribe(required: { listener: (capability: PinnedCapability) => void | Promise<void> }, optional?: Record<string, never>): () => void;
}

export interface CapabilityDeliveryRequired {
  /** Where each capability is POSTed (already validated by the host's endpoint policy). */
  readonly endpoint: URL;
  readonly handoffToken: string;
  /** Resolves to the hosted runtime, or `undefined` when the listener never became available. */
  readonly host: Promise<CapabilitySubscribable | undefined>;
  readonly fetch: typeof fetch;
  /** Called when subscribing fails; the host words and redacts the warning. */
  readonly onUnavailable: (required: Record<string, never>, optional?: Record<string, never>) => void;
}

export interface CapabilityDeliveryOptions { readonly timeoutMs?: number }

/** Deliver every capability the host publishes to one child until `disconnect`. Retries belong to the
 * subscribed runtime, which also repairs the listener; a failed POST rejects so it retries.
 * @example const { disconnect } = startCapabilityDelivery({ endpoint, handoffToken, host, fetch, onUnavailable });
 * @complexity O(1) state; one POST per published capability.
 */
export function startCapabilityDelivery(
  { endpoint, handoffToken, host, fetch: fetchImpl, onUnavailable }: CapabilityDeliveryRequired,
  { timeoutMs = 5000 }: CapabilityDeliveryOptions = {},
): { disconnect(required: Record<string, never>, optional?: Record<string, never>): void } {
  const abort = new AbortController();
  let unsubscribe: (() => void) | undefined;
  void host.then(runtime => {
    if (abort.signal.aborted) return;
    unsubscribe = runtime?.subscribe({ listener: async capability => {
      const response = await fetchImpl(endpoint, { method: "POST", redirect: "error",
        headers: { authorization: `Bearer ${handoffToken}`, "content-type": "application/json" },
        body: JSON.stringify(capability), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Capability handoff unavailable");
    } });
  }).catch(() => { onUnavailable({}); });
  return { disconnect(_required, _optional = {}) { abort.abort(); unsubscribe?.(); } };
}
