import {
  createToolRegistry,
  APPROVAL_WAIT_TIMEOUT_MS,
  type Principal,
  type RunRef,
  type ToolRegistration,
} from '@jini-ai/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolExecutor } from '../tool-executor.js';

/**
 * Characterization (S15 step 0a). Progress frames from the MCP host to the CLI are a transport
 * keepalive; they never reach this executor. These tests pin the 120 s human-approval window so
 * that a later change to the transport cannot silently move it: an expired card stays expired and
 * a late answer has zero effects.
 */

const principal: Principal = { id: 'user-1' };
const run: RunRef = { id: 'run-1' };

type Answer = 'confirmed' | 'declined';

/** Fake of the human-confirmer interface: a person's answer arrives through `answer`. */
function createFakeConfirmer() {
  const waiters: Array<(answer: Answer) => void> = [];
  return {
    ask: ({ signal }: { signal: AbortSignal }) => new Promise<Answer | 'abandoned'>(resolve => {
      waiters.push(resolve);
      signal.addEventListener('abort', () => resolve('abandoned'), { once: true });
    }),
    answer: ({ answer }: { answer: Answer }) => { for (const resolve of waiters.splice(0)) resolve(answer); },
  };
}

/** A handler that owns its approval wait, like the real approval handlers: effect only after a live "confirmed". */
function approvalTool({ confirmer, timeoutMs }: { confirmer: ReturnType<typeof createFakeConfirmer>; timeoutMs?: number }) {
  const effects: string[] = [];
  const registration: ToolRegistration = {
    descriptor: { id: 'page.publish', ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    policy: { authorize: () => 'allow' },
    handler: async (ctx, options) => {
      options?.onApprovalStateChange?.({ pending: true });
      const answer = await confirmer.ask({ signal: ctx.signal });
      options?.onApprovalStateChange?.({ pending: false });
      if (answer !== 'confirmed' || ctx.signal.aborted) return 'not-confirmed';
      effects.push('published');
      return 'published';
    },
  };
  const registry = createToolRegistry({});
  registry.register(registration);
  return { registry, effects };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('S15 0a: the human-approval window is pinned at 120 000 ms', () => {
  it('uses the shared constant', () => {
    expect(APPROVAL_WAIT_TIMEOUT_MS).toBe(120_000);
  });

  it('1. a pending approval nobody answers ends at 120 000 ms as timed-out with zero effects', async () => {
    const confirmer = createFakeConfirmer();
    const { registry, effects } = approvalTool({ confirmer });
    let settled = false;
    const pending = createToolExecutor({ registry }).execute({ principal, run, toolId: 'page.publish', input: {} }).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'timed-out' });
    expect(effects).toEqual([]);
  });

  it('2. a confirmation delivered at 120 001 ms has zero effects and produces no second result', async () => {
    const confirmer = createFakeConfirmer();
    const { registry, effects } = approvalTool({ confirmer });
    const executor = createToolExecutor({ registry });
    const pending = executor.execute({ principal, run, toolId: 'page.publish', input: {} });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    const record = executor.getAuditRecord({ executionId: result.executionId });
    const eventsAtExpiry = record?.events.length;
    await vi.advanceTimersByTimeAsync(1);
    confirmer.answer({ answer: 'confirmed' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result).toMatchObject({ status: 'timed-out' });
    expect(effects).toEqual([]);
    expect(executor.getAuditRecord({ executionId: result.executionId })?.events.length).toBe(eventsAtExpiry);
  });

  it('3. cancellation while the approval is pending is cancelled with zero effects', async () => {
    const confirmer = createFakeConfirmer();
    const { registry, effects } = approvalTool({ confirmer });
    const transport = new AbortController();
    const pending = createToolExecutor({ registry }).execute({ principal, run, toolId: 'page.publish', input: {} }, { signal: transport.signal });
    await vi.advanceTimersByTimeAsync(40_000);
    transport.abort();
    expect(await pending).toMatchObject({ status: 'cancelled' });
    confirmer.answer({ answer: 'confirmed' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(effects).toEqual([]);
  });

  it('control: an answer before 120 000 ms runs the effect once', async () => {
    const confirmer = createFakeConfirmer();
    const { registry, effects } = approvalTool({ confirmer });
    const pending = createToolExecutor({ registry }).execute({ principal, run, toolId: 'page.publish', input: {} });
    await vi.advanceTimersByTimeAsync(119_000);
    confirmer.answer({ answer: 'confirmed' });
    expect(await pending).toMatchObject({ status: 'completed', output: 'published' });
    expect(effects).toEqual(['published']);
  });
});

describe('S15 0a.4: the window is used once per call (approvalWindowUsed)', () => {
  /** Opens the pending phase twice from one handler, the way a retried approval card would. */
  function twoPhaseTool({ timeoutMs }: { timeoutMs?: number }) {
    let phase!: (pending: boolean) => void;
    const registration: ToolRegistration = {
      descriptor: { id: 'page.click', ...(timeoutMs === undefined ? {} : { timeoutMs }) },
      policy: { authorize: () => 'allow' },
      handler: async (ctx, options) => {
        phase = pending => options?.onApprovalStateChange?.({ pending });
        return new Promise(resolve => ctx.signal.addEventListener('abort', () => resolve('aborted'), { once: true }));
      },
    };
    const registry = createToolRegistry({});
    registry.register(registration);
    return { registry, phase: (pending: boolean) => phase(pending) };
  }

  it('a call without an execution budget: the second pending phase gets no window at all', async () => {
    const { registry, phase } = twoPhaseTool({});
    let settled = false;
    const transport = new AbortController();
    const pending = createToolExecutor({ registry }).execute({ principal, run, toolId: 'page.click', input: {} }, { signal: transport.signal }).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(1_000);
    phase(true);
    await vi.advanceTimersByTimeAsync(10_000);
    phase(false);
    phase(true);
    await vi.advanceTimersByTimeAsync(APPROVAL_WAIT_TIMEOUT_MS * 10);
    expect(settled).toBe(false);
    transport.abort();
    expect(await pending).toMatchObject({ status: 'cancelled' });
  });

  it('a call with a 30 000 ms budget: the second phase gets only the budget left after the first', async () => {
    const { registry, phase } = twoPhaseTool({ timeoutMs: 30_000 });
    const pending = createToolExecutor({ registry }).execute({ principal, run, toolId: 'page.click', input: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    phase(true);
    await vi.advanceTimersByTimeAsync(50_000);
    phase(false);
    await vi.advanceTimersByTimeAsync(1_000);
    phase(true);
    await vi.advanceTimersByTimeAsync(23_999);
    expect(await Promise.race([pending, Promise.resolve('still-running')])).toBe('still-running');
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'timed-out' });
  });
});
