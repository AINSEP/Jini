import { EventSchemas, type AGUIEvent, type RunAgentInput } from '@ag-ui/core';
import { readSseFrames } from '../run-events/entry.js';
import type { AgUiClient } from './ag-ui-transport.js';

/** The fetch agent's own run handle: the common {@link AgUiClient} port, typed with the official event union. */
export interface AgUiFetchAgent extends AgUiClient {
  run(input: RunAgentInput): {
    subscribe(observer: {
      next(event: AGUIEvent): void;
      error(error: unknown): void;
      complete(): void;
    }): Promise<void>;
  };
}

type AgUiRequest = (required: { input: RunAgentInput; signal: AbortSignal }) => Promise<Response>;
type AgUiByteActivity = (required: { byteLength: number }, optional?: Record<string, never>) => void;

/**
 * Read one AG-UI response body into validated events.
 * Byte activity is reported per nonempty network chunk, before SSE framing, so a heartbeat or a
 * half-delivered frame still proves the connection is alive; the host owns what that means (idle
 * timers), while `readSseFrames` and `EventSchemas.parse` stay the sole parser and validator.
 * @complexity O(n) in response bytes.
 */
async function readAgUiResponse({ request, input, signal, observer, onBytes }: {
  request: AgUiRequest;
  input: RunAgentInput;
  signal: AbortSignal;
  observer: Parameters<ReturnType<AgUiFetchAgent['run']>['subscribe']>[0];
  onBytes?: AgUiByteActivity | undefined;
}): Promise<void> {
  const response = await request({ input, signal });
  if (!response.body) throw new Error('The agent response has no event stream');
  const activity = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk.byteLength > 0) onBytes?.({ byteLength: chunk.byteLength });
      controller.enqueue(chunk);
    },
  });
  const body = response.body.pipeThrough(activity, { signal });
  for await (const frame of readSseFrames({ body })) {
    observer.next(EventSchemas.parse(JSON.parse(frame.data)));
  }
}

/**
 * Create a minimal fetch-backed AG-UI agent. The host injects HTTP (`request`), and may inject the
 * controller that owns cancellation and a byte-activity callback for its idle policy.
 */
export function createAgUiFetchAgent({ request }: { request: AgUiRequest }, {
  abortController = new AbortController(),
  onBytes,
}: { abortController?: AbortController; onBytes?: AgUiByteActivity } = {}): AgUiFetchAgent {
  return {
    abortController,
    abortRun: () => abortController.abort(),
    run: (input) => ({
      subscribe(observer) {
        return readAgUiResponse({ request, input, signal: abortController.signal, observer, onBytes }).then(
          () => observer.complete(),
          (error: unknown) => observer.error(error),
        );
      },
    }),
  };
}
