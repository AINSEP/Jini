import { expect, test } from 'vitest';
import { createReadinessStore, runBootLifecycle } from '../index.js';

test('readiness instances have independent defaults and copy snapshots on both boundaries', () => {
  const one = createReadinessStore({});
  const two = createReadinessStore({});
  const result = { ok: false, modules: [{ name: 'worker', owner: 'host', criticality: 'critical' as const,
    lifecycle: { status: 'failed' as const, reasonCode: 'failure', remediationHint: 'retry' } }] };
  one.set({ snapshot: result });
  result.modules[0]!.lifecycle.reasonCode = 'input mutation';
  const read = one.get();
  expect(read.modules[0]!.lifecycle).toMatchObject({ reasonCode: 'failure' });
  if (read.modules[0]!.lifecycle.status === 'failed') read.modules[0]!.lifecycle.reasonCode = 'output mutation';
  read.modules.length = 0;
  expect(one.get().modules).toHaveLength(1);
  expect(one.get().modules[0]!.lifecycle).toMatchObject({ reasonCode: 'failure' });
  expect(two.get()).toEqual({ ok: true, modules: [] });
});

test('an initial snapshot is copied and isolated from subsequent caller mutation', () => {
  const initial = { ok: false, modules: [] };
  const store = createReadinessStore({}, { initial });
  initial.ok = true;
  expect(store.get()).toEqual({ ok: false, modules: [] });
});

test('boot publishes its final snapshot and survives a throwing reporter', async () => {
  const readiness = createReadinessStore({});
  const result = await runBootLifecycle({ modules: [] }, { readiness, reporter: {
    report({ result }) { expect(result).toEqual({ ok: true, modules: [] }); throw new Error('reporter'); },
  } });
  expect(readiness.get()).toEqual(result);
});

test('duplicate names fail before acquiring resources', async () => {
  let effects = 0;
  const module = { name: 'duplicate', owner: 'host', criticality: 'critical' as const,
    async prepare() { effects++; }, async start() {}, async stop() {} };
  await expect(runBootLifecycle({ modules: [module, module] })).rejects.toThrow('unique');
  expect(effects).toBe(0);
});
