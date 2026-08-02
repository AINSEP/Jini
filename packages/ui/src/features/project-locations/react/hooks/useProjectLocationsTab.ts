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
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ProjectLocationsActionResult>({ status: 'idle' });

  /** Volatile values async callbacks need at RUN time, not at schedule time —
   *  same convention as `useSettingsSlice`'s `io.current`. */
  const portRef = useRef(port);
  portRef.current = port;
  const locationsRef = useRef(locations);
  locationsRef.current = locations;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const defaultLocationIdRef = useRef(defaultLocationId);
  defaultLocationIdRef.current = defaultLocationId;
  const onDefaultLocationIdChangeRef = useRef(onDefaultLocationIdChange);
  onDefaultLocationIdChangeRef.current = onDefaultLocationIdChange;

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    portRef.current
      .fetchLocations()
      .then((next) => {
        if (cancelled || !alive.current) return;
        setLocations(next);
        setDrafts(externalLocations(next));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port]);

  const persist = useCallback(async (nextDrafts: readonly ProjectLocationDraft[]): Promise<readonly ProjectLocation[] | null> => {
    setSaving(true);
    try {
      const saved = await portRef.current.saveLocations(saveableDrafts(nextDrafts));
      if (!alive.current) return null;
      setLocations(saved);
      setDrafts(externalLocations(saved));
      setResult({ status: 'saved' });
      // A save can remove the very location the configured default names —
      // fall back it to the host's own root rather than leaving a dangling
      // id, same correction the origin makes inline in its own `setCfg`.
      const configured = defaultLocationIdRef.current ?? DEFAULT_LOCATION_ID;
      const effective = resolveDefaultLocationId(configured, saved);
      if (effective !== configured) onDefaultLocationIdChangeRef.current?.(effective);
      return saved;
    } catch (error: unknown) {
      if (!alive.current) return null;
      setResult({ status: 'save-error', message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      if (alive.current) setSaving(false);
    }
  }, []);

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
      if (isDuplicatePath(selected, locationsRef.current)) {
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
      const scan = portRef.current.scanLocations;
      if (!scan) return;
      try {
        const scanResult = await scan.call(portRef.current);
        if (!alive.current) return;
        setResult({ status: 'scan-complete', imported: scanResult.imported.length, existing: scanResult.existing.length });
      } catch (error: unknown) {
        if (!alive.current) return;
        setResult({ status: 'scan-error', message: error instanceof Error ? error.message : String(error) });
      }
    })();
  }, [persist]);

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
    [persist],
  );

  const setDefaultLocationId = useCallback((id: string) => {
    setResult({ status: 'default-saved' });
    onDefaultLocationIdChangeRef.current?.(id);
  }, []);

  return {
    locations,
    drafts,
    builtIn: locations.find((location) => location.builtIn),
    effectiveDefaultLocationId: resolveDefaultLocationId(defaultLocationId ?? null, locations),
    loading,
    saving,
    result,
    addFolder,
    removeDraft,
    setDefaultLocationId,
  };
}
