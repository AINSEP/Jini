import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';
import { createResourceStop } from '../resource-stop.js';
import { ResourceTable } from '../ResourceTable.js';
import { useResourceReadings } from '../use-resource-readings.hooks.js';

/** `index.ts` is the published `./resource-monitor` subpath. */
describe('resource-monitor public entry', () => {
  it('exposes exactly its runtime surface, each bound to the implementing module', () => {
    expect(Object.keys(entry).sort()).toEqual(['ResourceTable', 'createResourceStop', 'useResourceReadings']);
    expect(entry.useResourceReadings).toBe(useResourceReadings);
    expect(entry.createResourceStop).toBe(createResourceStop);
    expect(entry.ResourceTable).toBe(ResourceTable);
  });
});
