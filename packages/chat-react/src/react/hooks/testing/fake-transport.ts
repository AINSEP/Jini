/**
 * A hand-written `ChatTransport` fake for this package's own hook/component
 * tests — no global mocking, per the DI-seam discipline the OD slices use
 * (`dependencies.ts` binds a fake, never a jest/vitest module mock). Not
 * exported from the package's public barrel; import via the relative test
 * path (`../testing/fake-transport.js`).
 */
import type { AgentEvent } from '@jini-ai/chat-core';
import type { ChatTransport, RunHandlers, StartRunInput } from '../../../transport.js';

export interface FakeTransportCall {
  input: StartRunInput;
  handlers: RunHandlers;
}

export interface FakeChatTransport extends ChatTransport {
  /** Every `startRun` call, in order — inspect to drive/assert scripted event emission. */
  calls: FakeTransportCall[];
  reattachCalls: { runId: string; handlers: RunHandlers }[];
  stoppedRunIds: string[];
  /** Emits `ev` to the most recent call's handlers. */
  emit: (ev: AgentEvent) => void;
  /** Emits a live tool-input delta to the most recent call's handlers. */
  emitToolInputDelta: (id: string, name: string, delta: string) => void;
  /** Finishes the most recent run successfully with `finalEvents` (defaults to whatever was emitted so far). */
  finish: (finalEvents?: AgentEvent[]) => void;
  fail: (err: Error) => void;
  nextRunId: () => string;
}

export function createFakeChatTransport(options: { runIdPrefix?: string } = {}): FakeChatTransport {
  const prefix = options.runIdPrefix ?? 'run';
  let counter = 0;
  const calls: FakeTransportCall[] = [];
  const reattachCalls: { runId: string; handlers: RunHandlers }[] = [];
  const stoppedRunIds: string[] = [];
  let accumulated: AgentEvent[] = [];

  function currentHandlers(): RunHandlers | undefined {
    return calls[calls.length - 1]?.handlers ?? reattachCalls[reattachCalls.length - 1]?.handlers;
  }

  return {
    calls,
    reattachCalls,
    stoppedRunIds,
    nextRunId: () => `${prefix}-${counter + 1}`,
    async startRun(input, handlers) {
      counter += 1;
      accumulated = [];
      calls.push({ input, handlers });
      return { runId: `${prefix}-${counter}` };
    },
    async reattachRun(runId, handlers) {
      reattachCalls.push({ runId, handlers });
    },
    async fetchRunStatus() {
      return null;
    },
    async stopRun(runId) {
      stoppedRunIds.push(runId);
    },
    emit(ev) {
      accumulated = [...accumulated, ev];
      currentHandlers()?.onEvent(ev);
    },
    emitToolInputDelta(id, name, delta) {
      currentHandlers()?.onToolInputDelta?.(id, name, delta);
    },
    finish(finalEvents) {
      currentHandlers()?.onDone(finalEvents ?? accumulated);
    },
    fail(err) {
      currentHandlers()?.onError(err);
    },
  };
}
