/**
 * Characterization test — extraction-plan §8 task 5 gate: "OD characterization
 * tests emit the same ordered event sequence."
 *
 * Methodology note (read before editing this file): there was no running OD
 * daemon or captured live event-stream fixture available in this environment
 * to diff against byte-for-byte. What follows instead is a fixture that
 * hand-encodes the specific *ordering invariants* and payload field-name
 * shapes documented via direct citation to the researched OD source
 * (`apps/daemon/src/runtimes/start-chat-run.ts`, `apps/daemon/src/runtimes/runs.ts`,
 * `apps/daemon/src/runtimes/chat-run-lifecycle.ts`, and
 * `apps/daemon/src/run-failure-classification.ts`, all read at
 * `git show fork/server-endgame:<path>` on the closed/unmerged
 * `arch/server-startserver-endgame` branch — see `source-map.md`). It proves
 * `@jini-ai/daemon` reproduces those cited invariants faithfully:
 *
 *  1. `'start'` is emitted exactly once, and always first (`start-chat-run.ts`
 *     sets `run.status = 'running'` then emits `'start'` right before spawn —
 *     researched source, ~line 2170-2172).
 *  2. `'agent'` sub-events use the exact field names OD's real handlers emit:
 *     `status{label}`, `text_delta{delta}`, `tool_use{id,name,input}`,
 *     `tool_result{toolUseId,content}`, `usage{usage}` (researched source
 *     §3, citing `summarizeAgentEventForInactivity`, ~line 1939-1963).
 *  3. `'end'` is only ever produced by `finish()` / `design.runs.finish`, is
 *     always last within a terminal segment, and `finish()` is
 *     idempotency-guarded — a duplicate call while already terminal appends
 *     no second `'end'` (researched source §2, citing `runs.ts:199-217`'s
 *     `if (TERMINAL_RUN_STATUSES.has(run.status)) return;` guard).
 *  4. A resumable failure followed by `resume()` does not reset or duplicate
 *     the cursor sequence — the next segment's ids continue monotonically
 *     (generalized from OD's session-resume-on-failure concept, researched
 *     source §6, `start-chat-run.ts` ~line 1325-1377; OD's own version
 *     resumes the *external CLI session*, not the daemon-side run object —
 *     `@jini-ai/daemon` generalizes this to "the same runId continues," a
 *     documented scope decision, not a literal port).
 *
 * This is NOT a claim that OD's exact byte-for-byte SSE wire output was
 * diffed; it is an explicit, cited parity test against OD's *documented*
 * ordering contract.
 */
import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_VERSION, type RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';

describe('characterization — ordered event sequence parity with OD\'s documented run-engine invariants', () => {
  it('reproduces the exact start -> agent* -> end -> (resume) -> agent* -> end ordering', async () => {
    const eventLog = createInMemoryEventLog();
    const lifecycle = createRunLifecycle({ eventLog });

    const { run } = await lifecycle.start({ contextRef: 'ctx-characterization', agentId: 'claude-code' });

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'Thinking' } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'Sure, ' } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: "I'll check that." } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'a.ts' } } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'tool_result', toolUseId: 'tu-1', content: 'file contents' } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'usage', usage: { input_tokens: 100, output_tokens: 40 } } });

    const firstFinish = await lifecycle.finish({ runId: run.id, status: 'failed', code: null, signal: 'SIGTERM', resumable: true });
    expect(firstFinish.state).toBe('failed');

    // Idempotency guard: a duplicate finish() call immediately after,
    // before resume(), must not append a second 'end' for this segment.
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const resumeResult = await lifecycle.resume(run.id);
    expect(resumeResult.resumed).toBe(true);

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'status', label: 'Retrying' } });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'Done.' } });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const replay = await eventLog.replay(run.id, null);
    expect(replay.kind).toBe('ok');
    if (replay.kind !== 'ok') return;

    const sequence = replay.entries.map((e) => e.event);
    expect(sequence).toEqual([
      'start',
      'agent', // status
      'agent', // text_delta
      'agent', // text_delta
      'agent', // tool_use
      'agent', // tool_result
      'agent', // usage
      'end', // failed, resumable — segment 1 terminus
      'agent', // status (post-resume)
      'agent', // text_delta (post-resume)
      'end', // succeeded — segment 2 terminus
    ]);

    // 'start' exactly once, at position 0.
    expect(sequence.filter((e) => e === 'start')).toHaveLength(1);
    expect(sequence[0]).toBe('start');

    // Cursor ids are strictly monotonically increasing across both segments
    // (resume() does not reset the sequence — invariant 4 above).
    const ids = replay.entries.map((e) => Number(e.id));
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]!);
    }

    // Exact payload field-name shapes (invariant 2 above).
    const agentPayloads = replay.entries.filter((e) => e.event === 'agent').map((e) => e.data as Record<string, unknown>);
    expect(agentPayloads[0]).toEqual({ type: 'status', label: 'Thinking' });
    expect(agentPayloads[1]).toEqual({ type: 'text_delta', delta: 'Sure, ' });
    expect(agentPayloads[3]).toEqual({ type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'a.ts' } });
    expect(agentPayloads[4]).toEqual({ type: 'tool_result', toolUseId: 'tu-1', content: 'file contents' });
    expect(agentPayloads[5]).toEqual({ type: 'usage', usage: { input_tokens: 100, output_tokens: 40 } });

    const endEntries = replay.entries.filter((e) => e.event === 'end');
    expect(endEntries).toHaveLength(2);
    expect(endEntries[0]!.data).toMatchObject({ status: 'failed', resumable: true });
    expect(endEntries[1]!.data).toMatchObject({ status: 'succeeded', resumable: false });

    // Only two 'end' events total across the whole two-segment lifecycle —
    // the idempotency-guarded duplicate finish() call between segments
    // contributed nothing (invariant 3 above).
    const asProtocolEvents: RunProtocolEvent[] = replay.entries.map((entry) => ({
      runId: run.id,
      eventId: `${run.id}:${entry.id}`,
      opaqueCursor: entry.id,
      protocolVersion: RUN_PROTOCOL_VERSION,
      ts: entry.recordedAt,
      kind: entry.event,
      payload: entry.data,
      durability: 'durable',
    })) as RunProtocolEvent[];
    expect(asProtocolEvents).toHaveLength(11);
    expect(asProtocolEvents.every((e) => e.runId === run.id && e.protocolVersion === RUN_PROTOCOL_VERSION)).toBe(true);
  });
});
