import { EventSchemas, type RunAgentInput } from '@ag-ui/core';
import { readSseFrames } from '../run-events/entry.js';
import type { AgUiClient } from './ag-ui-transport.js';

async function readAgUiResponse({ request, input, signal, observer }: {
  request: (required: { input: RunAgentInput; signal: AbortSignal }) => Promise<Response>;
  input: RunAgentInput;
  signal: AbortSignal;
  observer: Parameters<ReturnType<AgUiClient['run']>['subscribe']>[0];
}): Promise<void> {
  const response = await request({ input, signal });
  if (!response.body) throw new Error('The agent response has no event stream');
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal });
  for await (const frame of readSseFrames({ body })) {
    observer.next(EventSchemas.parse(JSON.parse(frame.data)));
  }
}

export function createAgUiFetchAgent({ request }: {
  request: Parameters<typeof readAgUiResponse>[0]['request'];
}, _optional: Record<string, never> = {}): AgUiClient {
  const abortController = new AbortController();
  return {
    abortController,
    abortRun: () => abortController.abort(),
    run: (input) => ({
      subscribe(observer) {
        return readAgUiResponse({ request, input, signal: abortController.signal, observer }).then(
          () => observer.complete(),
          (error: unknown) => observer.error(error),
        );
      },
    }),
  };
}
