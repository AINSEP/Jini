/**
 * @file A desktop window's Zoom In / Zoom Out / Actual Size (Cmd+Plus / Cmd+- / Cmd+0): routing a
 * command to whichever surface is actually on screen, and remembering an embedded guest's own zoom
 * level across reloads and relaunches.
 *
 * **Two different targets, the same split the host's Find-in-page documents.** When an embedded tab
 * is the visible surface, its `<webview>` guest is the target — Electron's `WebviewTag` exposes
 * `getZoomLevel`/`setZoomLevel` directly on that DOM element, no IPC needed. When the window's own
 * screen is on display, the target is the window's OWN top-level page, reached through
 * {@link ZoomBridge}'s `getZoomLevel`/`setZoomLevel` — synchronous calls into the preload's own
 * `webFrame`, not a main-process round trip (`webFrame` is the renderer-process API for a frame's
 * OWN zoom, so that target needs no IPC here, unlike Find's). {@link resolveZoomTarget} is the one
 * place that decides which.
 *
 * **Per-guest zoom persists in `localStorage`, keyed by the guest's id.** A `<webview>`'s own zoom
 * level lives on its Chromium WebContents instance, which a host that keys the element on a reload
 * nonce discards and recreates on every recovery reload — so without this, a remembered zoom would
 * reset the moment a stalled guest gets rebuilt, let alone across an app relaunch. `localStorage` is
 * the window's OWN per-origin storage (a stable `file://` origin when the window is loaded from a
 * file), so no new main-process store or IPC channel earns its cost for ten bytes per guest;
 * `registerGuest` re-applies the stored level every time a guest (re)registers, which covers both a
 * tab switch back to an already-zoomed guest and a fresh WebContents after a recovery reload —
 * waiting on that guest's `dom-ready` when it is not attached yet, since a ref callback fires at
 * attach and every `<webview>` method throws until then ({@link applyStoredZoom}). The window's own
 * top-level zoom is deliberately NOT persisted — it is shell chrome, not site content, and always
 * starting a fresh session at 100% is the same convention Chrome itself follows for its own UI zoom.
 */
import { useCallback, useEffect, useRef } from 'react';

/** Which way one zoom command moves. `'reset'` returns to 100% (zoom level 0) outright rather than
 *  stepping toward it. */
export type ZoomDirection = 'in' | 'out' | 'reset';

/** The slice of Electron's `<webview>` this file drives. A fake of it is what tests pass.
 *
 *  Structural rather than Electron's own type, so this browser package never imports Electron. The
 *  two listener methods are spelled out for `'dom-ready'` alone: Electron's `addEventListener` is an
 *  OVERLOAD SET covering every webview event, and copying it would oblige a fake to satisfy all of
 *  them. A real `<webview>` still satisfies this narrower pair, and it says exactly what zoom listens
 *  for — see {@link applyStoredZoom}. */
export interface ZoomableGuest {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  addEventListener(event: 'dom-ready', listener: (event: Event) => void): void;
  removeEventListener(event: 'dom-ready', listener: (event: Event) => void): void;
}

/** The preload bridge slice this file drives: the menu's command push and the top page's zoom. */
export interface ZoomBridge {
  onZoomCommand(required: { listener: (direction: ZoomDirection) => void }): () => void;
  getZoomLevel(): number;
  setZoomLevel(required: { level: number }): void;
}

/** The slice of `Storage` this file drives — narrow enough that a plain object satisfies it in
 *  tests, and permissive about a call that throws (a private window, or storage disabled). */
export type ZoomStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The window's own `localStorage`, resolved at each call rather than once at render. Reading the
 *  `window.localStorage` getter can itself throw (storage denied, a sandboxed origin), so it must
 *  never run during a render — a throw there would blank the whole window even when no guest or
 *  zoom command is in play. Resolved here instead, inside {@link readStoredZoom} /
 *  {@link writeStoredZoom}'s own `try`, a denied store degrades to session-only zoom. A module-level
 *  constant, so its identity is stable across renders and never re-runs the hook's effects. */
export const windowZoomStorage: ZoomStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

/** Electron's own zoom-level step (`webContents.zoomIn`/`zoomOut`'s default), kept identical so a
 *  host's custom Zoom menu feels like the built-in one it replaces. Each step is roughly a 20%
 *  factor change; see Electron's own `WebContents.zoomLevel` doc. */
const ZOOM_STEP = 0.5;

/** `localStorage` key for one guest's remembered zoom level, under the host's own prefix. */
function zoomStorageKey({ projectId, keyPrefix }: { projectId: string; keyPrefix: string }, _options: Record<string, never> = {}): string {
  return `${keyPrefix}${projectId}`;
}

/** Which surface a zoom command should run against right now. Mirrors the host's Find target, one
 *  target kind narrower: there is no `'none'` id to carry for `'guest'` here, so the element itself
 *  doubles as its own key via the caller's own `projectId`. */
export type ZoomTarget = { kind: 'guest'; element: ZoomableGuest; projectId: string } | { kind: 'top' } | { kind: 'none' };

/**
 * Decides {@link ZoomTarget}: the visible tab's guest when one is on screen and its element has
 * actually mounted, otherwise the window's own top-level page — as long as a bridge exists to reach
 * it (never true outside a real desktop window). `'none'` only when neither is available.
 *
 * @complexity O(1) — one `Map.get`.
 */
export function resolveZoomTarget(input: {
  activeGuestId: string | null;
  guests: ReadonlyMap<string, ZoomableGuest>;
  bridge: ZoomBridge | undefined;
}, _options: Record<string, never> = {}): ZoomTarget {
  if (input.activeGuestId !== null) {
    const element = input.guests.get(input.activeGuestId);
    if (element) return { kind: 'guest', element, projectId: input.activeGuestId };
  }
  return input.bridge ? { kind: 'top' } : { kind: 'none' };
}

/** One command's new zoom level. `'reset'` returns to 0 (100%) outright; `'in'`/`'out'` step by
 *  {@link ZOOM_STEP} from `current`. Chromium itself clamps the result to its own zoom range, so
 *  this does not — a cap here could only ever be looser or stricter than the real one underneath. */
export function nextZoomLevel({ current, direction }: { current: number; direction: ZoomDirection }, _options: Record<string, never> = {}): number {
  if (direction === 'reset') return 0;
  return direction === 'in' ? current + ZOOM_STEP : current - ZOOM_STEP;
}

/** Reads a persisted per-guest zoom level, defaulting to 0 (100%) for an unset, corrupt, or
 *  unreadable entry — never throws, since a lost preference is a cosmetic regression and a thrown
 *  read must not be.
 *  @complexity O(1). */
export function readStoredZoom({ storage, projectId, keyPrefix }: { storage: ZoomStorage; projectId: string; keyPrefix: string }, _options: Record<string, never> = {}): number {
  try {
    const raw = storage.getItem(zoomStorageKey({ projectId, keyPrefix }));
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Persists one guest's zoom level. Best-effort: a full or disabled store must not break zooming
 *  for the rest of the session, only the memory of it.
 *  @complexity O(1). */
export function writeStoredZoom({ storage, projectId, keyPrefix, level }: { storage: ZoomStorage; projectId: string; keyPrefix: string; level: number }, _options: Record<string, never> = {}): void {
  try {
    storage.setItem(zoomStorageKey({ projectId, keyPrefix }), String(level));
  } catch {
    // Storage full, disabled, or a private window with no persistence — zoom still applies this
    // session; there is nothing more useful to do with the failure.
  }
}

/** Sets a guest's zoom level, reporting whether it landed rather than throwing when it did not.
 *  Electron's `<webview>` throws from EVERY method until the guest is attached to the DOM and has
 *  emitted `dom-ready` — the same tolerance the host's other guest calls are wrapped in. */
function setGuestZoom({ element, level }: { element: ZoomableGuest; level: number }, _options: Record<string, never> = {}): boolean {
  try {
    element.setZoomLevel(level);
    return true;
  } catch {
    return false;
  }
}

/** A guest's current zoom level, or `null` when it cannot answer yet — same not-attached-yet gate
 *  as {@link setGuestZoom}. */
function readGuestZoom({ element }: { element: ZoomableGuest }, _options: Record<string, never> = {}): number | null {
  try {
    return element.getZoomLevel();
  } catch {
    return null;
  }
}

/**
 * Applies a guest's remembered zoom to a guest that has just (re)registered, deferring to the
 * guest's `dom-ready` when it is not attached yet.
 *
 * **This runs inside a React ref callback, so it must not throw.** A `<webview>` is attached to the
 * DOM before it is usable, and the ref fires at attach — every method on it throws until
 * `dom-ready`, and a throw escaping a ref callback unmounts the tree, blanking the whole window the
 * moment a tab mounts. Swallowing alone would not do, either: the ref is the ONLY moment a
 * registration happens, so a swallowed first attempt would quietly retire per-guest zoom memory
 * altogether. Hence the one-shot `dom-ready` wait — the level is deferred, not lost.
 *
 * @complexity O(1). At most one listener per registration, removed the first time it fires.
 */
export function applyStoredZoom({ element, projectId, storage, keyPrefix }: { element: ZoomableGuest; projectId: string; storage: ZoomStorage; keyPrefix: string }, _options: Record<string, never> = {}): void {
  const level = readStoredZoom({ storage, projectId, keyPrefix });
  if (setGuestZoom({ element, level })) return;
  const onReady = () => {
    element.removeEventListener('dom-ready', onReady);
    setGuestZoom({ element, level });
  };
  element.addEventListener('dom-ready', onReady);
}

/**
 * Runs one zoom command against `target`, persisting the result when the target is a guest.
 *
 * @complexity O(1).
 */
export function applyZoomCommand({ target, bridge, direction, storage, keyPrefix }: { target: ZoomTarget; bridge: ZoomBridge | undefined; direction: ZoomDirection; storage: ZoomStorage; keyPrefix: string }, _options: Record<string, never> = {}): void {
  if (target.kind === 'guest') {
    // A command that arrives before the guest is attached does nothing — see {@link setGuestZoom}.
    // Nothing is persisted in that case either: a remembered level the guest never took would be
    // re-applied on its next registration and silently shift the site under the owner.
    const current = readGuestZoom({ element: target.element });
    if (current === null) return;
    const level = nextZoomLevel({ current, direction });
    if (setGuestZoom({ element: target.element, level })) writeStoredZoom({ storage, projectId: target.projectId, keyPrefix, level });
    return;
  }
  if (target.kind === 'top' && bridge) {
    bridge.setZoomLevel({ level: nextZoomLevel({ current: bridge.getZoomLevel(), direction }) });
  }
}

export interface UseZoom {
  /** Wired into every mounted tab's `<webview>` ref, composed with the host's other guest refs.
   *  `null` deregisters (the tab closed or its guest remounted); a non-null registration
   *  immediately re-applies that guest's stored zoom, which is what makes a remembered zoom survive
   *  a recovery reload's fresh `<webview>` instance. */
  registerGuest: (projectId: string, element: ZoomableGuest | null) => void;
}

/**
 * The Zoom feature's whole runtime behaviour: subscribing to the app menu's command and routing it
 * to whichever surface is on screen, plus re-applying a guest's remembered zoom whenever it
 * (re)mounts.
 *
 * @param input.activeGuestId the visible tab's id, or `null` when the window's own screen is on
 *   display (the same argument the host gives its Find-in-page hook).
 * @param input.bridge the preload bridge port, or `undefined` outside a desktop window.
 * @param input.keyPrefix the host's `localStorage` key prefix for per-guest levels.
 * @param options.storage where per-guest zoom levels persist; defaults to {@link windowZoomStorage}.
 * @complexity O(1) per command, beyond `applyZoomCommand`'s own cost.
 */
export function useZoom(
  { activeGuestId, bridge, keyPrefix }: { activeGuestId: string | null; bridge: ZoomBridge | undefined; keyPrefix: string },
  { storage = windowZoomStorage }: { storage?: ZoomStorage } = {},
): UseZoom {
  // A ref, not state, for the same reason Find's own guests map is: registering a guest must never
  // itself trigger a render, and the map's contents are only ever read at the moment a command
  // actually runs.
  const guests = useRef(new Map<string, ZoomableGuest>()).current;

  const registerGuest = useCallback(
    (projectId: string, element: ZoomableGuest | null) => {
      if (element) {
        guests.set(projectId, element);
        applyStoredZoom({ element, projectId, storage, keyPrefix });
      } else {
        guests.delete(projectId);
      }
    },
    [guests, storage, keyPrefix],
  );

  // The app menu's Zoom In / Zoom Out / Actual Size: resolve the live target at the moment the
  // command fires (not when this effect was set up), so a tab switch since the last render is
  // still honored.
  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.onZoomCommand({ listener: (direction) => {
      const target = resolveZoomTarget({ activeGuestId, guests, bridge });
      applyZoomCommand({ target, bridge, direction, storage, keyPrefix });
    } });
    // `guests` is a ref (stable identity, never itself a trigger); `activeGuestId` is what actually
    // changes which entry a fired command should resolve to.
  }, [bridge, activeGuestId, guests, storage, keyPrefix]);

  return { registerGuest };
}
