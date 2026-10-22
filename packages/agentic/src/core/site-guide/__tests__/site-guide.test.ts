import { describe, expect, it } from 'vitest';
import { createSiteGuide, SiteGuideInputError } from '../site-guide.js';
import type { GuideContributionResult, GuideTopic, SiteGuidePorts } from '../types.js';

const caller = { principalId: 'editor' };
const form: GuideTopic = {
  id: 'forms', title: 'Forms', summary: 'Native submissions', explanation: 'Use native definitions.', permissions: ['forms.read'],
  pointers: [{ label: 'Read forms', tool: 'forms_list', permissions: ['forms.read'] }, { label: 'Write forms', tool: 'forms_create', permissions: ['forms.write'] }],
  workflows: [{ title: 'Build', steps: ['Create a form'], permissions: ['forms.write'] }],
};
function fixture(options: { grants?: string[]; contributions?: GuideContributionResult; topics?: GuideTopic[] } = {}) {
  const grants = new Set(options.grants ?? ['forms.read']);
  const factRequests: { caller: { principalId: string }; topics: readonly string[] }[] = [];
  let fields = ['text'];
  const ports: SiteGuidePorts = {
    builtInTopics: options.topics ?? [form], authorize: async ({ caller: received, permission }) => received.principalId === caller.principalId && grants.has(permission),
    facts: { read: async input => { factRequests.push(input); return { forms: { status: 'ok', data: { fields } }, secret: { status: 'ok', data: 'PRIVATE_CANARY' } }; } },
    loadContributions: async () => options.contributions ?? { items: [], refusals: [] },
  };
  return { ports, factRequests, updateFields: (next: string[]) => { fields = next; }, grants };
}

describe('site guide read-only contract', () => {
  it('works without a plugin or host cards and defers live facts until explain', async () => {
    const guide = createSiteGuide({ authorize: async () => false, facts: { read: async () => ({ site: { status: 'ok', data: { enabled: false } } }) } });
    expect(await guide.run({ caller, operation: 'overview' })).toEqual({
      operation: 'overview', topics: [{ id: 'site', title: 'How this site works', summary: 'Learn the available building blocks before planning or building.', source: 'core' }],
      facts: {}, callerPermissions: [], enrichment: 'ok',
    });
  });
  it('overview is small; explain filters write pointers/workflows for a read-only caller', async () => {
    const { ports } = fixture(); const guide = createSiteGuide(ports);
    const overview = await guide.run({ caller, operation: 'overview' });
    expect(overview.facts).toEqual({});
    expect(overview.topics).toEqual([{ id: 'forms', title: 'Forms', summary: 'Native submissions', source: 'core' }]);
    const explained = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    expect(explained.topics[0]).toEqual({ id: 'forms', title: 'Forms', summary: 'Native submissions', source: 'core', explanation: 'Use native definitions.', pointers: [{ label: 'Read forms', tool: 'forms_list' }], workflows: [] });
    expect(explained.callerPermissions).toEqual(['forms.read']);
    expect(JSON.stringify(explained)).not.toContain('PRIVATE_CANARY');
  });
  it('rereads facts and permissions rather than caching between calls', async () => {
    const f = fixture(); const guide = createSiteGuide(f.ports);
    expect((await guide.run({ caller, operation: 'explain', topic: 'forms' })).facts.forms).toEqual({ status: 'ok', data: { fields: ['text'] } });
    f.updateFields(['email']);
    expect((await guide.run({ caller, operation: 'explain', topic: 'forms' })).facts.forms).toEqual({ status: 'ok', data: { fields: ['email'] } });
    f.grants.clear();
    expect((await guide.run({ caller, operation: 'overview' })).topics).toEqual([]);
    expect(f.factRequests.map(request => request.topics)).toEqual([['forms'], ['forms']]);
  });
  it('hidden and nonexistent topics have the same error and perform no facts read', async () => {
    const f = fixture({ grants: [] }); const guide = createSiteGuide(f.ports);
    const message = 'Topic unavailable. Call site_guide with operation overview for topics you may read.';
    await expect(guide.run({ caller, operation: 'explain', topic: 'forms' })).rejects.toThrow(message);
    await expect(guide.run({ caller, operation: 'explain', topic: 'missing' })).rejects.toThrow(message);
    expect(f.factRequests).toEqual([]);
  });
  it('a single plugin collision cannot replace core prose, pointers, workflows or gates', async () => {
    const contributed = { ...form, explanation: 'Plugin prose', pointers: [], workflows: [], permissions: [] };
    const f = fixture({ grants: ['forms.read', 'forms.write'], contributions: { items: [{ pluginId: 'guide-plugin', topics: [contributed] }], refusals: [] } });
    const guide = createSiteGuide(f.ports);
    const result = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    expect(result.enrichment).toBe('partial');
    expect(result.topics[0]).toEqual({ id: form.id, title: form.title, summary: form.summary, source: 'core', explanation: form.explanation,
      pointers: form.pointers.map(({ permissions, ...pointer }) => pointer), workflows: form.workflows.map(({ permissions, ...workflow }) => workflow) });
    f.grants.clear();
    expect((await guide.run({ caller, operation: 'overview' })).topics).toEqual([]);
  });
  it('enabling enrichment adds a distinct gated workflow and disabling it preserves core facts', async () => {
    const f = fixture(); let enabled = true;
    const guide = createSiteGuide({ ...f.ports, loadContributions: async () => ({
      items: enabled ? [{ pluginId: 'learning-plugin', topics: [{ ...form, id: 'forms-workflow', explanation: 'Enriched workflow' }] }] : [], refusals: [],
    }) });
    const treatment = await guide.run({ caller, operation: 'overview' });
    expect(treatment.topics.map(topic => [topic.id, topic.source])).toEqual([['forms', 'core'], ['forms-workflow', 'learning-plugin']]);
    expect((await guide.run({ caller, operation: 'explain', topic: 'forms-workflow' })).topics[0]?.explanation).toBe('Enriched workflow');
    const coreTreatment = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    enabled = false;
    const baseline = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    expect(coreTreatment).toEqual(baseline);
    await expect(guide.run({ caller, operation: 'explain', topic: 'forms-workflow' })).rejects.toThrow('Topic unavailable.');
    // The sole changed input is enrichment availability; host cards, grants and facts are identical.
    enabled = true; f.grants.clear();
    expect((await guide.run({ caller, operation: 'overview' })).topics).toEqual([]);
  });
  it('conflicting plugin topic ids retain core instead of choosing by load order', async () => {
    const f = fixture({ contributions: { items: [{ pluginId: 'one', topics: [{ ...form, explanation: 'one' }] }, { pluginId: 'two', topics: [{ ...form, explanation: 'two' }] }], refusals: [] } });
    const result = await createSiteGuide(f.ports).run({ caller, operation: 'explain', topic: 'forms' });
    expect(result.enrichment).toBe('partial'); expect(result.topics[0]?.source).toBe('core'); expect(result.topics[0]?.explanation).toBe(form.explanation);
  });
  it('disabled/absent enrichment retains core; read failure is explicit and leaks no error text', async () => {
    const f = fixture();
    const guide = createSiteGuide({ ...f.ports, loadContributions: async () => { throw new Error('PRIVATE_CANARY'); }, facts: { read: async () => { throw new Error('PRIVATE_CANARY'); } } });
    const result = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    expect(result.enrichment).toBe('unavailable'); expect(result.topics[0]?.source).toBe('core');
    expect(result.facts).toEqual({ forms: { status: 'unavailable' } }); expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');
  });
  it('authorizer failure denies the topic, even when plugin enrichment is present', async () => {
    const f = fixture();
    const result = await createSiteGuide({ ...f.ports, authorize: async () => { throw new Error('PRIVATE_CANARY'); } }).run({ caller, operation: 'overview' });
    expect(result.topics).toEqual([]); expect(result.callerPermissions).toEqual([]); expect(f.factRequests).toEqual([]);
  });
  it('bounds a hung contribution/facts port, retaining core with explicit unavailable facts', async () => {
    const f = fixture(); const never = () => new Promise<never>(() => {});
    const result = await createSiteGuide({ ...f.ports, loadContributions: never, facts: { read: never } }, { readTimeoutMs: 5 }).run({ caller, operation: 'explain', topic: 'forms' });
    expect(result.enrichment).toBe('unavailable'); expect(result.facts.forms).toEqual({ status: 'unavailable' });
  });
  it('overview never calls the facts port; explain reads the selected topic exactly once', async () => {
    const f = fixture(); const guide = createSiteGuide(f.ports);
    await guide.run({ caller, operation: 'overview' });
    expect(f.factRequests).toEqual([]);
    const explained = await guide.run({ caller, operation: 'explain', topic: 'forms' });
    expect(f.factRequests).toEqual([{ caller, topics: ['forms'] }]);
    expect(explained.facts).toEqual({ forms: { status: 'ok', data: { fields: ['text'] } } });
  });
  it('rejects invalid mode/topic combinations and invalid host configuration', async () => {
    const { ports } = fixture(); const guide = createSiteGuide(ports);
    await expect(guide.run({ caller, operation: 'overview', topic: 'forms' })).rejects.toThrow('topic is only accepted with operation explain');
    await expect(guide.run({ caller, operation: 'explain' })).rejects.toThrow('explain requires a topic id from overview');
    await expect(guide.run({ caller, operation: 'write' as 'overview' })).rejects.toBeInstanceOf(SiteGuideInputError);
    expect(() => createSiteGuide(ports, { readTimeoutMs: 0 })).toThrow('readTimeoutMs must be a positive finite number');
    expect(() => createSiteGuide({ ...ports, builtInTopics: [form, form] })).toThrow('Built-in topics must have unique ids and contain at most 256 cards');
  });
  it('allows write pointers only after their separate grant, without changing facts', async () => {
    const { ports } = fixture({ grants: ['forms.read', 'forms.write'] });
    const result = await createSiteGuide(ports).run({ caller, operation: 'explain', topic: 'forms' });
    expect(result.topics[0]?.pointers?.map(pointer => pointer.tool)).toEqual(['forms_list', 'forms_create']);
    expect(result.topics[0]?.workflows).toEqual([{ title: 'Build', steps: ['Create a form'] }]);
  });
});
