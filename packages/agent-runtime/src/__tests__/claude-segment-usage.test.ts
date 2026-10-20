import { describe, expect, it } from 'vitest';
import { createClaudeSegmentUsage } from '../claude-segment-usage.js';

/** A clock that returns each queued value in turn, then repeats the last one. */
function clock(...values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as number;
}

describe('createClaudeSegmentUsage observe', () => {
  it('ignores a missing or non-object usage payload', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'm', usage: undefined });
    segment.observe({ messageId: 'm', usage: 'tokens' });
    expect(segment.hasObserved()).toBe(false);
  });

  it('does not record a message whose counters are all invalid', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'm', usage: { a: -1, b: Number.NaN, c: Infinity, d: '5' } });
    expect(segment.hasObserved()).toBe(false);
  });

  it('keeps the largest repeated snapshot per message and sums across messages', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'a', usage: { input_tokens: 5, output_tokens: 1 } });
    segment.observe({ messageId: 'a', usage: { input_tokens: 3, output_tokens: 4 } });
    segment.observe({ messageId: 'b', usage: { input_tokens: 2 } });
    expect(segment.hasObserved()).toBe(true);
    expect(segment.finish({ result: {}, interrupted: false }).usage).toEqual({ input_tokens: 7, output_tokens: 4 });
  });
});

describe('createClaudeSegmentUsage finish usage', () => {
  it('takes the larger of a reported finite counter and the observed total', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'a', usage: { input_tokens: 4, output_tokens: 9 } });
    const out = segment.finish({ result: { usage: { input_tokens: 10, output_tokens: 2, extra: 'x' } }, interrupted: false });
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 9, extra: 'x' });
  });

  it('replaces a non-finite reported counter with the observed total', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'a', usage: { input_tokens: 4 } });
    expect(segment.finish({ result: { usage: { input_tokens: 'n/a' } }, interrupted: false }).usage).toEqual({ input_tokens: 4 });
  });

  it('returns null usage when nothing was reported or observed', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    expect(segment.finish({ result: {}, interrupted: false }).usage).toBeNull();
  });

  it('passes a non-object reported usage through when nothing was observed', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    expect(segment.finish({ result: { usage: 'opaque' }, interrupted: false }).usage).toBe('opaque');
  });

  it('releases the observed snapshots after a finish', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.observe({ messageId: 'a', usage: { input_tokens: 4 } });
    segment.finish({ result: {}, interrupted: false });
    expect(segment.hasObserved()).toBe(false);
    expect(segment.finish({ result: {}, interrupted: false }).usage).toBeNull();
  });
});

describe('createClaudeSegmentUsage finish cost (run basis)', () => {
  const run = () => createClaudeSegmentUsage({}, { nowMs: clock(0), costBasis: 'run' });

  it('reports total_cost_usd as-is when no model cost is reported', () => {
    expect(run().finish({ result: { total_cost_usd: 1.5 }, interrupted: false }).costUsd).toBe(1.5);
  });

  it('reports null cost when the result has none', () => {
    expect(run().finish({ result: {}, interrupted: false }).costUsd).toBeNull();
  });

  it('passes a non-numeric total_cost_usd through when no model cost is reported', () => {
    expect(run().finish({ result: { total_cost_usd: 'free' }, interrupted: false }).costUsd).toBe('free');
  });

  it('takes the larger of total_cost_usd and the summed valid model costs', () => {
    const modelUsage = { a: { costUSD: 0.5 }, b: { costUSD: 0.25 }, c: { costUSD: -1 }, d: { costUSD: 'x' }, e: null, f: {} };
    expect(run().finish({ result: { total_cost_usd: 0.1, modelUsage }, interrupted: false }).costUsd).toBe(0.75);
    expect(run().finish({ result: { total_cost_usd: 2, modelUsage }, interrupted: false }).costUsd).toBe(2);
  });

  it('treats a non-numeric total_cost_usd as zero when a model cost is reported', () => {
    const out = run().finish({ result: { total_cost_usd: 'free', modelUsage: { a: { costUSD: 0.4 } } }, interrupted: false });
    expect(out.costUsd).toBe(0.4);
  });

  it('ignores a non-object modelUsage', () => {
    expect(run().finish({ result: { total_cost_usd: 1, modelUsage: 'x' }, interrupted: false }).costUsd).toBe(1);
  });

  it('never attaches session fields on the run basis', () => {
    const segment = run();
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: { total_cost_usd: 1 }, interrupted: false })).toEqual({ usage: null, costUsd: 1, durationMs: null });
  });
});

describe('createClaudeSegmentUsage finish cost (session basis)', () => {
  it('omits session fields until a non-empty string session id is set', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: '' });
    segment.setSession({ id: 42 });
    expect(segment.finish({ result: { total_cost_usd: 1 }, interrupted: false })).toEqual({ usage: null, costUsd: 1, durationMs: null });
  });

  it('reports a finite non-negative cost as cumulative for the session', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: { total_cost_usd: 1 }, interrupted: false }))
      .toEqual({ usage: null, costUsd: null, durationMs: null, costSessionId: 's', cumulativeCostUsd: 1 });
  });

  it('keeps a null cost per-run while still naming the session', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: {}, interrupted: false })).toEqual({ usage: null, costUsd: null, durationMs: null, costSessionId: 's' });
  });

  it('keeps a negative or non-finite cost per-run', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: { total_cost_usd: -1 }, interrupted: false }).costUsd).toBe(-1);
    expect(segment.finish({ result: { total_cost_usd: Infinity }, interrupted: false }).costUsd).toBe(Infinity);
  });

  it('keeps an interrupted zeroed result per-run', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: { total_cost_usd: 0 }, interrupted: true }))
      .toEqual({ usage: null, costUsd: 0, durationMs: 0, costSessionId: 's' });
  });

  it('treats an interrupted non-zero result as cumulative', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    segment.setSession({ id: 's' });
    expect(segment.finish({ result: { total_cost_usd: 3 }, interrupted: true })).toMatchObject({ costUsd: null, cumulativeCostUsd: 3 });
  });
});

describe('createClaudeSegmentUsage finish duration', () => {
  it('uses a positive reported duration', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(100, 900) });
    expect(segment.finish({ result: { duration_ms: 42 }, interrupted: true }).durationMs).toBe(42);
  });

  it('measures elapsed segment time when messages were observed', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(100, 350) });
    segment.observe({ messageId: 'a', usage: { input_tokens: 1 } });
    expect(segment.finish({ result: { duration_ms: 0 }, interrupted: false }).durationMs).toBe(250);
  });

  it('measures elapsed segment time when interrupted', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(100, 350) });
    expect(segment.finish({ result: {}, interrupted: true }).durationMs).toBe(250);
  });

  it('clamps a backwards clock to zero elapsed time', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(500, 100) });
    expect(segment.finish({ result: {}, interrupted: true }).durationMs).toBe(0);
  });

  it('passes a non-positive reported duration through for an idle segment', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(0) });
    expect(segment.finish({ result: { duration_ms: 0 }, interrupted: false }).durationMs).toBe(0);
  });

  it('starts the next segment where the previous one ended', () => {
    const segment = createClaudeSegmentUsage({}, { nowMs: clock(100, 300, 1000) });
    segment.finish({ result: {}, interrupted: false });
    expect(segment.finish({ result: {}, interrupted: true }).durationMs).toBe(700);
  });

  it('defaults the clock to Date.now', () => {
    const segment = createClaudeSegmentUsage({});
    const out = segment.finish({ result: {}, interrupted: true });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
    expect(out.durationMs).toBeLessThan(5000);
  });
});
