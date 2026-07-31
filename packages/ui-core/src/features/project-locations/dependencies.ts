import { DEFAULT_LOCATION_ID } from './rules.js';
import type { ProjectLocation, ProjectLocationDraft } from './types.js';
import type { ProjectLocationsPort } from './ports.js';

export interface FakeProjectLocationsPortOptions {
  /** Seed locations, built-in root included. Defaults to just the built-in
   *  root the fake always exposes. */
  locations?: readonly ProjectLocation[];
  /** Paths `openFolderDialog` returns in order, one per call; once exhausted
   *  it keeps returning the last one. Defaults to a single canned path. */
  folderPicks?: readonly (string | null)[];
  /** Simulated network/IPC latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

const DEFAULT_BUILT_IN: ProjectLocation = {
  id: DEFAULT_LOCATION_ID,
  name: 'Default',
  path: '/home/operator/projects',
  builtIn: true,
};

let nextFakeId = 1;

/**
 * An in-memory test/demo double. Per this package's established convention
 * (see `execution/dependencies.ts`, `integrations/dependencies.ts`), ships a
 * fake rather than a real transport — a real host supplies its own
 * `ProjectLocationsPort` pointed at its own filesystem/folder-picker.
 */
export function createFakeProjectLocationsPort(options: FakeProjectLocationsPortOptions = {}): ProjectLocationsPort {
  let locations = options.locations ?? [DEFAULT_BUILT_IN];
  const folderPicks = options.folderPicks ?? ['/home/operator/another-project'];
  let pickIndex = 0;
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);

  return {
    fetchLocations() {
      return delay([...locations]);
    },
    openFolderDialog() {
      const pick = folderPicks[Math.min(pickIndex, folderPicks.length - 1)] ?? null;
      pickIndex += 1;
      return delay(pick);
    },
    saveLocations(drafts: readonly ProjectLocationDraft[]) {
      const builtIn = locations.filter((location) => location.builtIn);
      const nextExternal = drafts.map((draft) => ({
        id: draft.id ?? `fake-location-${nextFakeId++}`,
        name: draft.path.split(/[\\/]/).filter(Boolean).pop() || draft.path,
        path: draft.path,
      }));
      locations = [...builtIn, ...nextExternal];
      return delay([...locations]);
    },
    scanLocations() {
      return delay({ imported: [], existing: [] });
    },
  };
}
