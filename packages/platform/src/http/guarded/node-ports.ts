import { lookup } from "node:dns/promises";
import { FetchHttpTransportAdapter } from "./transport.fetch.js";
import type { GuardedClock, DnsResolver, PinnedHttpTransport } from "./ports.js";

/** Constructs native effect ports without resolving or connecting to any destination. */
export function createNodeGuardedHttpPorts(_required: Record<string, never>): { dns: DnsResolver; clock: GuardedClock; transport: PinnedHttpTransport } {
  return {
    dns: { resolve: async ({ hostname }) => (await lookup(hostname, { all: true, verbatim: true })).map(entry => entry.address) },
    clock: { nowMs: () => Date.now(), timeoutSignal: ({ timeoutMs }) => AbortSignal.timeout(timeoutMs) },
    transport: new FetchHttpTransportAdapter({}),
  };
}
