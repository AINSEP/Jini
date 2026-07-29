import { describe, expect, it } from 'vitest';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createRemoteToolEventRecorder } from '../remote-tool-bridge.js';

function makeLifecycle() {
  const eventLog = createInMemoryEventLog();
  return createRunLifecycle({ eventLog });
}

describe('createRemoteToolEventRecorder', () => {
  it('recordToolUse appends a tool_use agent event identical in shape to DelegatedToolBridge.execute()', async () => {
    const lifecycle = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const recorder = createRemoteToolEventRecorder({ lifecycle });

    const recorded = await recorder.recordToolUse(run.id, { toolUseId: 'tu-1', toolId: 'echo', input: { city: 'nyc' } });
    expect(recorded).toMatchObject({
      runId: run.id,
      kind: 'agent',
      payload: { type: 'tool_use', id: 'tu-1', name: 'echo', input: { city: 'nyc' } },
    });
  });

  it('recordToolResult appends a matching tool_result agent event', async () => {
    const lifecycle = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const recorder = createRemoteToolEventRecorder({ lifecycle });
    await recorder.recordToolUse(run.id, { toolUseId: 'tu-1', toolId: 'echo', input: null });

    const recorded = await recorder.recordToolResult(run.id, { toolUseId: 'tu-1', content: 'ok' });
    expect(recorded).toMatchObject({ runId: run.id, kind: 'agent', payload: { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' } });
    if (recorded.kind === 'agent') {
      expect(recorded.payload).not.toHaveProperty('isError');
    }
  });

  it('recordToolResult sets isError only when explicitly true', async () => {
    const lifecycle = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const recorder = createRemoteToolEventRecorder({ lifecycle });

    const recorded = await recorder.recordToolResult(run.id, { toolUseId: 'tu-1', content: 'boom', isError: true });
    expect(recorded).toMatchObject({ payload: { type: 'tool_result', toolUseId: 'tu-1', content: 'boom', isError: true } });
  });

  it('a live stream() subscriber attached before recording sees the remotely-recorded events, in order', async () => {
    const lifecycle = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const recorder = createRemoteToolEventRecorder({ lifecycle });

    const seen: RunProtocolEvent[] = [];
    await lifecycle.stream(run.id, (event) => seen.push(event));

    await recorder.recordToolUse(run.id, { toolUseId: 'tu-1', toolId: 'echo', input: 1 });
    await recorder.recordToolResult(run.id, { toolUseId: 'tu-1', content: 'done' });

    const kinds = seen.map((e) => (e.kind === 'agent' ? e.payload.type : e.kind));
    expect(kinds).toEqual(['start', 'tool_use', 'tool_result']);
  });

  it('propagates RunLifecycle.emit()\'s own throw for an unknown run', async () => {
    const lifecycle = makeLifecycle();
    const recorder = createRemoteToolEventRecorder({ lifecycle });
    await expect(recorder.recordToolUse('never-started', { toolUseId: 'tu-1', toolId: 'echo', input: null })).rejects.toThrow();
  });

  it('propagates RunLifecycle.emit()\'s own throw for an already-terminal run', async () => {
    const lifecycle = makeLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    const recorder = createRemoteToolEventRecorder({ lifecycle });
    await expect(recorder.recordToolResult(run.id, { toolUseId: 'tu-1', content: 'too late' })).rejects.toThrow(/terminal/);
  });
});
