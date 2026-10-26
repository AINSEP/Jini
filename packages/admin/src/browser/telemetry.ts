/** Browser telemetry over host-bound transport, timers and session state. Route names stay with the host. */
export type BrowserTelemetryPayload =
  | { type: "error"; message: string; stack: string; componentStack?: string | undefined; route: string }
  | { type: "pageview"; route: string };

type ErrorPayload = Extract<BrowserTelemetryPayload, { type: "error" }>;

export interface BrowserTelemetryDeps {
  send(payload: BrowserTelemetryPayload): Promise<unknown>;
  nowMs(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface BrowserTelemetry {
  /** Only a signed-in session can post; before sign-in everything is dropped. */
  setSignedIn(signedIn: boolean): void;
  /** The current route template; errors carry it, and a change sends a (debounced) page view. */
  setRoute(route: string): void;
  reportError(input: { error: unknown; componentStack?: string | undefined }): void;
}

/** Mirrors the server's caps (`browser-telemetry.ts`): longer text is cut here, not refused there. */
const CAPS = { message: 1_000, stack: 8_000, componentStack: 4_000, route: 200 } as const;
const WINDOW_MS = 60_000;
const DEDUPE_MS = 5 * 60_000;
const MAX_FINGERPRINTS = 200;

/** Message of an Error or a thrown string; any other thrown value is named by type only, never dumped. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return `Non-Error thrown (${error === null ? "null" : typeof error})`;
}

function errorPayload({ error, componentStack, route }: { error: unknown; componentStack?: string | undefined; route: string }): ErrorPayload {
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  const cs = componentStack ? componentStack.slice(0, CAPS.componentStack) : "";
  return { type: "error", message: messageOf(error).slice(0, CAPS.message), stack: stack.slice(0, CAPS.stack), ...(cs ? { componentStack: cs } : {}), route };
}

/** Message + first stack frame: the same bug from the same place is one report, not hundreds. */
function fingerprintOf(payload: ErrorPayload): string {
  const frame = payload.stack.split("\n").find((line) => /\bat\b|@/.test(line)) ?? "";
  return `${payload.message}|${frame.trim()}`;
}

/**
 * Builds the telemetry engine over injected I/O so its dedupe, cap and debounce are testable.
 * @complexity O(1) amortized per call; O(f) memory for at most {@link MAX_FINGERPRINTS} fingerprints.
 */
export function createBrowserTelemetry(deps: BrowserTelemetryDeps, { maxErrorsPerMinute = 10, pageviewDelayMs = 1_000, initialRoute = "" } = {}): BrowserTelemetry {
  let signedIn = false;
  let route = initialRoute;
  let lastPageview: string | null = null;
  let timer: unknown = null;
  let sentAt: number[] = [];
  const seen = new Map<string, number>();

  const post = (payload: BrowserTelemetryPayload): void => {
    try { void deps.send(payload).catch(() => {}); } catch { /* never throws */ }
  };
  const underCap = (now: number): boolean => {
    sentAt = sentAt.filter((at) => now - at < WINDOW_MS);
    return sentAt.length < maxErrorsPerMinute;
  };
  const isRepeat = (fingerprint: string, now: number): boolean => {
    const last = seen.get(fingerprint);
    if (last !== undefined && now - last < DEDUPE_MS) return true;
    seen.delete(fingerprint);
    if (seen.size >= MAX_FINGERPRINTS) seen.delete(seen.keys().next().value as string);
    seen.set(fingerprint, now);
    return false;
  };
  const flushPageview = (): void => {
    timer = null;
    if (!signedIn || route === lastPageview) return;
    lastPageview = route;
    post({ type: "pageview", route });
  };

  return {
    setSignedIn(next) { signedIn = next; if (!next) lastPageview = null; },
    setRoute(next) {
      route = next.slice(0, CAPS.route);
      try {
        if (timer !== null) deps.clearTimer(timer);
        timer = deps.setTimer(flushPageview, pageviewDelayMs);
      } catch { /* never throws */ }
    },
    reportError({ error, componentStack }) {
      try {
        if (!signedIn) return;
        const payload = errorPayload({ error, componentStack, route });
        const now = deps.nowMs();
        if (isRepeat(fingerprintOf(payload), now) || !underCap(now)) return;
        sentAt.push(now);
        post(payload);
      } catch { /* never throws */ }
    },
  };
}

/**
 * Window-level errors the React root never sees (event handlers, timers, promises).
 * @returns Uninstall.
 */
export function installBrowserErrorListeners({ target, telemetry }: { target: Pick<Window, "addEventListener" | "removeEventListener">; telemetry: Pick<BrowserTelemetry, "reportError"> }, _options = {}): () => void {
  const onError = (event: ErrorEvent): void => {
    // A cross-origin "Script error." carries nothing usable; skip it rather than report noise.
    if (event.error === undefined || event.error === null) return;
    telemetry.reportError({ error: event.error });
  };
  const onRejection = (event: PromiseRejectionEvent): void => telemetry.reportError({ error: event.reason });
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

