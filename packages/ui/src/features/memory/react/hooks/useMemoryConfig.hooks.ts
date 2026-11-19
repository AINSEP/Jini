// Feature-local hook for the memory config cluster: the master memory switch
// plus the four per-hook flags (chat extraction, profile, rewrite, verify).
//
// This is the slice's hook-wiring paradigm, made concrete:
//   - `useMemoryConfig(port)` is the real hook. Its transport dependency is
//     INJECTED as the slice port, so it holds no import to a provider and
//     unit-tests against a hand-written fake `MemoryConfigPort` — no module
//     mocks, no global `fetch` stub.
//   - business logic (the pure `rules`) is imported directly; only the
//     side-effecting transport is injected.
//   - useWiredMemoryConfig() (below) reads the host-injected config port from
//     MemoryPortsProvider. Production hosts must mount that provider; tests inject
//     a fake port directly or swap the hook. There is no implicit REST fallback.
import { useCallback, useMemo, useRef, useState } from 'react';
import { createAsyncCommitGuard } from '../../async-commit-guard.js';
import type { MemoryConfigPort } from '../../ports.js';
import { enabledPatch, type MemoryConfigFlagKey, singleFlagPatch } from '../../rules.js';
import type { MemoryListResponse } from '../../types.js';
import { useMemoryPorts } from '../MemoryPorts.js';

/** One coalesced write intent: the latest desired value for a setting, plus
 *  every caller awaiting the PATCH that will carry it. */
interface PendingConfigWrite {
  value: boolean;
  settlers: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

/** Per-setting write queue: at most one PATCH on the wire, at most one queued
 *  intent — a toggle issued while a write is queued replaces the queued value
 *  instead of stacking behind it. */
interface ConfigWriteQueue {
  inFlight: boolean;
  pending: PendingConfigWrite | null;
}

const CONFIG_SAVE_ERROR_MESSAGE = "Memory settings couldn't be saved. Try again shortly.";

function newConfigWriteQueue(): ConfigWriteQueue {
  return { inFlight: false, pending: null };
}

function hasUnsettledConfigWrite(queue: ConfigWriteQueue): boolean {
  return queue.inFlight || queue.pending !== null;
}

/**
 * Enqueue one desired value for a setting; the returned promise settles when
 * the PATCH that carries it does (rejecting with the transport error when that
 * PATCH throws). Writes are serialized per queue, so the server can never
 * apply two of this setting's PATCHes in the wrong order: a rapid sequence of
 * toggles coalesces to the latest intent, and that intent is what the last
 * request on the wire carries. `onSettled` receives whether the write was
 * accepted and whether a newer intent is already queued — a failure with a
 * newer intent queued must not roll anything back, because the newer write
 * supersedes it.
 */
function enqueueConfigWrite(
  queue: ConfigWriteQueue,
  value: boolean,
  send: (value: boolean) => Promise<boolean>,
  onSettled: (ok: boolean, value: boolean, hasNewerIntent: boolean) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (queue.pending) {
      queue.pending.value = value;
      queue.pending.settlers.push({ resolve, reject });
    } else {
      queue.pending = { value, settlers: [{ resolve, reject }] };
    }
    if (queue.inFlight) return;
    queue.inFlight = true;
    void (async () => {
      try {
        while (queue.pending) {
          const { value: desired, settlers } = queue.pending;
          queue.pending = null;
          let ok = false;
          let thrown: unknown;
          let didThrow = false;
          try {
            ok = await send(desired);
          } catch (error) {
            didThrow = true;
            thrown = error;
          }
          onSettled(ok, desired, queue.pending !== null);
          settlers.forEach(settler => {
            if (didThrow) settler.reject(thrown);
            else settler.resolve();
          });
        }
      } finally {
        queue.inFlight = false;
      }
    })();
  });
}

/** Everything the config UI (master toggle + hooks panel) needs from the hook. */
export interface MemoryConfigController {
  /** Master memory switch. */
  enabled: boolean;
  /** Non-null after a config PATCH fails; cleared by the next confirmed write. */
  error: string | null;
  /** The four per-hook flags, in the shape the hooks panel consumes. */
  hookFlags: Record<MemoryConfigFlagKey, boolean>;
  /** Flip the master switch (optimistic; rolls back on a failed PATCH). */
  onToggleEnabled: (next: boolean) => Promise<void>;
  /** Flip one per-hook flag (optimistic; rolls back on a failed PATCH). */
  onToggleHook: (key: MemoryConfigFlagKey, next: boolean) => Promise<void>;
  /** Capture the current config generation before beginning a shared list
   *  reload. A local toggle invalidates earlier captures. */
  captureHydrationRevision: () => number;
  /** Populate every flag from a freshly-fetched memory list response, but only
   *  if it was captured before the same config generation. */
  hydrate: (list: MemoryListResponse, revision: number) => void;
}

type HydrationGuard = ReturnType<typeof createAsyncCommitGuard>;

interface OptimisticToggleContext {
  guard: HydrationGuard;
  queue: ConfigWriteQueue;
  setError: (error: string | null) => void;
  setValue: (value: boolean) => void;
  getConfirmed: () => boolean;
  setConfirmed: (value: boolean) => void;
  send: (value: boolean) => Promise<boolean>;
}

/** Optimistically set a flag, then write it through its queue; roll back to server truth on a failed write with no newer intent. */
function runOptimisticToggle({ ctx, next }: { ctx: OptimisticToggleContext; next: boolean }): Promise<void> {
  ctx.guard.invalidate();
  ctx.setError(null);
  ctx.setValue(next);
  return enqueueConfigWrite(ctx.queue, next, ctx.send, (ok, value, hasNewerIntent) => {
    // Invalidate again at SETTLE, not just at the optimistic start: a
    // reload() can capture this guard's revision anywhere during the
    // in-flight window (after the start-invalidate, before this callback
    // runs) and still observe a pre-write server snapshot once its GET
    // resolves. Only invalidating at start left that window open —
    // hasUnsettledConfigWrite() had already flipped false by the time
    // such a read's response arrived, so hydrate() applied it anyway.
    ctx.guard.invalidate();
    if (ok) {
      ctx.setConfirmed(value);
      if (!hasNewerIntent) ctx.setError(null);
      return;
    }
    if (hasNewerIntent) return;
    ctx.setValue(ctx.getConfirmed());
    ctx.setError(CONFIG_SAVE_ERROR_MESSAGE);
  });
}

/**
 * A list response can have raced an optimistic PATCH. Keep both the
 * visible value and its rollback baseline untouched until that setting's
 * queue settles; the write's onSettled callback then reconciles it.
 */
function hydrateFlag({ queue, next, apply }: {
  queue: ConfigWriteQueue;
  next: boolean;
  apply: (value: boolean) => void;
}) {
  if (!hasUnsettledConfigWrite(queue)) apply(next);
}

const HOOK_FLAG_KEYS: MemoryConfigFlagKey[] = ['chatExtractionEnabled', 'profileEnabled', 'rewriteEnabled', 'verifyEnabled'];

/** The four per-hook flags: state plus a per-key setter. */
function useHookFlagState() {
  const [chatExtractionEnabled, setChatExtractionEnabled] = useState(true);
  const [profileEnabled, setProfileEnabled] = useState(true);
  const [rewriteEnabled, setRewriteEnabled] = useState(true);
  const [verifyEnabled, setVerifyEnabled] = useState(true);

  // Map each hook key to its setter so a single optimistic-set + rollback path
  // covers all four toggles.
  const setters = useMemo<Record<MemoryConfigFlagKey, (fn: (cur: boolean) => boolean) => void>>(
    () => ({
      profileEnabled: setProfileEnabled,
      rewriteEnabled: setRewriteEnabled,
      verifyEnabled: setVerifyEnabled,
      chatExtractionEnabled: setChatExtractionEnabled,
    }),
    [],
  );

  const hookFlags = useMemo<Record<MemoryConfigFlagKey, boolean>>(
    () => ({
      profileEnabled,
      rewriteEnabled,
      verifyEnabled,
      chatExtractionEnabled,
    }),
    [profileEnabled, rewriteEnabled, verifyEnabled, chatExtractionEnabled],
  );

  return { hookFlags, setters };
}

/** Write-queue and rollback bookkeeping refs shared by the toggles and hydration. */
function useConfigWriteRefs() {
  // Each toggle flips its own state optimistically the instant it's clicked,
  // but the PATCHes themselves are serialized per setting through a write
  // queue: rollback bookkeeping alone would keep the LOCAL state consistent
  // while still letting two concurrent PATCHes land server-side in the wrong
  // order and persist stale intent. The confirmed refs remember the last
  // server-acknowledged value, so a failed write with no newer intent queued
  // rolls back to server truth — never to another request's optimistic guess.
  const enabledConfirmedRef = useRef(true);
  const enabledQueueRef = useRef(newConfigWriteQueue());
  const hookConfirmedRef = useRef<Record<MemoryConfigFlagKey, boolean>>({
    chatExtractionEnabled: true,
    profileEnabled: true,
    rewriteEnabled: true,
    verifyEnabled: true,
  });
  const hookQueuesRef = useRef<Record<MemoryConfigFlagKey, ConfigWriteQueue>>({
    chatExtractionEnabled: newConfigWriteQueue(),
    profileEnabled: newConfigWriteQueue(),
    rewriteEnabled: newConfigWriteQueue(),
    verifyEnabled: newConfigWriteQueue(),
  });
  // List reloads are owned by useMemoryEntries, while writes live here. This
  // guard joins the two lifetimes: a reload captures before its GET begins and
  // hydrate ignores it when a toggle has invalidated that snapshot meanwhile.
  const hydrationGuardRef = useRef(createAsyncCommitGuard());
  return { enabledConfirmedRef, enabledQueueRef, hookConfirmedRef, hookQueuesRef, hydrationGuardRef };
}

interface ConfigHydrationDeps {
  refs: ReturnType<typeof useConfigWriteRefs>;
  setEnabled: (value: boolean) => void;
  setters: ReturnType<typeof useHookFlagState>['setters'];
}

/** Hydrate every flag from a fresh list response, unless a toggle invalidated the capture or is still writing. */
function useConfigHydration({ refs, setEnabled, setters }: ConfigHydrationDeps) {
  const { enabledConfirmedRef, enabledQueueRef, hookConfirmedRef, hookQueuesRef, hydrationGuardRef } = refs;

  const captureHydrationRevision = useCallback(() => hydrationGuardRef.current.capture(), [hydrationGuardRef]);

  const hydrate = useCallback((list: MemoryListResponse, revision: number) => {
    if (!hydrationGuardRef.current.isCurrent(revision)) return;
    hydrateFlag({
      queue: enabledQueueRef.current,
      next: list.enabled,
      apply: (value) => {
      setEnabled(value);
      enabledConfirmedRef.current = value;
    },
    });
    for (const key of HOOK_FLAG_KEYS) {
      hydrateFlag({
        queue: hookQueuesRef.current[key],
        next: list[key] !== false,
        apply: (value) => {
        setters[key](() => value);
        hookConfirmedRef.current[key] = value;
      },
      });
    }
  }, [setters, enabledConfirmedRef, enabledQueueRef, hookConfirmedRef, hookQueuesRef, hydrationGuardRef, setEnabled]);

  return { captureHydrationRevision, hydrate };
}

export function useMemoryConfig(port: MemoryConfigPort): MemoryConfigController {
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { hookFlags, setters } = useHookFlagState();

  const refs = useConfigWriteRefs();
  const { enabledConfirmedRef, enabledQueueRef, hookConfirmedRef, hookQueuesRef, hydrationGuardRef } = refs;

  const { captureHydrationRevision, hydrate } = useConfigHydration({ refs, setEnabled, setters });

  const onToggleEnabled = useCallback(
    (next: boolean) =>
      runOptimisticToggle({
        ctx: {
          guard: hydrationGuardRef.current,
          queue: enabledQueueRef.current,
          setError,
          setValue: setEnabled,
          getConfirmed: () => enabledConfirmedRef.current,
          setConfirmed: (value) => {
            enabledConfirmedRef.current = value;
          },
          send: (value) => port.patchConfig(enabledPatch({ enabled: value })),
        },
        next,
      }),
    [port],
  );

  const onToggleHook = useCallback(
    (key: MemoryConfigFlagKey, next: boolean) =>
      runOptimisticToggle({
        ctx: {
          guard: hydrationGuardRef.current,
          queue: hookQueuesRef.current[key],
          setError,
          setValue: (value) => setters[key](() => value),
          getConfirmed: () => hookConfirmedRef.current[key],
          setConfirmed: (value) => {
            hookConfirmedRef.current[key] = value;
          },
          send: (value) => port.patchConfig(singleFlagPatch({ flag: key, value })),
        },
        next,
      }),
    [port, setters],
  );

  return { enabled, error, hookFlags, onToggleEnabled, onToggleHook, captureHydrationRevision, hydrate };
}

/**
 * Reads the host-injected config port from MemoryPortsProvider (required).
 * Hosts own authorization/transport; tests may inject a fake into useMemoryConfig.
 */
export function useWiredMemoryConfig(): MemoryConfigController {
  return useMemoryConfig(useMemoryPorts().config);
}
