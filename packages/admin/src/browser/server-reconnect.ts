import { orFallback } from "@jini-ai/core/errors/idioms";

/**
 * @file Riding out a server restart (2026-10-05, big-chat-capabilities plan S3). When the API is
 * briefly gone — `tsx watch` reloading on a save, or `npm run dev` restarting it onto a newly
 * switched site — `request()` (`api.ts`) waits here for `/readyz` to answer again and retries,
 * instead of failing the screen (the owner's login failed with ECONNREFUSED through the Vite proxy
 * exactly this way). The status drives the "Server restarting…" banner
 * (`@jini-ai/admin`'s `ServerRestartingBanner`, bound in `lib/shell-notices-wiring.tsx`).
 *
 * Which failures may be retried is {@link shouldRetryAfterReconnect}'s call: reads always; a write
 * only when it provably never reached the server (the dev proxy marks a refused upstream with
 * {@link UPSTREAM_REFUSED_HEADER}), or when the caller says repeating it is harmless (login). A
 * write that may have half-run on the dying server is never repeated.
 *
 * No React here: a tiny store plus `useSyncExternalStore` in the banner's hook.
 */

export type ServerConnectionStatus = "online" | "reconnecting" | "unreachable";

export interface ServerReconnectDeps {
  /** `true` once the real server answers `/readyz` (either its 200 or its 503 JSON). */
  probe: () => Promise<boolean>;
  sleep: (required: { ms: number }, optional?: Record<string, never>) => Promise<void>;
  now: () => number;
}

export interface ServerReconnectOptional {
  pollMs?: number;
  /** Long enough for a dev restart (tsc compile ~5-10s, plus a site's first boot), short enough that
   *  a server that is really down is reported within a minute. */
  timeoutMs?: number;
}

export interface ServerReconnect {
  getStatus(): ServerConnectionStatus;
  subscribe(listener: () => void): () => void;
  /** Polls until the server answers or the timeout passes. Concurrent callers share one poll.
   *  @returns whether the server is back. */
  waitUntilReachable(): Promise<boolean>;
  /** A request just reached the server: an "unreachable" status is over (A-2, 2026-10-22). Only the
   *  poll used to set "online", so after a timed-out outage the banner stayed up on a working admin
   *  until the next outage. A running poll keeps "reconnecting" and settles it itself. */
  markReachable(): void;
}

/**
 * @complexity O(timeoutMs / pollMs) probes per outage, shared by every waiting request.
 */
export function createServerReconnect(deps: ServerReconnectDeps, optional: ServerReconnectOptional = {}): ServerReconnect {
  const pollMs = optional.pollMs ?? 500;
  const timeoutMs = optional.timeoutMs ?? 60_000;
  let status: ServerConnectionStatus = "online";
  let inFlight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  // Listeners hear only real transitions. `waitUntilReachable` publishes the shared poll before it
  // starts, so a listener that waits on "reconnecting" joins it instead of re-entering `poll`; this
  // guard stays as the second line of defence against a listener being told the same status twice.
  function setStatus(next: ServerConnectionStatus): void {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  }

  async function poll(): Promise<boolean> {
    setStatus("reconnecting");
    const deadline = deps.now() + timeoutMs;
    while (!(await deps.probe())) {
      if (deps.now() >= deadline) {
        setStatus("unreachable");
        return false;
      }
      await deps.sleep({ ms: pollMs });
    }
    setStatus("online");
    return true;
  }

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waitUntilReachable() {
      if (inFlight) return inFlight;
      // Assign the shared promise before `poll` runs: its first `setStatus` notifies synchronously.
      let start!: (polled: Promise<boolean>) => void;
      inFlight = new Promise<boolean>((resolve) => (start = resolve)).finally(() => (inFlight = null));
      start(poll());
      return inFlight;
    },
    markReachable() {
      if (status === "unreachable") setStatus("online");
    },
  };
}

/**
 * Whether a failed request should wait for the server and be sent once more.
 * @param input.code - The `ApiError` code (`api.ts`'s `API_UNREACHABLE_CODE` is the only one retried).
 * @param input.method - The request's HTTP method (absent = GET).
 * @param input.upstreamRefused - The dev proxy proved the request never reached the server.
 * @param input.retryWrites - The caller says repeating this write is harmless (login).
 * @complexity O(1); cyclomatic 4.
 */
export function shouldRetryAfterReconnect(input: {
  code: string | undefined;
  unreachableCode: string;
  method: string | undefined;
  upstreamRefused: boolean;
  retryWrites: boolean;
}, _optional: Record<string, never> = {}): boolean {
  if (input.code !== input.unreachableCode) return false;
  const method = (input.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  return input.upstreamRefused || input.retryWrites;
}

/** The real probe: `/readyz` answering with its own JSON (200 ready, or 503 not-ready) means the
 *  server is up; anything else — refused, a proxy's text 5xx, a timeout — means not yet.
 *  `request` defaults to the browser `fetch`; each probe gives up after 2s. */
export async function probeReadyz({ request, url, timeoutSignal }: {
  request: typeof fetch; url: string; timeoutSignal: () => AbortSignal;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  return orFallback({ work: async () => {
    const res = await request(url, { credentials: "same-origin", cache: "no-store", signal: timeoutSignal() });
    const body: unknown = await res.json();
    return typeof (body as { ready?: unknown } | null)?.ready === "boolean";
  }, fallback: false, step: "Probe server readiness" });
}

