import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SITE_LIST_PREFS, parseSiteListPrefs, type SiteListPrefs } from "./site-list-view.js";

/**
 * @file A site list's remembered choices (sort, pins, hidden sites), read once through a host port
 * and written back one change at a time. Where they are stored (a per-user settings ledger, a file)
 * is the host's choice.
 */

export interface SiteListPrefsPort {
  load(): Promise<unknown>;
  /** A store that saves synchronously may return nothing: that save is complete when it returns. */
  save(required: { next: SiteListPrefs }, optional?: Record<string, never>): Promise<void> | void;
}

export interface SiteListPrefsController {
  prefs: SiteListPrefs;
  /** False until the stored choices arrive, so the cards do not reorder under the person. */
  ready: boolean;
  onPrefsChange(next: SiteListPrefs): void;
  /** The reason the choices could not be read, or `null`. */
  loadError: string | null;
  /** The reason the last change could not be saved, or `null`. */
  saveError: string | null;
}

function defaultDescribeError({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

type DescribeError = (required: { error: unknown }) => string;

export interface UseSiteListPrefsOptions {
  describeError?: DescribeError | undefined;
  /**
   * A synchronous read of the stored choices, for a host whose store answers at once (browser storage
   * on a one-person machine). Given one, the first render already shows the stored choices, `ready`
   * starts `true`, and `port.load` is never called: the seed is the read. A seed that throws (storage
   * denied) gives the defaults and `loadError`, the same as a failed `load`, so a change still applies
   * for this session but is never saved.
   */
  seed?: (() => unknown) | undefined;
  /**
   * Start a change's save in the same turn when no save is in flight, instead of queuing it behind
   * the previous one. For a host whose store saves synchronously (returns nothing): each click is then
   * written before its handler returns, and back-to-back clicks reach it in order. Off by default, so
   * an async store's save starts on the next microtask as it always has.
   */
  immediateFirstSave?: boolean | undefined;
}

interface InitialPrefs {
  prefs: SiteListPrefs;
  ready: boolean;
  loadError: string | null;
}

/** The first render's state: the defaults until `load` answers, or the seed's answer at once. */
function initialPrefs({ seed, describeError }: { seed: (() => unknown) | undefined; describeError: DescribeError }): InitialPrefs {
  if (seed === undefined) return { prefs: DEFAULT_SITE_LIST_PREFS, ready: false, loadError: null };
  try {
    return { prefs: parseSiteListPrefs({ stored: seed() }), ready: true, loadError: null };
  } catch (error) {
    // Denied storage must not blank the list: show the defaults and say why they were not read.
    return { prefs: DEFAULT_SITE_LIST_PREFS, ready: true, loadError: describeError({ error }) };
  }
}

/**
 * Calls `save` now. Returns `null` when a synchronous store already finished, else the save's
 * promise, with a synchronous throw turned into a rejection like a chained call would.
 */
function startSave(save: () => Promise<void> | void): Promise<void> | null {
  try {
    const result = save();
    return result === undefined ? null : Promise.resolve(result);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Applies a change at once and saves it behind the previous save, so two quick clicks cannot land out
 * of order. With `immediateFirstSave` and no save in flight the save starts in the same turn, and a
 * store that saves synchronously (returns nothing) is done before the click handler returns, so
 * back-to-back changes reach it in order without waiting on a promise. After a failed read nothing is
 * saved: the defaults on screen would overwrite the person's real pins.
 * @returns The current choices and their save state. @complexity O(1) per change.
 */
export function useSiteListPrefs(
  { port }: { port: SiteListPrefsPort },
  { describeError = defaultDescribeError, seed, immediateFirstSave = false }: UseSiteListPrefsOptions = {},
): SiteListPrefsController {
  const [initial] = useState(() => initialPrefs({ seed, describeError }));
  const [prefs, setPrefs] = useState<SiteListPrefs>(initial.prefs);
  const [ready, setReady] = useState(initial.ready);
  const [loadError, setLoadError] = useState<string | null>(initial.loadError);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSave = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  // Fixed at mount: a seeded list never switches to the async read part-way.
  const seeded = initial.ready;

  useEffect(() => {
    if (seeded) return undefined;
    let current = true;
    port.load().then(
      (stored) => { if (current) { setPrefs(parseSiteListPrefs({ stored })); setReady(true); } },
      (error: unknown) => { if (current) { setLoadError(describeError({ error })); setReady(true); } },
    );
    return () => { current = false; };
  }, [port, describeError, seeded]);

  const onPrefsChange = useCallback((next: SiteListPrefs) => {
    setPrefs(next);
    if (loadError !== null) return;
    const save = () => port.save({ next });
    const onSaved = () => setSaveError(null);
    const onFailed = (error: unknown) => setSaveError(describeError({ error }));
    if (!immediateFirstSave) {
      // Queued even when nothing is in flight: an async store's save starts on the next microtask.
      lastSave.current = lastSave.current.then(save).then(onSaved, onFailed);
      return;
    }
    const started = pendingSaves.current === 0 ? startSave(save) : lastSave.current.then(save);
    if (started === null) { onSaved(); return; }
    pendingSaves.current += 1;
    lastSave.current = started.then(onSaved, onFailed).finally(() => { pendingSaves.current -= 1; });
  }, [port, loadError, describeError, immediateFirstSave]);

  return { prefs, ready, onPrefsChange, loadError, saveError };
}
