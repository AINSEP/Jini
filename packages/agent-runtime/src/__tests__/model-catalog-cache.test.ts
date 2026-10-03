import assert from "node:assert/strict";
import { test, expect, vi } from "vitest";
import { ModelCatalogCache, unionModels } from "../model-catalog-cache.js";
const FALLBACK_WITH_ALIASES = [
    { id: "default", label: "Default" },
    { id: "sonnet", label: "Sonnet (alias)" },
    { id: "opus", label: "Opus (alias)" },
    { id: "haiku", label: "Haiku (alias)" },
    { id: "claude-opus-5", label: "claude-opus-5" },
];
test("unionModels keeps every fallback entry unchanged when live discovery returns nothing", () => {
    assert.deepEqual(unionModels({ fallback: FALLBACK_WITH_ALIASES, live: [] }), FALLBACK_WITH_ALIASES);
});
test("unionModels appends a live id not already in fallback, after every fallback entry", () => {
    const live = [{ id: "claude-opus-5-20260101", label: "Claude Opus 5 (2026-01-01)" }];
    assert.deepEqual(unionModels({ fallback: FALLBACK_WITH_ALIASES, live: live }), [...FALLBACK_WITH_ALIASES, ...live]);
});
test("unionModels dedupes by id — a live entry matching a fallback id is dropped, not duplicated or overwritten", () => {
    const live = [{ id: "claude-opus-5", label: "a different label the live call reported" }];
    const result = unionModels({ fallback: FALLBACK_WITH_ALIASES, live: live });
    assert.equal(result.length, FALLBACK_WITH_ALIASES.length, "no duplicate entry for an id already in fallback");
    const opus5 = result.find((model) => model.id === "claude-opus-5");
    assert.equal(opus5?.label, "claude-opus-5", "the fallback entry's label wins — union never overwrites an existing entry");
});
test("unionModels never drops the sonnet/opus/haiku aliases or the default sentinel, even with live entries present", () => {
    const live = [
        { id: "claude-opus-5-20260101", label: "Claude Opus 5" },
        { id: "claude-sonnet-5-20260101", label: "Claude Sonnet 5" },
    ];
    const result = unionModels({ fallback: FALLBACK_WITH_ALIASES, live: live });
    for (const alias of ["default", "sonnet", "opus", "haiku"]) {
        assert.ok(result.some((model) => model.id === alias), `expected alias/sentinel '${alias}' to survive the union`);
    }
});

test('coalesces discovery and caches successful and failed calls until the TTL boundary', async () => {
  let now = 0;
  let complete!: (models: { id: string; label: string }[]) => void;
  const discover = vi.fn(() => new Promise<{ id: string; label: string }[]>(resolve => { complete = resolve; }));
  const cache = new ModelCatalogCache<{ id: string; label: string }>({ clock: { nowMs: () => now }, discover, merge: unionModels }, { ttlMs: 100 });
  const fallback = [{ id: 'default', label: 'Default' }];
  const first = cache.get({ cacheKey: ['workspace', 'principal'], fallback });
  now = 200; // A slow in-flight call still coalesces after the TTL expires.
  const second = cache.get({ cacheKey: ['workspace', 'principal'], fallback });
  expect(discover).toHaveBeenCalledTimes(1);
  complete([{ id: 'live', label: 'Live' }]);
  expect(await first).toEqual([...fallback, { id: 'live', label: 'Live' }]);
  expect(await second).toEqual(await first);
  const third = cache.get({ cacheKey: ['workspace', 'principal'], fallback });
  expect(discover).toHaveBeenCalledTimes(2);
  complete([]);
  expect(await third).toEqual(fallback);
});

test('a rejected discovery falls back, is negatively cached, then recovers at expiry', async () => {
  let now = 0;
  const discover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ id: 'live', label: 'Live' }]);
  const onDiscoveryError = vi.fn();
  const cache = new ModelCatalogCache<{ id: string; label: string }>({ clock: { nowMs: () => now }, discover, merge: unionModels }, { ttlMs: 100, onDiscoveryError });
  const fallback = [{ id: 'default', label: 'Default' }];
  expect(await cache.get({ cacheKey: ['w', 'p'], fallback })).toEqual(fallback);
  now = 99;
  expect(await cache.get({ cacheKey: ['w', 'p'], fallback })).toEqual(fallback);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(onDiscoveryError).toHaveBeenCalledWith({ error: expect.any(Error), cacheKey: ['w', 'p'] });
  now = 100;
  expect(await cache.get({ cacheKey: ['w', 'p'], fallback })).toEqual([...fallback, { id: 'live', label: 'Live' }]);
  expect(discover).toHaveBeenCalledTimes(2);
});

test('tenant key components cannot collide and each instance owns its state', async () => {
  const discover = vi.fn(async ({ cacheKey }: { cacheKey: readonly string[] }) => [{ id: JSON.stringify(cacheKey), label: 'Live' }]);
  const deps = { clock: { nowMs: () => 0 }, discover, merge: unionModels };
  const a = new ModelCatalogCache<{ id: string; label: string }>(deps);
  const b = new ModelCatalogCache<{ id: string; label: string }>(deps);
  const first = await a.get({ cacheKey: ['ws:1', '2'], fallback: [] });
  const second = await a.get({ cacheKey: ['ws', '1:2'], fallback: [] });
  expect(first).not.toEqual(second);
  await b.get({ cacheKey: ['ws:1', '2'], fallback: [] });
  expect(discover).toHaveBeenCalledTimes(3);
});

test('host merger sees the current fallback on every cache hit and inputs remain unchanged', async () => {
  const live = [{ id: 'new', label: 'New' }, { id: 'new', label: 'Duplicate' }];
  const discover = vi.fn(async () => live);
  const merge = vi.fn(unionModels<{ id: string; label: string }>);
  const cache = new ModelCatalogCache<{ id: string; label: string }>({ clock: { nowMs: () => 0 }, discover, merge });
  const fallback = [{ id: 'default', label: 'Default' }];
  const updated = [...fallback, { id: 'other', label: 'Other' }];
  expect(await cache.get({ cacheKey: ['scope'], fallback })).toEqual([...fallback, live[0]]);
  expect(await cache.get({ cacheKey: ['scope'], fallback: updated })).toEqual([...updated, live[0]]);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(merge).toHaveBeenCalledTimes(2);
  expect(live).toHaveLength(2);
  expect(fallback).toHaveLength(1);
});

test('null discovery and synchronous exceptions resolve to fallback without poisoned promises', async () => {
  const discover = vi.fn().mockImplementationOnce(() => { throw new Error('sync'); }).mockResolvedValueOnce(null);
  let now = 0;
  const cache = new ModelCatalogCache<{ id: string; label: string }>({ clock: { nowMs: () => now }, discover, merge: unionModels }, { ttlMs: 1 });
  const fallback = [{ id: 'default', label: 'Default' }];
  expect(await cache.get({ cacheKey: ['scope'], fallback })).toEqual(fallback);
  now = 1;
  expect(await cache.get({ cacheKey: ['scope'], fallback })).toEqual(fallback);
  expect(discover).toHaveBeenCalledTimes(2);
});

test('per-call discovery accepts resolved credentials without an ambient credential map', async () => {
  const defaultDiscovery = vi.fn(async () => [{ id: 'default-remote', label: 'Default remote' }]);
  const resolvedCredentialDiscovery = vi.fn(async () => [{ id: 'credential-scoped', label: 'Scoped' }]);
  const cache = new ModelCatalogCache<{ id: string; label: string }>({ clock: { nowMs: () => 0 }, discover: defaultDiscovery, merge: unionModels });
  const result = await cache.get({ cacheKey: ['workspace', 'principal', 'credential'], fallback: [] }, { discover: resolvedCredentialDiscovery });
  expect(result).toEqual([{ id: 'credential-scoped', label: 'Scoped' }]);
  expect(resolvedCredentialDiscovery).toHaveBeenCalledTimes(1);
  expect(defaultDiscovery).not.toHaveBeenCalled();
});
