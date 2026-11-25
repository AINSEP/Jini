import { EventSchemas, type AGUIEvent, type RunAgentInput } from '@ag-ui/core';
import { readSseFrames } from '../run-events/entry.js';
import type { AgUiClient } from './ag-ui-transport.js';

export interface AgUiFetchAgent extends AgUiClient {
  run(input: RunAgentInput): {
    subscribe(observer: {
      next(event: AGUIEvent): void;
      error(error: unknown): void;
      complete(): void;
    }): Promise<void>;
  };
}

async function readAgUiResponse({ request, input, signal, observer, onBytes }: {
  request: (required: { input: RunAgentInput; signal: AbortSignal }) => Promise<Response>;
  input: RunAgentInput;
  signal: AbortSignal;
  observer: Parameters<ReturnType<AgUiFetchAgent['run']>['subscribe']>[0];
  onBytes?: ((required: { byteLength: number }, optional?: Record<string, never>) => void) | undefined;
}): Promise<void> {
  const response = await request({ input, signal });
  if (!response.body) throw new Error('The agent response has no event stream');
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk.byteLength > 0) onBytes?.({ byteLength: chunk.byteLength });
      controller.enqueue(chunk);
    },
  }), { signal });
  for await (const frame of readSseFrames({ body })) {
    observer.next(EventSchemas.parse(JSON.parse(frame.data)));
  }
}

export function createAgUiFetchAgent({ request }: {
  request: Parameters<typeof readAgUiResponse>[0]['request'];
}, { abortController = new AbortController(), onBytes }: {
  abortController?: AbortController;
  onBytes?: Parameters<typeof readAgUiResponse>[0]['onBytes'];
} = {}): AgUiFetchAgent {
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
