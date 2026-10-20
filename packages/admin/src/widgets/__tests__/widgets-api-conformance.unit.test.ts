import { describe, it, expect } from 'vitest';
import { createMemoryWidgetsApi } from '../adapters/memory.js';
import { runWidgetsApiConformance } from '../conformance/widgets-api.conformance.js';
import type { AdminWidgetsPort } from '../ports.js';

const EXPECTED_CHECKS = [
  'create active instance', 'create copies config input', 'get resolves slug or id', 'active list includes created instance', 'type filter',
  'omitted title preserved and version advances', 'prior snapshots stay detached', 'stale instance write rejects',
  'bound region listed', 'new region empty', 'region version advances without mutating old snapshot',
  'ordered placement identities and repeated refs retained', 'placement enabled and title projection', 'broken reference remains visible',
  'region list placement count updates', 'stale region write rejects', 'aborted list rejects', 'aborted write rejects', 'aborted write has no effects',
  'missing instance rejects', 'missing region rejects', 'trash removes active listing', 'trash retained for shared lifecycle',
];

describe('runWidgetsApiConformance', () => {
  it('returns every named check in order against a conforming adapter', async () => {
    expect(await runWidgetsApiConformance({ api: createMemoryWidgetsApi({}) })).toEqual(EXPECTED_CHECKS);
  });

  it('throws naming the first failed assertion', async () => {
    const memory = createMemoryWidgetsApi({});
    const api: AdminWidgetsPort = { ...memory, createWidget: async (input, options) => {
      const { widget } = await memory.createWidget(input, options);
      return { widget: { ...widget, status: 'trash' } };
    } };
    await expect(runWidgetsApiConformance({ api })).rejects.toThrow(new Error('Widgets API conformance: create active instance'));
  });

  it('throws naming a rejection check whose call resolved instead', async () => {
    const memory = createMemoryWidgetsApi({});
    const api: AdminWidgetsPort = { ...memory, listWidgets: (input, options) => memory.listWidgets(input, options?.signal?.aborted ? {} : options) };
    await expect(runWidgetsApiConformance({ api })).rejects.toThrow(new Error('Widgets API conformance: aborted list rejects'));
  });
});
