// Characterization pins for createSiteGuide/run: input refusals, enrichment status for every
// contribution outcome, fail-closed authorization, and facts that never leak unrequested sections.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSiteGuide, SiteGuideInputError } from '../site-guide.js';
import type { GuideContribution, GuideContributionResult, GuideTopic, SiteGuidePorts } from '../types.js';

const caller = { principalId: 'p1' };
function topic(id: string, permissions: string[] = [], extra: Partial<GuideTopic> = {}): GuideTopic {
  return { id, title: `T ${id}`, summary: `S ${id}`, explanation: `E ${id}`, permissions, pointers: [], workflows: [], ...extra };
}
function ports(options: { grants?: string[]; topics?: GuideTopic[]; load?: SiteGuidePorts['loadContributions']; facts?: SiteGuidePorts['facts']['read']; authorize?: SiteGuidePorts['authorize'] } = {}) {
  const grants = new Set(options.grants ?? []);
  const authorizeCalls: string[] = [];
  const factCalls: (readonly string[])[] = [];
  const result: SiteGuidePorts = {
    builtInTopics: options.topics ?? [topic('core')],
    authorize: options.authorize ?? (async ({ permission }) => { authorizeCalls.push(permission); return grants.has(permission); }),
    facts: { read: options.facts ?? (async ({ topics }) => { factCalls.push(topics); return Object.fromEntries(topics.map(id => [id, { status: 'ok', data: id }])); }) },
    ...(options.load ? { loadContributions: options.load } : {}),
  };
  return { ports: result, authorizeCalls, factCalls };
}
const contributions = (items: GuideContribution[], refusals: string[] = []): SiteGuidePorts['loadContributions'] => async () => ({ items, refusals } satisfies GuideContributionResult);

afterEach(() => { vi.useRealTimers(); });

describe('createSiteGuide construction refusals', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses readTimeoutMs %s', readTimeoutMs => {
    expect(() => createSiteGuide(ports().ports, { readTimeoutMs })).toThrow(new SiteGuideInputError({ message: 'readTimeoutMs must be a positive finite number' }));
  });
  it('refuses duplicate built-in ids', () => {
    expect(() => createSiteGuide(ports({ topics: [topic('a'), topic('a')] }).ports)).toThrow('Built-in topics must have unique ids and contain at most 256 cards');
  });
  it('refuses more than 256 built-in topics and accepts exactly 256', () => {
    const many = Array.from({ length: 257 }, (_, i) => topic(`t${i}`));
    expect(() => createSiteGuide(ports({ topics: many }).ports)).toThrow('Built-in topics must have unique ids and contain at most 256 cards');
    expect(() => createSiteGuide(ports({ topics: many.slice(0, 256) }).ports)).not.toThrow();
  });
});

describe('run input refusals', () => {
  const guide = createSiteGuide(ports().ports);
  it('refuses an unknown operation (malformed input fixture)', async () => {
    await expect(guide.run({ caller, operation: 'list' as 'overview' })).rejects.toThrow('operation must be overview or explain');
  });
  it('refuses a topic with overview', async () => {
    await expect(guide.run({ caller, operation: 'overview', topic: 'core' })).rejects.toThrow('topic is only accepted with operation explain');
  });
  it.each([undefined, 'Core', '1core', 'a'.repeat(65), 'core_x', ''])('refuses explain topic %j', async t => {
    await expect(guide.run({ caller, operation: 'explain', ...(t === undefined ? {} : { topic: t }) })).rejects.toThrow('explain requires a topic id from overview');
  });
  it('accepts a 64-character topic id shape and then reports it unavailable', async () => {
    await expect(guide.run({ caller, operation: 'explain', topic: 'a'.repeat(64) })).rejects.toThrow('Topic unavailable. Call site_guide with operation overview for topics you may read.');
  });
});

describe('run enrichment', () => {
  const overview = async (p: SiteGuidePorts, options?: { readTimeoutMs?: number }) => createSiteGuide(p, options).run({ caller, operation: 'overview' });
  it('is ok with no contribution loader', async () => {
    expect((await overview(ports().ports)).enrichment).toBe('ok');
  });
  it('adds a distinct plugin topic with its plugin as source', async () => {
    const result = await overview(ports({ load: contributions([{ pluginId: 'plug', topics: [topic('extra')] }]) }).ports);
    expect(result).toMatchObject({ enrichment: 'ok', topics: [{ id: 'core', source: 'core' }, { id: 'extra', source: 'plug' }] });
  });
  it('is partial when the loader reports refusals', async () => {
    expect((await overview(ports({ load: contributions([], ['bad plugin']) }).ports)).enrichment).toBe('partial');
  });
  it('is partial and keeps the core card when a plugin collides with it', async () => {
    const result = await overview(ports({ load: contributions([{ pluginId: 'plug', topics: [topic('core', [], { title: 'Hijack' })] }]) }).ports);
    expect(result).toMatchObject({ enrichment: 'partial', topics: [{ id: 'core', title: 'T core', source: 'core' }] });
  });
  it('is partial and drops both topics when two plugins share an id', async () => {
    const result = await overview(ports({ load: contributions([{ pluginId: 'a', topics: [topic('dup')] }, { pluginId: 'b', topics: [topic('dup')] }]) }).ports);
    expect(result.enrichment).toBe('partial');
    expect(result.topics.map(t => t.id)).toEqual(['core']);
  });
  it('is unavailable when the loader throws', async () => {
    expect((await overview(ports({ load: async () => { throw new Error('boom'); } }).ports)).enrichment).toBe('unavailable');
  });
  it('is unavailable when more than 256 topics are contributed, and accepts 256', async () => {
    const items = (n: number) => [{ pluginId: 'a', topics: Array.from({ length: n - 1 }, (_, i) => topic(`a${i}`)) }, { pluginId: 'b', topics: [topic('last')] }];
    const over = await overview(ports({ load: contributions(items(257)) }).ports);
    expect(over).toMatchObject({ enrichment: 'unavailable', topics: [{ id: 'core' }] });
    expect((await overview(ports({ load: contributions(items(256)) }).ports)).topics).toHaveLength(257);
  });
  it('is unavailable when the loader outlives the read timeout', async () => {
    vi.useFakeTimers();
    const pending = overview(ports({ load: () => new Promise(() => {}) }).ports, { readTimeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).enrichment).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('run authorization and facts', () => {
  const gated = topic('gated', ['read'], {
    pointers: [{ label: 'open', tool: 'x', permissions: ['read'] }, { label: 'edit', href: '/e', permissions: ['write'] }],
    workflows: [{ title: 'w1', steps: ['s'], permissions: [] }, { title: 'w2', steps: ['s'], permissions: ['read', 'write'] }],
  });
  it('asks once per permission in first-asked order and keeps the decisions internal', async () => {
    const p = ports({ topics: [gated, topic('open'), topic('admin', ['admin'])], grants: ['read'] });
    const result = await createSiteGuide(p.ports).run({ caller, operation: 'explain', topic: 'gated' });
    expect(result.topics).toEqual([{ id: 'gated', title: 'T gated', summary: 'S gated', source: 'core', explanation: 'E gated', pointers: [{ label: 'open', tool: 'x' }], workflows: [{ title: 'w1', steps: ['s'] }] }]);
    expect(p.authorizeCalls).toEqual(['read', 'write']);
    expect(result).not.toHaveProperty('callerPermissions');
    expect(result.facts).toEqual({ gated: { status: 'ok', data: 'gated' } });
  });
  it('hides topics whose permissions are not all granted on overview', async () => {
    const p = ports({ topics: [topic('both', ['a', 'b']), topic('one', ['a'])], grants: ['a'] });
    expect((await createSiteGuide(p.ports).run({ caller, operation: 'overview' })).topics.map(t => t.id)).toEqual(['one']);
  });
  it('treats a throwing authorizer as denial', async () => {
    const p = ports({ topics: [gated], authorize: async () => { throw new Error('authz down'); } });
    await expect(createSiteGuide(p.ports).run({ caller, operation: 'explain', topic: 'gated' })).rejects.toThrow('Topic unavailable. Call site_guide with operation overview for topics you may read.');
  });
  it('treats a hanging authorizer as denial after the timeout', async () => {
    vi.useFakeTimers();
    const p = ports({ topics: [gated], authorize: () => new Promise(() => {}) });
    const pending = createSiteGuide(p.ports, { readTimeoutMs: 10 }).run({ caller, operation: 'overview' });
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).topics).toEqual([]);
  });
  it('marks every explained topic unavailable when facts throw', async () => {
    const p = ports({ facts: async () => { throw new Error('PRIVATE detail'); } });
    const result = await createSiteGuide(p.ports).run({ caller, operation: 'explain', topic: 'core' });
    expect(result.facts).toEqual({ core: { status: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('drops unrequested sections and fills missing ones as unavailable', async () => {
    const p = ports({ facts: async () => ({ other: { status: 'ok', data: 'PRIVATE' } }) });
    expect((await createSiteGuide(p.ports).run({ caller, operation: 'explain', topic: 'core' })).facts).toEqual({ core: { status: 'unavailable' } });
  });
  it('does not read facts for overview', async () => {
    const p = ports();
    expect((await createSiteGuide(p.ports).run({ caller, operation: 'overview' })).facts).toEqual({});
    expect(p.factCalls).toEqual([]);
  });
  it('uses the default 5 second timeout for a hanging facts read', async () => {
    vi.useFakeTimers();
    const p = ports({ facts: () => new Promise(() => {}) });
    const pending = createSiteGuide(p.ports).run({ caller, operation: 'explain', topic: 'core' });
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).facts).toEqual({ core: { status: 'unavailable' } });
  });
});
