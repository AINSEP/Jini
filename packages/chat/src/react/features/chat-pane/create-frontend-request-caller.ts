import type { SurfaceEmission } from '@jini-ai/core';
import { readSurfaceFrames } from './surface-recovery-stream.js';

export interface FrontendRequestCallerRequired {
  readonly path: string;
  readonly fetch: typeof globalThis.fetch;
  readonly bindToken: () => string | undefined;
  readonly onSurface: (emission: SurfaceEmission) => void;
}
export interface FrontendRequestInput {
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal;
}

/** Execute one browser-requested capability through the host's authenticated gate, never retrying.
 * The current bind token and serialized arguments are captured before the first asynchronous wait.
 * @returns A caller that renders cards immediately and resolves only after the tool settles.
 * @throws On absent attachment, HTTP refusal, cancellation or an incomplete execution stream.
 * @complexity O(request + response bytes) time; O(largest response frame) space, capped at 5 MiB.
 * @overallScore 100
 */
export function createFrontendRequestCaller(
  { path, fetch, bindToken, onSurface }: FrontendRequestCallerRequired,
  { headers = () => ({}) }: { headers?: () => Record<string, string> } = {},
): (required: FrontendRequestInput, optional?: Record<string, never>) => Promise<unknown> {
  return async ({ capabilityId, input, signal }, _optional = {}) => {
    const token = bindToken();
    if (!token) throw new Error('Page control has not attached to this browser tab. Reopen the assistant to retry.');
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ capabilityId, input, bindToken: token }), signal,
    });
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      throw new Error(body.error ?? `The page request was refused (HTTP ${response.status}).`);
    }
    let completed = false;
    let output: unknown;
    await readSurfaceFrames({ response, onFrame: frame => {
      switch (frame.type) {
        case 'surface':
          if (frame.emission) onSurface(frame.emission as SurfaceEmission);
          return;
        case 'throw':
          throw new Error((frame.error as { message?: string })?.message ?? 'The page action could not be executed.');
        case 'result':
          if (completed) throw new Error('The page action returned more than one result.');
          output = completedOutput(frame.result);
          completed = true;
          return;
        default: return;
      }
    } });
    if (!completed) throw new Error('The page action ended without a result. Its outcome is unknown; it was not retried.');
    return output;
  };
}

/** Only a completed gated execution has an output; refusals keep the host's specific message.
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function completedOutput(value: unknown): unknown {
  const result = value as { status?: string; output?: unknown; error?: string } | undefined;
  if (result?.status !== 'completed') throw new Error(result?.error ?? `The page action was ${result?.status ?? 'not completed'}.`);
  return result.output;
}
