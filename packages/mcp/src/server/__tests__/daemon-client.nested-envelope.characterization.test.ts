import { describe, expect, it } from 'vitest';
import { getDaemonJson } from '../daemon-client.js';

/** A response double with a text body and a content type, the shape a real daemon answer has once read. */
function textResponse({ status, body, contentType }: { status: number; body: string; contentType: string }): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) } as unknown as Headers,
    text: async () => body,
  } as unknown as Response;
}

async function messageOf({ status, body, contentType }: { status: number; body: string; contentType: string }): Promise<string> {
  const fetchImpl = (async () => textResponse({ status, body, contentType })) as unknown as typeof fetch;
  try {
    await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl });
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the call to throw');
}

/**
 * The nested-envelope form that stays byte-identical for old readers. The four bare-status rows this file
 * pinned before S8 are replaced by `daemon-client.unreadable-answer.test.ts`.
 */
describe('daemon client: nested envelope (characterization)', () => {
  it('a nested envelope prints status, code and message', async () => {
    const body = '{"error":{"code":"TOOL_OPERATION_DENIED","message":"x"}}';
    expect(await messageOf({ status: 403, body, contentType: 'application/json' })).toBe('HTTP 403: TOOL_OPERATION_DENIED: x');
  });
});
