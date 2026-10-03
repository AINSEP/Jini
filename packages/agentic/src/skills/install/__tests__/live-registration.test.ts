import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createLiveSkillRegistration, createSkillRefresher, createSkillRefreshMiddleware, type SkillRegistration, type SkillRegistryPort } from '../live-registration.js';

// Characterizes append-only slots and request-time refresh from the original live registry.
test('retained slots execute current guidance and deny removed tools', () => {
  const slots = new Map<string, SkillRegistration<{ id: string; description: string }, { input: string }>>();
  const registry: SkillRegistryPort<{ id: string; description: string }, { input: string }> = {
    list: () => [...slots.values()].map(t => t.descriptor),
    has: ({ id }) => slots.has(id),
    register: ({ tool }) => { if (slots.has(tool.descriptor.id)) throw new Error('duplicate'); slots.set(tool.descriptor.id, tool); },
  };
  const replace = createLiveSkillRegistration({ registry, inactiveError: () => new Error('skill inactive') });
  const tool = (description: string) => ({ descriptor: { id: 'skill_incident', description }, policy: { authorize: () => 'allow' }, handler: ({ context }: { context: { input: string } }) => `${description}:${context.input}` });
  assert.equal(replace({ tools: [tool('first')] }), true);
  const retained = slots.get('skill_incident')!;
  assert.equal(retained.handler({ context: { input: 'x' } }), 'first:x');
  assert.equal(replace({ tools: [tool('second')] }), true);
  assert.equal(slots.get('skill_incident'), retained);
  assert.equal(retained.descriptor.description, 'second');
  assert.equal(retained.handler({ context: { input: 'x' } }), 'second:x');
  assert.equal(replace({ tools: [tool('second')] }), false);
  replace({ tools: [] });
  assert.deepEqual(registry.list({}), []);
  assert.equal(registry.has({ id: 'skill_incident' }), false);
  assert.equal(retained.policy.authorize({ context: { input: 'x' } }), 'deny');
  assert.throws(() => retained.handler({ context: { input: 'x' } }), /skill inactive/);
  replace({ tools: [tool('third')] });
  assert.equal(slots.size, 1);
  assert.equal(retained.handler({ context: { input: 'x' } }), 'third:x');
});

test('single-flight refresh shares reads, propagates errors and can retry', async () => {
  let reads = 0, release!: (value: readonly string[]) => void;
  let applied: readonly string[] = [];
  const refresher = createSkillRefresher({ load: () => { reads++; return new Promise<readonly string[]>(resolve => { release = resolve; }); }, replace: ({ tools }) => { applied = tools; return true; } });
  const first = refresher.refreshInstalledSkills({}), second = refresher.refreshInstalledSkills({});
  assert.equal(first, second); assert.equal(reads, 1);
  release(['current']);
  assert.equal(await first, true); assert.deepEqual(applied, ['current']);
  let tries = 0;
  const failing = createSkillRefresher({ load: async () => { if (++tries === 1) throw new Error('disk failed'); return ['new']; }, replace: () => true });
  await assert.rejects(() => failing.refreshInstalledSkills({}), /disk failed/);
  assert.equal(await failing.refreshInstalledSkills({}), true);
});

test('request refresh reports a failed read before allowing discovery or execution', async () => {
  const failure = new Error('state invalid'); let changed = 0;
  const middleware = createSkillRefreshMiddleware({ registry: { refreshInstalledSkills: async () => { throw failure; } } }, { onChanged: () => { changed++; } });
  const calls: { error?: unknown }[] = [];
  await middleware({ next: (_required, optional = {}) => calls.push(optional) });
  assert.deepEqual(calls, [{ error: failure }]); assert.equal(changed, 0);
});
