/**
 * @file Immutable pinning and changing-capability delivery for a hosted MCP endpoint that one host
 * process owns and hands to the processes it spawns.
 *
 * Why this exists: the spawning process holds a loopback `{ url, token }` capability plus a private
 * handoff token. A child must be able to read the capability once, then lose the environment copy
 * (so nothing it spawns inherits it), and a different process must never be able to replace a
 * capability that is already pinned. The token is reachable ONLY through the bearer supplier, which
 * answers only for the exact pinned endpoint; no accessor hands out the pinned object or the token.
 * When the listener binds late or rebinds, the new capability is delivered to the child with the
 * handoff token as bearer; delivery is cancellable and never replays tool calls.
 *
 * The endpoint policy (which URL spellings count as a capability) and the environment variable
 * NAMES are the host's: they arrive as `isCapability` and `names`. The handoff token format is fixed
 * here: 64 lowercase hex characters (32 random bytes); any other value is dropped, not accepted.
 */
import type { McpBearerTokenSupplier } from "@jini-ai/core/contracts/hosted-mcp";

export interface PinnedCapability { readonly url: string; readonly token: string }

/** Environment variable names the spawn contract uses. They are scrubbed from `env` on capture. */
export interface PinnedCapabilityNames { readonly url: string; readonly token: string; readonly handoff: string }

export interface PinnedCapabilityRuntime {
  readonly handoffToken: string | undefined;
  /** True once this process was handed a capability or the authority to receive one. */
  readonly owned: boolean;
  /** The names this runtime deleted from the `env` object it was given, so a host can assert on them. */
  readonly scrubbed: readonly string[];
  /** Answers only for the exact pinned endpoint; anything else gets no token. */
  readonly bearerToken: McpBearerTokenSupplier;
  /** The pinned endpoint URL, or `null` while none is pinned. Never the token and never the pin itself. */
  endpointUrl(required: Record<string, never>, optional?: Record<string, never>): string | null;
  accept(required: PinnedCapability, optional?: Record<string, never>): boolean;
}

export interface PinnedCapabilityRequired {
  /** Mutated: the three named keys are deleted from THIS object. Pass the live environment object the
   *  process's children inherit; if you pass a copy, nothing a child inherits is scrubbed and the host
   *  must delete the same names from the live environment itself. */
  readonly env: Record<string, string | undefined>;
  readonly names: PinnedCapabilityNames;
  /** Host endpoint policy: exact spelling and token shape of an acceptable capability. It is shown a
   *  detached copy holding only `url` and `token`, and exactly that copy is what gets pinned. */
  readonly isCapability: (value: unknown) => value is PinnedCapability;
}

const HANDOFF_PATTERN = /^[a-f0-9]{64}$/;

/** A detached, frozen `{ url, token }` read once from `value`: extra properties are never held, and a
 * later change to the caller's object (or a property that answers differently on a second read) cannot
 * reach the pin. Non-objects pass through for the host predicate to refuse. */
function detached({ value }: { value: unknown }, _optional: Record<string, never> = {}): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { url, token } = value as { url?: unknown; token?: unknown };
  return Object.freeze({ url, token });
}

/** Deletes the three contract keys from `env`, valid or not, and reports which ones were present. */
function scrub({ env, names }: Pick<PinnedCapabilityRequired, "env" | "names">, _optional: Record<string, never> = {}): readonly string[] {
  const present = [names.url, names.token, names.handoff].filter(key => key in env);
  for (const key of present) delete env[key];
  return Object.freeze(present);
}

/** Capture and scrub the spawn contract before any child can inherit it. An initial bind failure
 * leaves only the handoff authority; its authenticated later delivery can fill the endpoint once.
 * A different process can never replace a pinned endpoint, and nothing the runtime returns can move
 * the pin. No I/O or persistence.
 * @example const runtime = createPinnedCapabilityRuntime({ env: process.env, names, isCapability });
 * @complexity O(1) time/state.
 */
export function createPinnedCapabilityRuntime(
  { env, names, isCapability }: PinnedCapabilityRequired,
  _optional: Record<string, never> = {},
): PinnedCapabilityRuntime {
  const candidate = detached({ value: { url: env[names.url], token: env[names.token] } });
  let capability: PinnedCapability | undefined = isCapability(candidate) ? candidate : undefined;
  const suppliedHandoff = env[names.handoff];
  const handoffToken = suppliedHandoff && HANDOFF_PATTERN.test(suppliedHandoff) ? suppliedHandoff : undefined;
  const scrubbed = scrub({ env, names });
  return {
    handoffToken,
    owned: capability !== undefined || handoffToken !== undefined,
    scrubbed,
    bearerToken: ({ url }) => (capability && url === capability.url ? capability.token : undefined),
    endpointUrl: (_required, _optional = {}) => capability?.url ?? null,
    accept(input, _optional = {}) {
      const delivered = detached({ value: input });
      if (!isCapability(delivered)) return false;
      if (capability && (capability.url !== delivered.url || capability.token !== delivered.token)) return false;
      capability ??= delivered;
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
  /** Called when the host promise rejects or subscribing throws, with that error as thrown. It is never
   *  a delivery failure (those reject to the subscribed runtime), so it carries no token and no request
   *  body; the host still words and redacts the warning it shows. */
  readonly onUnavailable: (required: { error: unknown }, optional?: Record<string, never>) => void;
}

export interface CapabilityDeliveryOptions { readonly timeoutMs?: number }

/** Deliver every capability the host publishes to one child until `disconnect`. Retries belong to the
 * subscribed runtime, which also repairs the listener; a failed POST rejects so it retries. The POST
 * never follows a redirect (the handoff bearer goes to the one configured endpoint only) and is aborted
 * by `disconnect` and by the timeout. A refused delivery names the HTTP status and nothing else.
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
      if (!response.ok) throw new Error(`Capability handoff unavailable: the receiving process answered HTTP ${response.status}`);
    } });
  }).catch((error: unknown) => { onUnavailable({ error }); });
  return { disconnect(_required, _optional = {}) { abort.abort(); unsubscribe?.(); } };
}
