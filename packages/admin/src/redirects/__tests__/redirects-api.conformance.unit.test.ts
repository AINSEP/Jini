import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectImportResult, AdminRedirectsPort } from '../../core/ports/redirects.js';
import { createMemoryRedirectsApi } from '../adapters/memory.js';
import { runRedirectsApiConformance } from '../conformance/redirects-api.conformance.js';

/**
 * @file Each conformance check, broken one at a time against an otherwise-conforming memory port.
 * Every refusal pins the exact check name, so a reordered or renamed check is visible here.
 */

const MISSING = 'missing-conformance-rule';

/** A row a misbehaving fake can mutate after handing it out — what the snapshot checks must catch. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const REFERENCE_CHECKS = [
  'create preserves fields and options',
  'list contains the created rule',
  'get reads by id',
  'new rule has zero hits',
  'partial update preserves other fields',
  'prior snapshots stay unchanged',
  'status filter',
  'tombstone returns the disabled rule',
  'removed rule leaves the list',
  'tombstoned rule remains readable',
  'restore returns the rule to the list',
  'missing rule rejects',
  'missing hits differs from zero hits',
  'missing update rejects',
  'missing tombstone rejects',
  'reference regex create is loudly rejected',
  'reference regex update is loudly rejected',
  'middle failure preserves both successful siblings',
  'invalid item is never reported created',
  'import provenance is stamped by the backend',
];

const ALTERNATE_CHECKS = [
  ...REFERENCE_CHECKS.slice(0, 15),
  'valid import batch succeeds',
  'import provenance is stamped by the backend',
];

/** A complete, stand-alone row for fakes that must resolve where the memory port would reject. */
const ROW: AdminRedirect = {
  id: 'fixture-row', matchType: 'exact', fromPattern: '/fixture', toTarget: '/fixture-target', statusCode: 301,
  status: 'active', override: false, priority: 0, source: 'manual', sourceEntryId: null, fromPathAtCapture: null,
  toPathAtCapture: null, createdByPrincipal: 'p', createdByPluginId: null, createdAt: 't', updatedAt: 't', version: 1,
};

function memory(overrides: Partial<AdminRedirectsPort> = {}, options: Parameters<typeof createMemoryRedirectsApi>[1] = {}): AdminRedirectsPort {
  return { ...createMemoryRedirectsApi({}, options), ...overrides };
}

/** Reference-host validation, except a regex UPDATE (the conformance rule's own fromPattern) is let through. */
function rejectRegexOnCreateOnly(input: AdminRedirectCreateInput): void {
  if (input.matchType === 'regex' && input.fromPattern !== '/redirects-conformance-a') throw new Error('regex rejected');
}

function failure(check: string) {
  return { name: 'AdminApiError', code: 'CONFORMANCE_FAILED', status: 0, message: `Redirects API conformance: ${check}` };
}

async function expectFailure(run: Promise<unknown>, check: string): Promise<void> {
  await expect(run).rejects.toBeInstanceOf(AdminApiError);
  await expect(run).rejects.toMatchObject(failure(check));
}

describe('runRedirectsApiConformance — passing ports', () => {
  it('runs every reference check in order and returns them frozen', async () => {
    const checks = await runRedirectsApiConformance({ api: memory() }, {});
    expect(checks).toEqual(REFERENCE_CHECKS);
    expect(Object.isFrozen(checks)).toBe(true);
  });

  it('defaults to the reference regex probes when no options object is passed', async () => {
    expect(await runRedirectsApiConformance({ api: memory() })).toEqual(REFERENCE_CHECKS);
  });

  it('swaps the regex probes for a plain valid batch when referenceRegexRejection is false', async () => {
    const checks = await runRedirectsApiConformance({ api: memory({}, { validate: () => {} }) }, { referenceRegexRejection: false });
    expect(checks).toEqual(ALTERNATE_CHECKS);
  });

  it('imports the regex probe as the middle item only in reference mode', async () => {
    const onImport = vi.fn((_rules: readonly AdminRedirectCreateInput[]): AdminRedirectImportResult | undefined => undefined);
    await runRedirectsApiConformance({ api: memory({}, { validate: () => {}, onImport }) }, { referenceRegexRejection: false });
    await runRedirectsApiConformance({ api: memory({}, { onImport }) }, {});
    expect(onImport.mock.calls.map(([rules]) => rules.map(rule => rule.fromPattern))).toEqual([
      ['/import-conformance-a', '/import-conformance-c'],
      ['/import-conformance-a', '/import-conformance-regex', '/import-conformance-c'],
    ]);
  });

  it('tombstones every rule the import created so the backend is left clean', async () => {
    const api = memory();
    const tombstone = vi.spyOn(api, 'tombstoneRedirect');
    await runRedirectsApiConformance({ api }, {});
    // Removed rules leave the list (Bug B), so a clean run leaves nothing listed.
    expect(await api.listRedirects({}, {})).toEqual([]);
    const removed = tombstone.mock.calls.map(([{ id }]) => id).filter(id => id !== MISSING);
    expect((await Promise.all(removed.map(id => api.getRedirect({ id })))).map(row => row.status)).toEqual(['disabled', 'disabled', 'disabled', 'disabled']);
    // The conformance rule (removed, restored, removed again), the missing-id probe, then each of the two imported rows.
    expect(tombstone).toHaveBeenCalledTimes(5);
  });

  it('passes a port whose status filter returns nothing (reported, not fixed)', async () => {
    // `every` over an empty list is vacuously true, so this check cannot catch an ignored filter
    // that returns no rows at all — the disabled rule created just before is never required.
    const base = memory();
    const api = memory({ ...base, listRedirects: (r, f) => (f?.status ? Promise.resolve([]) : base.listRedirects(r, f)) });
    expect(await runRedirectsApiConformance({ api }, {})).toContain('status filter');
  });
});

describe('runRedirectsApiConformance — create/read checks', () => {
  it.each([
    ['status', { status: 'disabled' }],
    ['override', { override: false }],
    ['priority', { priority: 0 }],
  ] as const)('refuses a create that drops %s', async (_field, patch) => {
    const base = memory();
    const api = memory({ ...base, createRedirect: async (input, options) => ({ ...(await base.createRedirect(input, options)), ...patch }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'create preserves fields and options');
  });

  it('refuses a list that omits the created rule', async () => {
    await expectFailure(runRedirectsApiConformance({ api: memory({ listRedirects: async () => [] }) }, {}), 'list contains the created rule');
  });

  it('refuses a get that returns another rule', async () => {
    await expectFailure(runRedirectsApiConformance({ api: memory({ getRedirect: async () => ROW }) }, {}), 'get reads by id');
  });

  it.each([
    ['redirectId', { redirectId: 'other' }],
    ['hitCount', { hitCount: 1 }],
    ['lastHitAt', { lastHitAt: 't' }],
  ] as const)('refuses hit stats with a wrong %s', async (_field, patch) => {
    const base = memory();
    const api = memory({ ...base, getRedirectHitStats: async args => ({ ...(await base.getRedirectHitStats(args)), ...patch }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'new rule has zero hits');
  });
});

describe('runRedirectsApiConformance — update checks', () => {
  it('refuses an update that ignores the patched status', async () => {
    const base = memory();
    const api = memory({ ...base, updateRedirect: async (args, patch) => ({ ...(await base.updateRedirect(args, patch)), status: 'active' }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'partial update preserves other fields');
  });

  it('refuses an update that rewrites an unpatched field', async () => {
    const base = memory();
    const api = memory({ ...base, updateRedirect: async (args, patch) => ({ ...(await base.updateRedirect(args, patch)), toTarget: '/elsewhere' }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'partial update preserves other fields');
  });

  it('refuses an update that mutates the snapshot create returned', async () => {
    const base = memory();
    let returned: Mutable<AdminRedirect> | undefined;
    const api = memory({ ...base,
      createRedirect: async (input, options) => { const row = { ...(await base.createRedirect(input, options)) }; returned = row; return row; },
      updateRedirect: async (args, patch) => { const row = await base.updateRedirect(args, patch); if (returned) returned.status = row.status; return row; } });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'prior snapshots stay unchanged');
  });

  it('refuses an update that mutates the snapshot an earlier list returned', async () => {
    const base = memory();
    let listed: Mutable<AdminRedirect>[] = [];
    const api = memory({ ...base,
      listRedirects: async (r, f) => { listed = (await base.listRedirects(r, f)).map(row => ({ ...row })); return listed; },
      updateRedirect: async (args, patch) => { const row = await base.updateRedirect(args, patch); for (const item of listed) item.status = row.status; return row; } });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'prior snapshots stay unchanged');
  });

  it('refuses a status filter that returns a row in another status', async () => {
    const base = memory();
    const api = memory({ ...base, listRedirects: async (r, f) => (f?.status ? [ROW] : base.listRedirects(r, f)) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'status filter');
  });
});

describe('runRedirectsApiConformance — soft-delete checks', () => {
  it('refuses a tombstone that returns the rule still active', async () => {
    const base = memory();
    const api = memory({ ...base, tombstoneRedirect: async args => ({ ...(await base.tombstoneRedirect(args)), status: 'active' }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'tombstone returns the disabled rule');
  });

  it('refuses a list that still shows a removed rule', async () => {
    const base = memory();
    const created: string[] = [];
    const api = memory({
      ...base,
      createRedirect: async (input, options) => {
        const row = await base.createRedirect(input, options);
        created.push(row.id);
        return row;
      },
      listRedirects: async () => Promise.all(created.map(id => base.getRedirect({ id }))),
    });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'removed rule leaves the list');
  });

  it('refuses a restore that leaves the rule out of the list', async () => {
    const base = memory();
    const removed = new Set<string>();
    const api = memory({
      ...base,
      tombstoneRedirect: async (args) => {
        removed.add(args.id);
        return base.tombstoneRedirect(args);
      },
      listRedirects: async (r, f) => (await base.listRedirects(r, f)).filter(row => !removed.has(row.id)),
    });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'restore returns the rule to the list');
  });

  it('refuses a get that reports a tombstoned rule as active', async () => {
    const base = memory();
    const api = memory({ ...base, getRedirect: async args => ({ ...(await base.getRedirect(args)), status: 'active' }) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'tombstoned rule remains readable');
  });
});

describe('runRedirectsApiConformance — missing-rule checks', () => {
  it('refuses a get that resolves for a missing id', async () => {
    const base = memory();
    const api = memory({ ...base, getRedirect: args => (args.id === MISSING ? Promise.resolve(ROW) : base.getRedirect(args)) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'missing rule rejects');
  });

  it('refuses hit stats that report zero hits for a missing id', async () => {
    const base = memory();
    const api = memory({ ...base, getRedirectHitStats: args => (args.id === MISSING
      ? Promise.resolve({ redirectId: MISSING, hitCount: 0, lastHitAt: null }) : base.getRedirectHitStats(args)) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'missing hits differs from zero hits');
  });

  it('refuses an update that resolves for a missing id', async () => {
    const base = memory();
    const api = memory({ ...base, updateRedirect: (args, patch) => (args.id === MISSING ? Promise.resolve(ROW) : base.updateRedirect(args, patch)) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'missing update rejects');
  });

  it('refuses a tombstone that resolves for a missing id', async () => {
    const base = memory();
    const api = memory({ ...base, tombstoneRedirect: args => (args.id === MISSING ? Promise.resolve(ROW) : base.tombstoneRedirect(args)) });
    await expectFailure(runRedirectsApiConformance({ api }, {}), 'missing tombstone rejects');
  });
});

describe('runRedirectsApiConformance — reference regex checks', () => {
  it('refuses a reference-mode port that accepts a regex create', async () => {
    await expectFailure(runRedirectsApiConformance({ api: memory({}, { validate: () => {} }) }, {}), 'reference regex create is loudly rejected');
  });

  it('refuses a reference-mode port that accepts a regex update', async () => {
    await expectFailure(runRedirectsApiConformance({ api: memory({}, { validate: rejectRegexOnCreateOnly }) }, {}), 'reference regex update is loudly rejected');
  });
});

describe('runRedirectsApiConformance — import checks', () => {
  function importing(result: AdminRedirectImportResult): AdminRedirectsPort {
    return memory({}, { onImport: () => result });
  }
  const imported = (fromPattern: string, source = 'import'): AdminRedirect => ({ ...ROW, id: fromPattern, fromPattern, source });
  const OK_A = imported('/import-conformance-a');
  const OK_C = imported('/import-conformance-c');
  const FAILED_1 = { index: 1, code: 'REDIRECT_VALIDATION_ERROR', message: 'regex' };

  it.each([
    ['one created', { created: [OK_A], failed: [FAILED_1] }],
    ['no failure', { created: [OK_A, OK_C], failed: [] }],
    ['the wrong failed index', { created: [OK_A, OK_C], failed: [{ ...FAILED_1, index: 0 }] }],
  ] as const)('refuses a reference batch with %s', async (_label, result) => {
    await expectFailure(runRedirectsApiConformance({ api: importing(result) }, {}), 'middle failure preserves both successful siblings');
  });

  it('refuses a reference batch that reports the invalid item as created', async () => {
    const result = { created: [OK_A, imported('/import-conformance-regex')], failed: [FAILED_1] };
    await expectFailure(runRedirectsApiConformance({ api: importing(result) }, {}), 'invalid item is never reported created');
  });

  it('refuses an alternate-mode batch with a failed item', async () => {
    const api = memory({}, { validate: () => {}, onImport: () => ({ created: [OK_A, OK_C], failed: [FAILED_1] }) });
    await expectFailure(runRedirectsApiConformance({ api }, { referenceRegexRejection: false }), 'valid import batch succeeds');
  });

  it('refuses an alternate-mode batch with a missing created row', async () => {
    const api = memory({}, { validate: () => {}, onImport: () => ({ created: [OK_A], failed: [] }) });
    await expectFailure(runRedirectsApiConformance({ api }, { referenceRegexRejection: false }), 'valid import batch succeeds');
  });

  it('refuses created rows the backend did not stamp with import provenance', async () => {
    const result = { created: [OK_A, imported('/import-conformance-c', 'manual')], failed: [FAILED_1] };
    await expectFailure(runRedirectsApiConformance({ api: importing(result) }, {}), 'import provenance is stamped by the backend');
  });
});
