import { expect, it } from 'vitest';
import {
  runBootLifecycle,
  type BootModule,
  type BootResult,
  type LifecycleReporter,
  type ReadinessStore,
} from '../boot-lifecycle.js';

function moduleFixture(
  required: { name: string; calls: string[] },
  optional: Partial<BootModule> = {},
): BootModule {
  const { name, calls } = required;
  return {
    name, owner: 'host', criticality: 'critical',
    async prepare() { calls.push(`${name}.prepare`); },
    async start() { calls.push(`${name}.start`); },
    async stop() { calls.push(`${name}.stop`); },
    ...optional,
  };
}

it('returns successful empty and fully started snapshots without publication ports', async () => {
  expect(await runBootLifecycle({ modules: [] })).toEqual({ ok: true, modules: [] });
  const calls: string[] = [];
  const modules = ['one', 'two'].map(name => moduleFixture({ name, calls }));
  expect(await runBootLifecycle({ modules })).toEqual({ ok: true, modules: [
    { name: 'one', owner: 'host', criticality: 'critical', lifecycle: { status: 'ready' } },
    { name: 'two', owner: 'host', criticality: 'critical', lifecycle: { status: 'ready' } },
  ] });
  expect(calls).toEqual(['one.prepare', 'two.prepare', 'one.start', 'two.start']);
});

it('rejects duplicate names before preparation or snapshot publication', async () => {
  const calls: string[] = [];
  const modules = [moduleFixture({ name: 'same', calls }), moduleFixture({ name: 'same', calls })];
  const readiness: ReadinessStore = {
    set() { calls.push('publish'); },
    get() { return { ok: true, modules: [] }; },
  };
  const reporter: LifecycleReporter = { report() { calls.push('report'); } };
  await expect(runBootLifecycle({ modules }, { readiness, reporter }))
    .rejects.toThrow('boot module names must be unique');
  expect(calls).toEqual([]);
});

it('records optional prepare and start failures in input order while later modules start', async () => {
  const calls: string[] = [];
  const prepareFailure = moduleFixture({ name: 'prepare-failure', calls }, {
    criticality: 'optional',
    async prepare() { calls.push('prepare-failure.prepare'); throw 'prepare rejected'; },
  });
  const startFailure = moduleFixture({ name: 'start-failure', calls }, {
    criticality: 'optional',
    async start() { calls.push('start-failure.start'); throw new Error('start rejected'); },
  });
  const later = moduleFixture({ name: 'later', calls });
  const result = await runBootLifecycle({ modules: [prepareFailure, startFailure, later] });
  expect(result).toEqual({ ok: true, modules: [
    { name: 'prepare-failure', owner: 'host', criticality: 'optional', lifecycle: {
      status: 'failed', reasonCode: 'prepare rejected',
      remediationHint: 'check the boot log for the underlying error and retry after fixing it',
    } },
    { name: 'start-failure', owner: 'host', criticality: 'optional', lifecycle: {
      status: 'failed', reasonCode: 'start rejected',
      remediationHint: 'check the boot log for the underlying error and retry after fixing it',
    } },
    { name: 'later', owner: 'host', criticality: 'critical', lifecycle: { status: 'ready' } },
  ] });
  expect(calls).toEqual([
    'prepare-failure.prepare', 'start-failure.prepare', 'later.prepare',
    'start-failure.start', 'later.start',
  ]);
});

it('critical prepare failure unwinds completed preparations despite stop failure and omits unstarted records', async () => {
  const calls: string[] = [];
  const one = moduleFixture({ name: 'one', calls });
  const two = moduleFixture({ name: 'two', calls }, {
    async stop() { calls.push('two.stop'); throw new Error('cleanup failed'); },
  });
  const failed = moduleFixture({ name: 'failed', calls }, {
    async prepare() { calls.push('failed.prepare'); throw new Error('original failure'); },
  });
  const untouched = moduleFixture({ name: 'untouched', calls });
  expect(await runBootLifecycle({ modules: [one, two, failed, untouched] })).toEqual({ ok: false, modules: [
    { name: 'failed', owner: 'host', criticality: 'critical', lifecycle: {
      status: 'failed', reasonCode: 'original failure',
      remediationHint: 'check the boot log for the underlying error and retry after fixing it',
    } },
  ] });
  expect(calls).toEqual(['one.prepare', 'two.prepare', 'failed.prepare', 'two.stop', 'one.stop']);
});

it('critical start failure keeps rolled-back ready records and leaves unstarted preparations host-owned', async () => {
  // These rollback semantics are explicitly preserved by the existing boot contract.
  const calls: string[] = [];
  const one = moduleFixture({ name: 'one', calls });
  const two = moduleFixture({ name: 'two', calls });
  const failed = moduleFixture({ name: 'failed', calls }, {
    async start() { calls.push('failed.start'); throw 17; },
  });
  const unstarted = moduleFixture({ name: 'unstarted', calls });
  expect(await runBootLifecycle({ modules: [one, two, failed, unstarted] })).toEqual({ ok: false, modules: [
    { name: 'one', owner: 'host', criticality: 'critical', lifecycle: { status: 'ready' } },
    { name: 'two', owner: 'host', criticality: 'critical', lifecycle: { status: 'ready' } },
    { name: 'failed', owner: 'host', criticality: 'critical', lifecycle: {
      status: 'failed', reasonCode: '17',
      remediationHint: 'check the boot log for the underlying error and retry after fixing it',
    } },
  ] });
  expect(calls).toEqual([
    'one.prepare', 'two.prepare', 'failed.prepare', 'unstarted.prepare',
    'one.start', 'two.start', 'failed.start', 'two.stop', 'one.stop',
  ]);
});

it('publishes the same failed snapshot before best-effort reporting and returns it when reporting throws', async () => {
  const calls: string[] = [];
  let published: BootResult | undefined;
  let reported: BootResult | undefined;
  const failed = moduleFixture({ name: 'failed', calls }, {
    async prepare() { throw new Error('boot failed'); },
  });
  const readiness: ReadinessStore = {
    set({ snapshot }) { published = snapshot; calls.push('publish'); },
    get() { return { ok: true, modules: [] }; },
  };
  const reporter: LifecycleReporter = {
    report({ result }) { reported = result; calls.push('report'); throw new Error('report failed'); },
  };
  const result = await runBootLifecycle({ modules: [failed] }, { readiness, reporter });
  expect(result.ok).toBe(false);
  expect(published).toBe(result);
  expect(reported).toBe(result);
  expect(calls).toEqual(['publish', 'report']);
});

it('reports without a readiness store', async () => {
  const reports: BootResult[] = [];
  const reporter: LifecycleReporter = { report({ result }) { reports.push(result); } };
  const result = await runBootLifecycle({ modules: [] }, { reporter });
  expect(reports).toEqual([{ ok: true, modules: [] }]);
  expect(reports[0]).toBe(result);
});

it('propagates readiness publication errors before invoking the reporter', async () => {
  const calls: string[] = [];
  const error = new Error('readiness unavailable');
  const readiness: ReadinessStore = {
    set() { calls.push('publish'); throw error; },
    get() { return { ok: true, modules: [] }; },
  };
  const reporter: LifecycleReporter = { report() { calls.push('report'); } };
  await expect(runBootLifecycle({ modules: [] }, { readiness, reporter })).rejects.toBe(error);
  expect(calls).toEqual(['publish']);
});
