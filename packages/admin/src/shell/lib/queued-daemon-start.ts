import { orFallback } from "@jini-ai/core/errors/idioms";

export interface QueuedStartPorts {
  readonly post: (required: { body: unknown }, optional?: Record<string, never>) => Promise<Response>;
  readonly wait: (required: { signal?: AbortSignal | undefined }, optional?: Record<string, never>) => Promise<void>;
}

/** Follow-ups wait in this browser only (no durable queue in this cut). Keep the same message
 * identity across retries, and never require an operator to resend a refused concurrent turn. */
export async function startQueuedDaemonRun(
  { body, signal, ports }: { body: unknown; signal?: AbortSignal; ports: QueuedStartPorts }, _optional = {},
): Promise<Response> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("The queued turn was stopped.", "AbortError");
    const response = await ports.post({ body }, {});
    if (response.status !== 409) return response;
    // A non-JSON conflict is returned unchanged for the caller to handle.
    const payload = await orFallback({ work: () => response.clone().json(), fallback: null, step: "Read queued run refusal" }) as { code?: string } | null;
    if (payload?.code !== "CHAT_RUN_BUSY") return response;
    await ports.wait({ signal }, {});
  }
}

/** Browser adapters for {@link startQueuedDaemonRun}. `request` and `schedule` are injectable so
 * the POST shape and the 1s client-side backoff (including Stop during it) are verified with
 * fakes; the defaults are the real browser `fetch` and `setTimeout`. */
export function browserQueuedStartPorts(_required = {}, {
  request = fetch,
  schedule = ({ work, delayMs }: { work: () => void; delayMs: number }) => {
    const timer = setTimeout(work, delayMs); return () => clearTimeout(timer);
  },
}: {
  request?: typeof fetch;
  schedule?: (required: { work: () => void; delayMs: number }) => () => void;
} = {}): QueuedStartPorts {
  return {
    post: ({ body }, _options = {}) => request("/api/runs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    wait: ({ signal }, _options = {}) => new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("The queued turn was stopped.", "AbortError")); return; }
      const cancel = schedule({ work: () => { signal?.removeEventListener("abort", abort); resolve(); }, delayMs: 1_000 });
      function abort() { cancel(); reject(new DOMException("The queued turn was stopped.", "AbortError")); }
      signal?.addEventListener("abort", abort, { once: true });
    }),
  };
}
