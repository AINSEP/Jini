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

/** Pins what the client prints today for answers that are not a nested envelope. Rows 1 to 4 are the bare statuses S8 removes. */
describe('daemon client: bare status (characterization)', () => {
  it('an HTML 500 prints only the status', async () => {
    const body = "<html><body>PRIVATE-CANARY draft of the owner's page</body></html>";
    expect(await messageOf({ status: 500, body, contentType: 'text/html' })).toBe('HTTP 500');
  });
  it('a flat 404 envelope prints only the status', async () => {
    expect(await messageOf({ status: 404, body: '{"error":"a live run is required"}', contentType: 'application/json' })).toBe('HTTP 404');
  });
  it('a flat 503 envelope prints only the status', async () => {
    expect(await messageOf({ status: 503, body: '{"error":"site scope is closed"}', contentType: 'application/json' })).toBe('HTTP 503');
  });
  it('an empty 500 prints only the status', async () => {
    expect(await messageOf({ status: 500, body: '', contentType: 'text/plain' })).toBe('HTTP 500');
  });
  it('a nested envelope prints status, code and message', async () => {
    const body = '{"error":{"code":"TOOL_OPERATION_DENIED","message":"x"}}';
    expect(await messageOf({ status: 403, body, contentType: 'application/json' })).toBe('HTTP 403: TOOL_OPERATION_DENIED: x');
  });
});
