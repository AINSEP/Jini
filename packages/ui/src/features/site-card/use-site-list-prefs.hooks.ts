import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SITE_LIST_PREFS, parseSiteListPrefs, type SiteListPrefs } from "./site-list-view.js";

/**
 * @file A site list's remembered choices (sort, pins, hidden sites), read once through a host port
 * and written back one change at a time. Where they are stored (a per-user settings ledger, a file)
 * is the host's choice.
 */

export interface SiteListPrefsPort {
  load(): Promise<unknown>;
  save(required: { next: SiteListPrefs }, optional?: Record<string, never>): Promise<void>;
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

/**
 * Applies a change at once and saves it behind the previous save, so two quick clicks cannot land out
 * of order. After a failed read nothing is saved: the defaults on screen would overwrite the person's
 * real pins.
 * @returns The current choices and their save state. @complexity O(1) per change.
 */
export function useSiteListPrefs(
  { port }: { port: SiteListPrefsPort },
  { describeError = defaultDescribeError }: { describeError?: ((required: { error: unknown }) => string) | undefined } = {},
): SiteListPrefsController {
  const [prefs, setPrefs] = useState<SiteListPrefs>(DEFAULT_SITE_LIST_PREFS);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSave = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let current = true;
    port.load().then(
      (stored) => { if (current) { setPrefs(parseSiteListPrefs({ stored })); setReady(true); } },
      (error: unknown) => { if (current) { setLoadError(describeError({ error })); setReady(true); } },
    );
    return () => { current = false; };
  }, [port, describeError]);

  const onPrefsChange = useCallback((next: SiteListPrefs) => {
    setPrefs(next);
    if (loadError !== null) return;
    lastSave.current = lastSave.current.then(() => port.save({ next })).then(
      () => setSaveError(null),
      (error: unknown) => setSaveError(describeError({ error })),
    );
  }, [port, loadError, describeError]);

  return { prefs, ready, onPrefsChange, loadError, saveError };
}
