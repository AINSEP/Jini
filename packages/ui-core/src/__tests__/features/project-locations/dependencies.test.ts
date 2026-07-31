import { describe, expect, it } from 'vitest';

// Through the barrel — a symbol missing from `index.ts` fails here rather
// than at some host's build.
import { createFakeProjectLocationsPort, DEFAULT_LOCATION_ID } from '../../../features/project-locations/index.js';
import type { ProjectLocation } from '../../../features/project-locations/index.js';

describe('createFakeProjectLocationsPort', () => {
  describe('fetchLocations', () => {
    it('resolves just the built-in root by default', async () => {
      const port = createFakeProjectLocationsPort();
      await expect(port.fetchLocations()).resolves.toEqual([
        { id: DEFAULT_LOCATION_ID, name: 'Default', path: '/home/operator/projects', builtIn: true },
      ]);
    });

    it('resolves seeded locations instead of the default when provided', async () => {
      const seeded: readonly ProjectLocation[] = [
        { id: DEFAULT_LOCATION_ID, name: 'Default', path: '/root', builtIn: true },
        { id: 'loc-1', name: 'work', path: '/home/operator/work' },
      ];
      const port = createFakeProjectLocationsPort({ locations: seeded });
      await expect(port.fetchLocations()).resolves.toEqual(seeded);
    });
  });

  describe('openFolderDialog', () => {
    it('resolves the single default canned path repeatedly when no picks are seeded', async () => {
      const port = createFakeProjectLocationsPort();
      await expect(port.openFolderDialog()).resolves.toBe('/home/operator/another-project');
      await expect(port.openFolderDialog()).resolves.toBe('/home/operator/another-project');
    });

    it('resolves seeded picks in order, one per call', async () => {
      const port = createFakeProjectLocationsPort({ folderPicks: ['/a', '/b'] });
      await expect(port.openFolderDialog()).resolves.toBe('/a');
      await expect(port.openFolderDialog()).resolves.toBe('/b');
    });

    it('keeps returning the last pick once the seeded list is exhausted', async () => {
      const port = createFakeProjectLocationsPort({ folderPicks: ['/a', '/b'] });
      await port.openFolderDialog();
      await port.openFolderDialog();
      await expect(port.openFolderDialog()).resolves.toBe('/b');
    });

    it('resolves null when a pick simulates the operator cancelling', async () => {
      const port = createFakeProjectLocationsPort({ folderPicks: [null] });
      await expect(port.openFolderDialog()).resolves.toBeNull();
    });
  });

  describe('saveLocations', () => {
    it('preserves built-in locations and appends external drafts with generated ids and derived names', async () => {
      const port = createFakeProjectLocationsPort();
      const result = await port.saveLocations([{ path: '/home/operator/work' }]);
      expect(result).toEqual([
        { id: DEFAULT_LOCATION_ID, name: 'Default', path: '/home/operator/projects', builtIn: true },
        { id: expect.stringMatching(/^fake-location-/), name: 'work', path: '/home/operator/work' },
      ]);
    });

    it('keeps an existing draft id rather than generating a new one', async () => {
      const port = createFakeProjectLocationsPort();
      const first = await port.saveLocations([{ path: '/home/operator/work' }]);
      const existingId = first[1]!.id;
      const second = await port.saveLocations([{ id: existingId, path: '/home/operator/work' }]);
      expect(second[1]!.id).toBe(existingId);
    });

    it('is reflected by a subsequent fetchLocations', async () => {
      const port = createFakeProjectLocationsPort();
      await port.saveLocations([{ path: '/home/operator/work' }]);
      const fetched = await port.fetchLocations();
      expect(fetched.map((l) => l.path)).toContain('/home/operator/work');
    });

    it('replaces the prior external set rather than appending across calls', async () => {
      const port = createFakeProjectLocationsPort();
      await port.saveLocations([{ path: '/a' }]);
      const result = await port.saveLocations([{ path: '/b' }]);
      // Built-in plus exactly the one just saved — '/a' is gone.
      expect(result.map((l) => l.path)).toEqual(['/home/operator/projects', '/b']);
    });

    it('falls back to the full path as the name when there is no basename segment', async () => {
      const port = createFakeProjectLocationsPort();
      const result = await port.saveLocations([{ path: '/' }]);
      expect(result[1]).toEqual({ id: expect.stringMatching(/^fake-location-/), name: '/', path: '/' });
    });
  });

  describe('scanLocations', () => {
    it('resolves an empty import/existing result', async () => {
      const port = createFakeProjectLocationsPort();
      await expect(port.scanLocations?.()).resolves.toEqual({ imported: [], existing: [] });
    });
  });

  describe('latency', () => {
    it('simulates latency on calls when latencyMs > 0', async () => {
      const port = createFakeProjectLocationsPort({ latencyMs: 5 });
      const start = Date.now();
      await port.fetchLocations();
      expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    });
  });
});
