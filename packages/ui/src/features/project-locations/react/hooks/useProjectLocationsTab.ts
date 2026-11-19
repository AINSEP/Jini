import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectLocationsPort } from '../../ports.js';
import {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  resolveDefaultLocationId,
  saveableDrafts,
} from '../../rules.js';
import type {
  ProjectLocation,
  ProjectLocationDraft,
  ProjectLocationsActionResult,
} from '../../types.js';

export interface UseProjectLocationsTabOptions {
  port: ProjectLocationsPort;
  /** Host-configured default location id. May be stale (name a location the
   *  operator has since removed) — the hook corrects it after any save that
   *  makes it dangling; see `resolveDefaultLocationId`. */
  defaultLocationId?: string | null | undefined;
  /** Fires when the effective default changes — either the operator picked a
   *  new one via `setDefaultLocationId`, or a stale configured default was
   *  corrected after a save. */
  onDefaultLocationIdChange?: ((id: string) => void) | undefined;
}

export interface UseProjectLocationsTabResult {
  /** The full list, built-in root included. Empty until the initial load
   *  settles. */
  locations: readonly ProjectLocation[];
  /** The editable (non-built-in) rows. */
  drafts: readonly ProjectLocationDraft[];
  builtIn: ProjectLocation | undefined;
  effectiveDefaultLocationId: string;
  loading: boolean;
  saving: boolean;
  result: ProjectLocationsActionResult;
  addFolder: () => void;
  removeDraft: (index: number) => void;
  setDefaultLocationId: (id: string) => void;
}

/** Scan a saved location; disposed callers cannot publish success or failure. */
export async function scanAddedLocation(
  { port, alive, setResult }: {
    port: ProjectLocationsPort;
    alive: { readonly current: boolean };
    setResult: (result: ProjectLocationsActionResult) => void;
  },
  _options = {},
): Promise<void> {
  const scan = port.scanLocations;
  if (!scan) return;
  try {
    const scanResult = await scan.call(port);
    if (!alive.current) return;
    setResult({ status: 'scan-complete', imported: scanResult.imported.length, existing: scanResult.existing.length });
  } catch (error: unknown) {
    if (!alive.current) return;
    setResult({ status: 'scan-error', message: error instanceof Error ? error.message : String(error) });
  }
}

/** The tab's initial fetch. A disposed or re-run effect (`isLive` false) publishes nothing; a failed
 *  fetch says so (`load-error`) instead of showing an empty list as if there were no locations. */
async function loadLocations(
  { port, isLive, setLocations, setDrafts, setResult, setLoading }: {
    port: ProjectLocationsPort;
    isLive: () => boolean;
    setLocations: (locations: readonly ProjectLocation[]) => void;
    setDrafts: (drafts: readonly ProjectLocationDraft[]) => void;
    setResult: (result: ProjectLocationsActionResult) => void;
    setLoading: (loading: boolean) => void;
  },
  _options = {},
): Promise<void> {
  setLoading(true);
  try {
    const next = await port.fetchLocations();
    if (!isLive()) return;
    setLocations(next);
    setDrafts(externalLocations(next));
  } catch (error: unknown) {
    if (isLive()) setResult({ status: 'load-error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (isLive()) setLoading(false);
  }
}

/** A ref that always holds the latest render's value. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** True while mounted; async callbacks check it before publishing state. */
function useAliveRef(): { readonly current: boolean } {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

interface InitialLoadDeps {
  port: ProjectLocationsPort;
  portRef: { readonly current: ProjectLocationsPort };
  alive: { readonly current: boolean };
  setLocations: (locations: readonly ProjectLocation[]) => void;
  setDrafts: (drafts: readonly ProjectLocationDraft[]) => void;
  setResult: (result: ProjectLocationsActionResult) => void;
  setLoading: (loading: boolean) => void;
}

/** Fetches the locations on mount and whenever `port` changes. */
function useInitialLocationsLoad({ port, portRef, alive, setLocations, setDrafts, setResult, setLoading }: InitialLoadDeps) {
  useEffect(() => {
    let cancelled = false;
    void loadLocations({ port: portRef.current, isLive: () => !cancelled && alive.current, setLocations, setDrafts, setResult, setLoading });
    return () => {
      cancelled = true;
    };
  }, [port]);
}

type LiveRef<T> = { readonly current: T };
type Setter<T> = (value: T) => void;

interface PersistDeps {
  portRef: LiveRef<ProjectLocationsPort>;
  defaultLocationIdRef: LiveRef<string | null | undefined>;
  onDefaultLocationIdChangeRef: LiveRef<((id: string) => void) | undefined>;
  alive: LiveRef<boolean>;
  setLocations: Setter<readonly ProjectLocation[]>;
  setDrafts: Setter<readonly ProjectLocationDraft[]>;
  setResult: Setter<ProjectLocationsActionResult>;
}

/** Saving state + the save-then-publish sequence shared by add and remove. */
function useLocationsPersist({
  portRef,
  defaultLocationIdRef,
  onDefaultLocationIdChangeRef,
  alive,
  setLocations,
  setDrafts,
  setResult,
}: PersistDeps) {
  const [saving, setSaving] = useState(false);

  const persist = useCallback(async (nextDrafts: readonly ProjectLocationDraft[]): Promise<readonly ProjectLocation[] | null> => {
    const applySaved = (saved: readonly ProjectLocation[]): readonly ProjectLocation[] => {
      setLocations(saved);
      setDrafts(externalLocations(saved));
      setResult({ status: 'saved' });
      // A save can remove the very location the configured default names —
      // fall back it to the host's own root rather than leaving a dangling
      // id, same correction the origin makes inline in its own `setCfg`.
      const configured = defaultLocationIdRef.current ?? DEFAULT_LOCATION_ID;
      const effective = resolveDefaultLocationId({ configuredId: configured, locations: saved });
      if (effective !== configured) onDefaultLocationIdChangeRef.current?.(effective);
      return saved;
    };
    setSaving(true);
    // One return after the try statement (null unless a still-mounted save succeeded), so no
    // unreachable continuation follows a try and a catch that both return.
    let persisted: readonly ProjectLocation[] | null = null;
    try {
      const saved = await portRef.current.saveLocations(saveableDrafts(nextDrafts));
      if (alive.current) persisted = applySaved(saved);
    } catch (error: unknown) {
      if (alive.current) setResult({ status: 'save-error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current) setSaving(false);
    }
    return persisted;
  }, [portRef, defaultLocationIdRef, onDefaultLocationIdChangeRef, alive, setLocations, setDrafts, setResult]);

  return { saving, persist };
}

interface DraftActionsDeps {
  persist: (drafts: readonly ProjectLocationDraft[]) => Promise<readonly ProjectLocation[] | null>;
  portRef: LiveRef<ProjectLocationsPort>;
  locationsRef: LiveRef<readonly ProjectLocation[]>;
  draftsRef: LiveRef<readonly ProjectLocationDraft[]>;
  alive: LiveRef<boolean>;
  setDrafts: Setter<readonly ProjectLocationDraft[]>;
  setResult: Setter<ProjectLocationsActionResult>;
}

/** Add-folder (dialog -> duplicate check -> save -> scan) and removal, both rolling back on a failed save. */
function useDraftActions({ persist, portRef, locationsRef, draftsRef, alive, setDrafts, setResult }: DraftActionsDeps) {
  const addFolder = useCallback(() => {
    void (async () => {
      setResult({ status: 'idle' });
      const selected = await portRef.current.openFolderDialog();
      if (!alive.current) return;
      if (!selected) {
        setResult({ status: 'no-folder-selected' });
        return;
      }
      // Checked against every current location (built-in root included), not
      // just the editable drafts — a deliberate widening of the origin's
      // drafts-only check, using the same trailing-separator-insensitive
      // comparison `isDuplicatePath` already applies everywhere else.
      if (isDuplicatePath({ candidatePath: selected, locations: locationsRef.current })) {
        setResult({ status: 'duplicate' });
        return;
      }
      const previous = draftsRef.current;
      const next = [...previous, { path: selected }];
      setDrafts(next);
      const saved = await persist(next);
      if (!saved) {
        if (alive.current) setDrafts(previous);
        return;
      }
      await scanAddedLocation({ port: portRef.current, alive, setResult });
    })();
  }, [persist, portRef, locationsRef, draftsRef, alive, setDrafts, setResult]);

  const removeDraft = useCallback(
    (index: number) => {
      void (async () => {
        const previous = draftsRef.current;
        const next = previous.filter((_, i) => i !== index);
        setDrafts(next);
        const saved = await persist(next);
        if (!saved && alive.current) setDrafts(previous);
      })();
    },
    [persist, draftsRef, alive, setDrafts],
  );

  return { addFolder, removeDraft };
}

/**
 * Owns the tab's async edges: the initial locations fetch, the add-folder ->
 * duplicate-check -> save -> (optional) scan sequence, and removal. Origin:
 * `ProjectLocationsSection`'s own `useState`/`useEffect` block — ported as a
 * hook rather than inline so a host can drive the same lifecycle from its own
 * tree if it ever needs to (matches `useExecutionTab`'s convention).
 *
 * The default-location id itself stays host-controlled (`defaultLocationId`/
 * `onDefaultLocationIdChange`), same "tab owns its async edges, host owns
 * cross-cutting config" split as `useExecutionTab`'s `ByokConfig`.
 */
export function useProjectLocationsTab({
  port,
  defaultLocationId,
  onDefaultLocationIdChange,
}: UseProjectLocationsTabOptions): UseProjectLocationsTabResult {
  const [locations, setLocations] = useState<readonly ProjectLocation[]>([]);
  const [drafts, setDrafts] = useState<readonly ProjectLocationDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ProjectLocationsActionResult>({ status: 'idle' });

  // Volatile values async callbacks need at RUN time, not at schedule time —
  // same convention as `useSettingsSlice`'s `io.current`.
  const portRef = useLatest(port);
  const locationsRef = useLatest(locations);
  const draftsRef = useLatest(drafts);
  const defaultLocationIdRef = useLatest(defaultLocationId);
  const onDefaultLocationIdChangeRef = useLatest(onDefaultLocationIdChange);
  const alive = useAliveRef();
  useInitialLocationsLoad({ port, portRef, alive, setLocations, setDrafts, setResult, setLoading });

  const { saving, persist } = useLocationsPersist({
    portRef,
    defaultLocationIdRef,
    onDefaultLocationIdChangeRef,
    alive,
    setLocations,
    setDrafts,
    setResult,
  });
  const { addFolder, removeDraft } = useDraftActions({ persist, portRef, locationsRef, draftsRef, alive, setDrafts, setResult });

  const setDefaultLocationId = useCallback((id: string) => {
    setResult({ status: 'default-saved' });
    onDefaultLocationIdChangeRef.current?.(id);
  }, []);

  return {
    locations,
    drafts,
    builtIn: locations.find((location) => location.builtIn),
    effectiveDefaultLocationId: resolveDefaultLocationId({ configuredId: defaultLocationId ?? null, locations }),
    loading,
    saving,
    result,
    addFolder,
    removeDraft,
    setDefaultLocationId,
  };
}
