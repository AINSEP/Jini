import { useEffect, useRef } from "react";

/**
 * A self-scheduling status poll that gives up. While `active`, it waits `intervalMs`, fetches the
 * status, hands it to `onStatus`, and fetches again only if `shouldContinue` says the work is still
 * going. `failureLimit` CONSECUTIVE fetch failures call `onGiveUp` once and stop: an unreachable
 * endpoint (routine in local dev when a watcher restarts the server) must not spin forever behind a
 * disabled action. A success resets the failure count.
 *
 * The loop re-arms only when `active` flips to true (or the interval or limit changes). Callback
 * identities are read through a ref, so a new `onStatus` each render does not restart the timer
 * and push the next fetch out.
 */
export interface BoundedStatusPollInput<S> {
  readonly active: boolean;
  readonly intervalMs: number;
  readonly failureLimit: number;
  readonly fetchStatus: () => Promise<S>;
  readonly onStatus: (required: { status: S }) => void;
  readonly shouldContinue: (required: { status: S }) => boolean;
  readonly onGiveUp: (required: { error: unknown }) => void;
}

type PollOutcome<S> = { readonly ok: true; readonly status: S } | { readonly ok: false; readonly error: unknown };

/** Starts one poll loop reading the latest callbacks from `latest`; returns its cancel function.
 * @complexity O(1) per tick. */
function startBoundedPoll<S>({ latest }: { latest: { readonly current: BoundedStatusPollInput<S> } }): () => void {
  let cancelled = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    timer = setTimeout(() => { void tick(); }, latest.current.intervalMs);
  };
  const tick = async (): Promise<void> => {
    const outcome: PollOutcome<S> = await latest.current.fetchStatus().then(
      (status) => ({ ok: true, status }),
      (error: unknown) => ({ ok: false, error }),
    );
    if (cancelled) return;
    const input = latest.current;
    if (outcome.ok) {
      failures = 0;
      input.onStatus({ status: outcome.status });
      if (input.shouldContinue({ status: outcome.status })) arm();
      return;
    }
    failures += 1;
    if (failures >= input.failureLimit) input.onGiveUp({ error: outcome.error });
    else arm();
  };
  arm();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** @complexity O(1) per render; one timer at a time. */
export function useBoundedStatusPoll<S>(required: BoundedStatusPollInput<S>, _optional: Record<string, never> = {}): void {
  const latest = useRef(required);
  useEffect(() => { latest.current = required; });
  const { active, intervalMs, failureLimit } = required;
  useEffect(() => {
    if (!active) return undefined;
    return startBoundedPoll({ latest });
  }, [active, intervalMs, failureLimit]);
}
