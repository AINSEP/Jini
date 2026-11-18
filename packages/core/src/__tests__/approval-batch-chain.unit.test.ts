import { describe, expect, it } from 'vitest';
import { createChainedBatchHandler } from '../approval-batch-chain.js';
import { batchOutcomeFor } from '../batch-tool-inputs.js';
import {
  fakePrepare, fakeVersionedStore, STALE_TEXT, toolContext,
  type FakePrepared, type FakeVersionedStore,
} from './batch-chain-store-fake.js';

const SKIPPED = 'Skipped: an earlier change to this file in the same call failed.';

type Hooks = {
  afterWrite?: (required: { prepared: FakePrepared }) => void;
  beforeRun?: (required: { prepared: FakePrepared }) => void;
  onSuccessor?: (required: { prepared: FakePrepared; committed: number | undefined; previous: FakePrepared }) => void;
  committed?: (required: { prepared: FakePrepared; version: number }) => number | undefined;
  failWith?: (required: { prepared: FakePrepared }) => Error | undefined;
  prepare?: ReturnType<typeof fakePrepare>;
};

/** The fake host: a store, the four required functions and spies on what core hands them. */
function fakeHost({ files, hooks = {} }: { files: Record<string, string>; hooks?: Hooks }) {
  const store: FakeVersionedStore = fakeVersionedStore(files);
  const successorCalls: { prepared: FakePrepared; committed: number | undefined; previous: FakePrepared }[] = [];
  const targetKeyArgs: unknown[] = [];
  const handler = createChainedBatchHandler<FakePrepared, number>({
    prepare: hooks.prepare ?? fakePrepare({ store }),
    run: async ({ prepared }) => {
      hooks.beforeRun?.({ prepared });
      const failure = hooks.failWith?.({ prepared });
      if (failure) throw failure;
      const version = store.write({ key: prepared.key, pinned: prepared.pinned, append: prepared.append });
      hooks.afterWrite?.({ prepared });
      const committed = hooks.committed ? hooks.committed({ prepared, version }) : version;
      return { output: `${prepared.key}+${prepared.append}`, committed };
    },
    targetKey: (required) => { targetKeyArgs.push(required); return required.prepared.key; },
    successor: (required) => {
      successorCalls.push(required);
      hooks.onSuccessor?.(required);
      return { ...required.prepared, pinned: required.committed ?? required.previous.pinned };
    },
  }, { targetNoun: 'file' });
  return { store, handler, successorCalls, targetKeyArgs };
}

const items = (...pairs: [string, string][]) => ({ items: pairs.map(([key, append]) => ({ key, append })) });

describe('createChainedBatchHandler', () => {
  it('applies three items on one key in input order, each pinned to what the batch itself committed', async () => {
    const host = fakeHost({ files: { 'a.css': '' } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2'], ['a.css', '3']) }));
    expect(result).toEqual({ batch: true, total: 3, results: [
      { index: 0, ok: true, result: 'a.css+1' }, { index: 1, ok: true, result: 'a.css+2' }, { index: 2, ok: true, result: 'a.css+3' },
    ] });
    expect(host.store.bytes({ key: 'a.css' })).toBe('123');
    expect(host.successorCalls.map(call => [call.prepared.append, call.committed, call.previous.append])).toEqual([['2', 1, '1'], ['3', 2, '2']]);
    // Only the three prepare steps read the store; core never reads it again to find a baseline.
    expect(host.store.readCount()).toBe(3);
  });

  it('keeps B at its prepare-time pin and chains only the items that share A', async () => {
    const host = fakeHost({ files: { 'a.css': '', 'b.css': '' } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['b.css', '1'], ['a.css', '2']) }));
    expect(batchOutcomeFor({ output: result })).toBe('completed');
    expect(host.store.bytes({ key: 'a.css' })).toBe('12');
    expect(host.store.bytes({ key: 'b.css' })).toBe('1');
    expect(host.successorCalls).toHaveLength(1);
    expect(host.successorCalls[0]).toMatchObject({ prepared: { key: 'a.css', append: '2' }, committed: 1, previous: { key: 'a.css', append: '1' } });
  });

  it('asks targetKey with { prepared } only, and never chains items with different keys', async () => {
    const host = fakeHost({ files: { 'a.css': '', 'b.css': '' } });
    await host.handler(toolContext({ input: items(['a.css', '1'], ['b.css', '2']) }));
    expect(host.targetKeyArgs).toHaveLength(2);
    for (const argument of host.targetKeyArgs) expect(Object.keys(argument as object)).toEqual(['prepared']);
    expect(host.targetKeyArgs[0]).toEqual({ prepared: { key: 'a.css', append: '1', pinned: 0 } });
    expect(host.successorCalls).toEqual([]);
  });

  it('refuses the next item with the host\'s stale text when a foreign write lands after its predecessor wrote, before the successor is computed', async () => {
    const host = fakeHost({ files: { 'a.css': '' }, hooks: {
      afterWrite: ({ prepared }) => { if (prepared.append === '1') host.store.foreignWrite({ key: 'a.css', append: 'F' }); },
    } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2']) }));
    expect(result).toEqual({ batch: true, total: 2, results: [
      { index: 0, ok: true, result: 'a.css+1' }, { index: 1, ok: false, error: STALE_TEXT },
    ] });
    expect(batchOutcomeFor({ output: result })).toBe('partial_failure');
    expect(host.store.bytes({ key: 'a.css' })).toBe('1F');
  });

  it('refuses the next item with the host\'s stale text when a foreign write lands after the successor is computed, before its run', async () => {
    const host = fakeHost({ files: { 'a.css': '' }, hooks: {
      onSuccessor: () => host.store.foreignWrite({ key: 'a.css', append: 'F' }),
    } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2']) }));
    expect(result).toEqual({ batch: true, total: 2, results: [
      { index: 0, ok: true, result: 'a.css+1' }, { index: 1, ok: false, error: STALE_TEXT },
    ] });
    expect(host.store.bytes({ key: 'a.css' })).toBe('1F');
  });

  it('refuses item 1 and skips item 2, writing nothing, when a foreign write lands during asynchronous preparation', async () => {
    const store = fakeVersionedStore({ 'a.css': '' });
    const pin = fakePrepare({ store });
    let prepared = 0;
    const host = fakeHost({ files: { 'a.css': '' }, hooks: { prepare: async (required) => {
      const value = await pin(required);
      prepared += 1;
      // Item 1 has been prepared; this writer lands before any run starts.
      if (prepared === 1) host.store.foreignWrite({ key: 'a.css', append: 'F' });
      return value;
    } } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2']) }));
    expect(result).toEqual({ batch: true, total: 2, results: [
      { index: 0, ok: false, error: STALE_TEXT }, { index: 1, ok: false, error: SKIPPED },
    ] });
    expect(batchOutcomeFor({ output: result })).toBe('error');
    expect(host.store.bytes({ key: 'a.css' })).toBe('F');
  });

  it('skips later items for the same key after an item fails for its own reason, and still runs other keys', async () => {
    const host = fakeHost({ files: { 'a.css': '', 'b.css': '' }, hooks: {
      failWith: ({ prepared }) => prepared.key === 'a.css' && prepared.append === '1' ? new Error('A1 cannot be applied: the selector is missing.') : undefined,
    } });
    const result = await host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2'], ['b.css', '1']) }));
    expect(result).toEqual({ batch: true, total: 3, results: [
      { index: 0, ok: false, error: 'A1 cannot be applied: the selector is missing.' },
      { index: 1, ok: false, error: SKIPPED },
      { index: 2, ok: true, result: 'b.css+1' },
    ] });
    expect(batchOutcomeFor({ output: result })).toBe('partial_failure');
    expect(host.store.bytes({ key: 'a.css' })).toBe('');
    expect(host.store.bytes({ key: 'b.css' })).toBe('1');
  });

  it('hands the successor the predecessor\'s own pin when the write committed nothing', async () => {
    const host = fakeHost({ files: { 'a.css': '' }, hooks: {
      committed: ({ prepared, version }) => prepared.append === '' ? undefined : version,
    } });
    // Item 1 is a byte-identical write: the version does not move and `run` reports no commit.
    const result = await host.handler(toolContext({ input: items(['a.css', ''], ['a.css', '2']) }));
    expect(host.successorCalls).toHaveLength(1);
    expect(host.successorCalls[0]).toMatchObject({ committed: undefined, previous: { append: '', pinned: 0 }, prepared: { append: '2' } });
    expect(result).toEqual({ batch: true, total: 2, results: [
      { index: 0, ok: true, result: 'a.css+' }, { index: 1, ok: true, result: 'a.css+2' },
    ] });
    expect(host.store.bytes({ key: 'a.css' })).toBe('2');
  });

  it('stops with the abandoned outcome when the call is cancelled between items; nothing after it runs', async () => {
    const abort = new AbortController();
    const host = fakeHost({ files: { 'a.css': '' }, hooks: { afterWrite: () => abort.abort() } });
    await expect(host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '2']), signal: abort.signal })))
      .rejects.toThrow('This tool call was abandoned before the next change. Retry the remaining changes when ready.');
    expect(host.store.bytes({ key: 'a.css' })).toBe('1');
    expect(host.successorCalls).toEqual([]);
  });

  it('returns a single call\'s output unchanged and lets its failure propagate', async () => {
    const host = fakeHost({ files: { 'a.css': '' } });
    expect(await host.handler(toolContext({ input: { key: 'a.css', append: '1' } }))).toBe('a.css+1');
    const failing = fakeHost({ files: { 'a.css': '' }, hooks: { failWith: () => new Error('single failure text') } });
    await expect(failing.handler(toolContext({ input: { key: 'a.css', append: '1' } }))).rejects.toThrow('single failure text');
  });

  it('keeps the batch input rules: duplicates and the item cap are refused before any preparation', async () => {
    const host = fakeHost({ files: { 'a.css': '' } });
    await expect(host.handler(toolContext({ input: items(['a.css', '1'], ['a.css', '1']) })))
      .rejects.toThrow('Duplicate batch inputs are not allowed.');
    const capped = createChainedBatchHandler<FakePrepared, number>({
      prepare: fakePrepare({ store: host.store }),
      run: async () => ({ output: 'unused', committed: undefined }),
      targetKey: ({ prepared }) => prepared.key,
      successor: ({ prepared }) => prepared,
    }, { maxItems: 2 });
    await expect(capped(toolContext({ input: items(['a.css', '1'], ['a.css', '2'], ['a.css', '3']) })))
      .rejects.toThrow('items must contain between 1 and 2 inputs.');
    expect(host.store.readCount()).toBe(0);
  });
});
