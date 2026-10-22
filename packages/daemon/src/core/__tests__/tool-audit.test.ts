import { describe, expect, it } from 'vitest';
import type { SurfaceEmitter } from '@jini-ai/core';
import type { ToolExecutionResult, ToolExecutor } from '../../tool-executor.js';
import { describeInput, withToolAttemptAudit, withToolCatalogAudit, type ToolAttemptAuditSink, type ToolAttemptEvent } from '../tool-audit.js';

type ExecuteArgs = Parameters<ToolExecutor['execute']>;

/** Typed fake executor: records forwarded arguments and either settles or throws. */
function fakeInner(behavior: { readonly result?: ToolExecutionResult; readonly throws?: unknown }) {
  const calls: ExecuteArgs[] = [];
  const delegated: string[] = [];
  const inner: ToolExecutor = {
    execute: async (...args) => {
      calls.push(args);
      if ('throws' in behavior) throw behavior.throws;
      return behavior.result ?? { executionId: 'e', status: 'completed' };
    },
    resumeConfirmation: ({ executionId, decision }) => { delegated.push(`resume:${executionId}:${decision}`); },
    cancel: ({ executionId }) => { delegated.push(`cancel:${executionId}`); },
    getAuditRecord: ({ executionId }) => { delegated.push(`record:${executionId}`); return null; },
  };
  return { inner, calls, delegated };
}

function harness(
  behavior: { readonly result?: ToolExecutionResult; readonly throws?: unknown },
  overrides: { readonly readErrorId?: (args: { result: ToolExecutionResult }) => string | undefined; readonly sink?: ToolAttemptAuditSink; readonly onSinkError?: (error: unknown) => void } = {},
) {
  const events: ToolAttemptEvent[] = [];
  const reported: unknown[] = [];
  const readErrorIdCalls: ToolExecutionResult[] = [];
  const fake = fakeInner(behavior);
  const sink: ToolAttemptAuditSink = overrides.sink ?? { append: async event => { events.push(event); } };
  const audited = withToolAttemptAudit({
    inner: fake.inner, sink, workspaceId: 'ws', now: () => 'T', newAttemptId: () => 'a1',
    readErrorId: ({ result }) => { readErrorIdCalls.push(result); return overrides.readErrorId?.({ result }); },
  }, { onSinkError: overrides.onSinkError ?? (error => { reported.push(error); }) });
  const run = () => audited.execute({ principal: { id: 'p' }, run: { id: 'r' }, toolId: 'tool', input: { k: 1 } });
  return { ...fake, audited, events, reported, readErrorIdCalls, run };
}

describe('withToolAttemptAudit.execute (characterization)', () => {
  it('forwards an empty options object when neither signal nor emitSurface is supplied', async () => {
    const h = harness({});
    await h.run();
    expect(h.calls[0]![1]).toEqual({});
  });

  it('forwards only the signal when emitSurface is absent', async () => {
    const h = harness({});
    const signal = new AbortController().signal;
    await h.audited.execute({ principal: { id: 'p' }, run: { id: 'r' }, toolId: 'tool', input: null }, { signal });
    expect(Object.keys(h.calls[0]![1]!)).toEqual(['signal']);
    expect(h.calls[0]![1]!.signal).toBe(signal);
  });

  it('forwards only emitSurface when the signal is absent', async () => {
    const h = harness({});
    const emitSurface: SurfaceEmitter = async () => {};
    await h.audited.execute({ principal: { id: 'p' }, run: { id: 'r' }, toolId: 'tool', input: null }, { emitSurface });
    expect(Object.keys(h.calls[0]![1]!)).toEqual(['emitSurface']);
    expect(h.calls[0]![1]!.emitSurface).toBe(emitSurface);
  });

  it('records the requested row with value-free input metadata and identity', async () => {
    const h = harness({});
    await h.run();
    expect(h.events[0]).toEqual({ attemptId: 'a1', workspaceId: 'ws', runId: 'r', toolId: 'tool', principalId: 'p', executionId: null, phase: 'requested', at: 'T', detail: 'keys: k' });
  });

  it('labels an Error mentioning an unknown tool (any case) as unknown-tool, keeps only the error name and rethrows', async () => {
    const error = new TypeError('ToolExecutor: UNKNOWN TOOL "x"');
    const h = harness({ throws: error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.events[1]).toMatchObject({ executionId: null, phase: 'unknown-tool', detail: 'TypeError' });
  });

  it('labels any other Error as failed with its name, never its message', async () => {
    const h = harness({ throws: new RangeError('secret-ish text') });
    await expect(h.run()).rejects.toThrow('secret-ish text');
    expect(h.events[1]).toMatchObject({ phase: 'failed', detail: 'RangeError' });
    expect(JSON.stringify(h.events)).not.toContain('secret-ish');
  });

  it('labels a non-Error throw as failed with its typeof, even when the value says unknown tool', async () => {
    const h = harness({ throws: 'unknown tool' });
    await expect(h.run()).rejects.toBe('unknown tool');
    expect(h.events[1]).toMatchObject({ phase: 'failed', detail: 'string' });
  });

  it('settles a truncated result with "output truncated" and never consults readErrorId', async () => {
    const h = harness({ result: { executionId: 'e1', status: 'completed', truncated: true } }, { readErrorId: () => 'ignored' });
    await h.run();
    expect(h.events[1]).toEqual({ attemptId: 'a1', workspaceId: 'ws', runId: 'r', toolId: 'tool', principalId: 'p', executionId: 'e1', phase: 'completed', at: 'T', detail: 'output truncated' });
    expect(h.readErrorIdCalls).toEqual([]);
  });

  it('links an errorId when the host reports one', async () => {
    const result: ToolExecutionResult = { executionId: 'e2', status: 'failed' };
    const h = harness({ result }, { readErrorId: () => 'err-9' });
    expect(await h.run()).toBe(result);
    expect(h.readErrorIdCalls).toEqual([result]);
    expect(h.events[1]).toMatchObject({ executionId: 'e2', phase: 'failed', detail: 'errorId=err-9' });
  });

  it('settles with a null detail when no errorId is reported', async () => {
    const h = harness({ result: { executionId: 'e3', status: 'denied' } });
    await h.run();
    expect(h.events[1]).toMatchObject({ phase: 'denied', detail: null });
  });

  it('reports a throwing readErrorId and still returns the result with a null detail', async () => {
    const failure = new Error('reader broke');
    const result: ToolExecutionResult = { executionId: 'e4', status: 'completed' };
    const h = harness({ result }, { readErrorId: () => { throw failure; } });
    expect(await h.run()).toBe(result);
    expect(h.reported).toEqual([failure]);
    expect(h.events[1]).toMatchObject({ detail: null });
  });

  it('contains a throwing sink and a throwing reporter without changing the outcome', async () => {
    const result: ToolExecutionResult = { executionId: 'e5', status: 'completed' };
    const h = harness({ result }, {
      sink: { append: async () => { throw new Error('sink down'); } },
      onSinkError: () => { throw new Error('reporter down'); },
    });
    expect(await h.run()).toBe(result);
  });

  it('delegates resumeConfirmation, cancel and getAuditRecord unchanged', () => {
    const h = harness({});
    h.audited.resumeConfirmation({ executionId: 'x', decision: 'confirm' });
    h.audited.cancel({ executionId: 'y' });
    expect(h.audited.getAuditRecord({ executionId: 'z' })).toBeNull();
    expect(h.delegated).toEqual(['resume:x:confirm', 'cancel:y', 'record:z']);
  });
});

describe('describeInput (characterization)', () => {
  it.each([
    [null, 'input: null'], [undefined, 'input: undefined'], [[1, 2], 'input: an array of 2'], ['text', 'input: a string'],
    [{}, 'keys: none'], [{ b: 1, a: [1, 2, 3] }, 'keys: a[3], b'],
  ])('describes %j as %s', (input, expected) => {
    expect(describeInput({ input })).toBe(expected);
  });
  it('summarizes an object whose keys cannot be read without throwing', () => {
    const unreadable = new Proxy({}, { ownKeys: () => { throw new Error('no keys'); } });
    expect(describeInput({ input: unreadable })).toBe('input: an unreadable object');
  });
});

describe('withToolCatalogAudit (characterization)', () => {
  function catalogHarness() {
    const events: ToolAttemptEvent[] = [];
    const searches: { query: string; options: { limit?: number } | undefined }[] = [];
    const audited = withToolCatalogAudit({
      sink: { append: async event => { events.push(event); } }, now: () => 'T', newAttemptId: () => 'a1',
      identity: { workspaceId: 'w', runId: 'r', principalId: 'p' }, searchToolId: 'search', describeToolId: 'describe',
      catalog: {
        search: ({ query }, options) => { searches.push({ query, options }); return [{ id: 'x' }]; },
        describe: ({ id }) => (id === 'x' ? { id } : null),
      },
    });
    return { audited, events, searches };
  }
  it('forwards no limit and records limit null when none is given', () => {
    const h = catalogHarness();
    h.audited.search({ query: 'abc' });
    expect(h.searches).toEqual([{ query: 'abc', options: {} }]);
    expect(JSON.parse(h.events[0]!.detail!)).toEqual({ queryLength: 3, limit: null, resultIds: ['x'], resultCount: 1 });
  });
  it('forwards and records an explicit limit', () => {
    const h = catalogHarness();
    h.audited.search({ query: 'q' }, { limit: 4 });
    expect(h.searches[0]!.options).toEqual({ limit: 4 });
    expect(JSON.parse(h.events[0]!.detail!)).toMatchObject({ limit: 4 });
  });
  it('records found false for a missing describe entry', () => {
    const h = catalogHarness();
    expect(h.audited.describe({ id: 'missing' })).toBeNull();
    expect(h.events[0]).toMatchObject({ toolId: 'describe', phase: 'completed', executionId: null, detail: '{"id":"missing","found":false}' });
  });
});
