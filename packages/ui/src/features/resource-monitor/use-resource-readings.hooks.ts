/** Pull-only resource readings. The host's sampler owns sampling policy and process attribution. */
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { useEffect, useRef, useState } from "react";

/** The one request field the sampler receives: an open panel asks for the faster cadence. */
export interface ResourceReadingsRequest {
  panelOpen: boolean;
}

/** The only snapshot field this hook reads: the sampler's cadence for the next visible poll. */
export interface ResourceReadingsSnapshot {
  readonly pollIntervalMs: number;
}

/** Effects at the renderer boundary; fakes need neither a desktop shell nor real timers. */
export interface ResourceReadingsPorts<TSnapshot extends ResourceReadingsSnapshot> {
  /** The host's sampler bridge lookup. `undefined` (or no `getResources`) means a stale preload: no polling. */
  getBridge: () => { getResources?: (input: ResourceReadingsRequest) => Promise<TSnapshot> } | undefined;
  /** The visibility source: polling stops while it is hidden. */
  document: {
    readonly hidden: boolean;
    addEventListener: (event: "visibilitychange", listener: () => void) => void;
    removeEventListener: (event: "visibilitychange", listener: () => void) => void;
  };
  setTimer: (input: { run: () => void; delay: number }) => number;
  clearTimer: (input: { id: number }) => void;
}

/** A visibility change invalidates a pending reading; retry it before the next normal cadence. */
function pollDelay(
  { currentVisibility, snapshot, retryDelayMs }: { currentVisibility: boolean; snapshot: ResourceReadingsSnapshot | null; retryDelayMs: number },
  _options = {},
) {
  if (!currentVisibility) return 0;
  // A failed IPC read has no main-process cadence; retry promptly instead of waiting a minute.
  return snapshot?.pollIntervalMs ?? retryDelayMs;
}

/**
 * Read one shared snapshot while the host document is visible. Returns null on IPC failure or
 * stale preload; native errors never enter the UI. Cleanup removes the listener and timer.
 * A shared promise serializes reads even when opening the panel replaces the effect mid-request.
 * A changed refreshKey requests a reading after a site lifecycle change, retaining the normal cadence.
 * Keep `ports` stable: it is an effect dependency.
 * @example const snapshot = useResourceReadings({ panelOpen, ports });
 * @complexity O(1) work/state per poll beyond the existing main-process IPC.
 */
export function useResourceReadings<TSnapshot extends ResourceReadingsSnapshot>(
  { panelOpen, ports }: ResourceReadingsRequest & { ports: ResourceReadingsPorts<TSnapshot> },
  { refreshKey, retryDelayMs = 5_000 }: { refreshKey?: string; retryDelayMs?: number } = {},
): TSnapshot | null {
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const inFlight = useRef<Promise<TSnapshot | null> | null>(null);
  const failing = useRef(false);
  useEffect(() => {
    const bridge = ports.getBridge();
    if (!bridge?.getResources) return undefined;
    const getResources = bridge.getResources.bind(bridge);
    let active = true;
    let pending = false;
    let visibilityVersion = 0;
    let timer: number | undefined;

    /** Clear the scheduled read before hiding, refreshing or disposing this effect. */
    function clearTimer() {
      if (timer !== undefined) ports.clearTimer({ id: timer });
      timer = undefined;
    }

    /** Resolve failures locally: raw native/IPC messages may contain sensitive process details. */
    function readOnce() {
      return Promise.resolve().then(() => getResources({ panelOpen })).then((result) => {
        failing.current = false;
        return result;
      }).catch((error: unknown) => {
        if (!failing.current) console.error("[resources] Could not read resource usage", describeErrorForLog({ err: error }));
        failing.current = true;
        return null;
      });
    }

    /** Re-check visibility after awaiting another effect's read; never overlap IPC requests. */
    async function poll() {
      if (pending) return;
      pending = true;
      await inFlight.current;
      if (!active || ports.document.hidden) { pending = false; return; }
      const version = visibilityVersion;
      const request = readOnce();
      inFlight.current = request;
      const next = await request;
      inFlight.current = null;
      pending = false;
      if (!active || ports.document.hidden) return;
      const currentVisibility = version === visibilityVersion;
      if (currentVisibility) setSnapshot(next);
      timer = ports.setTimer({ run: () => { void poll(); }, delay: pollDelay({ currentVisibility, snapshot: next, retryDelayMs }) });
    }

    /** A hidden document owns no timer. Returning to it asks main for a fresh/cached snapshot. */
    function visibilityChanged() {
      visibilityVersion++;
      clearTimer();
      if (!ports.document.hidden) void poll();
    }
    ports.document.addEventListener("visibilitychange", visibilityChanged);
    void poll();
    return () => {
      active = false;
      clearTimer();
      ports.document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [panelOpen, ports, refreshKey, retryDelayMs]);
  return snapshot;
}
