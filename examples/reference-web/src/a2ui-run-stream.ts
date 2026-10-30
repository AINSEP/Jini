import { drainRunEventFrames, type RunEventEnvelope } from './run-event-frames.js';

interface StreamCallbacks {
  onA2uiMessage: (message: unknown) => void;
  onStatus: (label: string) => void;
  onDone: (status: 'succeeded' | 'failed' | 'cancelled') => void;
  onError: (error: Error) => void;
}

export async function streamA2uiRun({ runId, callbacks, signal, fetch }: { runId: string; callbacks: StreamCallbacks; signal: AbortSignal; fetch: typeof globalThis.fetch }, _options = {}): Promise<void> {
  // Deliberately plain `fetch`, not `fetchWithTimeout` — same reasoning as `daemon-transport.ts`'s
  // `streamRun`: this reads an SSE-over-fetch stream that can legitimately stay open for a whole
  // long-running agent turn, and the caller's own `signal` is the correct cancellation mechanism.
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { signal });
  if (!response.ok) throw new Error(`daemon returned ${response.status} for the A2UI Lab run's event stream`);
  if (!response.body) throw new Error('the daemon returned an empty event stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let reachedEnd = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      buffered = drainRunEventFrames({ buffered, onEvent: event => {
        if (deliverA2uiEvent({ event, callbacks })) reachedEnd = true;
      } });
      if (done) break;
    }
    if (!reachedEnd && !signal.aborted) throw new Error('the A2UI Lab event stream closed before the run ended');
  } finally {
    reader.releaseLock();
  }
}

function deliverA2uiEvent({ event, callbacks }: { event: RunEventEnvelope; callbacks: StreamCallbacks }): boolean {
  if (event.kind === 'agent') {
    deliverA2uiAgentEvent({ payload: event.payload, callbacks });
    return false;
  }
  if (event.kind === 'error') {
    const payload = event.payload as { message?: unknown };
    callbacks.onError(new Error(typeof payload.message === 'string' ? payload.message : 'the A2UI Lab run failed'));
    return false;
  }
  if (event.kind === 'end') {
    const payload = event.payload as { status?: unknown };
    callbacks.onDone(payload.status === 'failed' ? 'failed' : payload.status === 'cancelled' ? 'cancelled' : 'succeeded');
    return true;
  }
  return false;
}

function deliverA2uiAgentEvent({ payload: raw, callbacks }: { payload: unknown; callbacks: StreamCallbacks }): void {
  const payload = raw as { type?: string; label?: string; detail?: string; message?: unknown };
  if (payload.type === 'a2ui') callbacks.onA2uiMessage(payload.message);
  else if (payload.type === 'status') callbacks.onStatus(payload.detail ? `${payload.label ?? ''} — ${payload.detail}` : (payload.label ?? ''));
}
