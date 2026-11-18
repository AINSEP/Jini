import { describe, expect, it } from 'vitest';
import { DaemonHttpError, DaemonTransportFailure, getDaemonJson, postDaemonJson } from '../daemon-client.js';

const ERROR_ID = 'ERR-AAAA-BBBB-CCCC-DDDD';

function answer({ status, body, contentType = 'application/json' }: { status: number; body: string; contentType?: string }): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) } as unknown as Headers,
    text: async () => body,
  } as unknown as Response;
}

interface RecordedFailure { readonly error: unknown; readonly step: string }

function recordingReporter(): { reportFailure: (required: RecordedFailure) => { errorId: string }; records: RecordedFailure[] } {
  const records: RecordedFailure[] = [];
  return { records, reportFailure: required => { records.push(required); return { errorId: ERROR_ID }; } };
}

async function failureOf(
  { status, body, contentType }: { status: number; body: string; contentType?: string },
  options: { reportFailure?: (required: RecordedFailure) => { errorId: string } } = {},
): Promise<DaemonHttpError> {
  const fetchImpl = (async () => answer({ status, body, ...(contentType === undefined ? {} : { contentType }) })) as unknown as typeof fetch;
  try {
    await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x?q=private-query' }, { fetchImpl, ...options });
  } catch (err) {
    expect(err).toBeInstanceOf(DaemonHttpError);
    return err as DaemonHttpError;
  }
  throw new Error('expected the call to throw');
}

const HTML_500 = "<html><body>PRIVATE-CANARY draft of the owner's page</body></html>";

describe('daemon client: an answer that is not a readable envelope', () => {
  it('an HTML 500 says the answer was not readable, with the error ID, and quotes nothing of the body', async () => {
    const { reportFailure } = recordingReporter();
    const failure = await failureOf({ status: 500, body: HTML_500, contentType: 'text/html' }, { reportFailure });
    expect(failure.message).toBe(`The tool service failed (HTTP 500) and its answer was not readable. Error ID: ${ERROR_ID}. Do not retry the same call; give the user this error ID.`);
    expect(failure.message).not.toContain('PRIVATE-CANARY');
    expect(failure.status).toBe(500);
  });
  it('an empty 500 gets the same sentence', async () => {
    const { reportFailure } = recordingReporter();
    const failure = await failureOf({ status: 500, body: '', contentType: 'text/plain' }, { reportFailure });
    expect(failure.message).toBe(`The tool service failed (HTTP 500) and its answer was not readable. Error ID: ${ERROR_ID}. Do not retry the same call; give the user this error ID.`);
  });
  it('a 4xx without a readable envelope says the service refused the call', async () => {
    const { reportFailure } = recordingReporter();
    const failure = await failureOf({ status: 422, body: 'nope', contentType: 'text/plain' }, { reportFailure });
    expect(failure.message).toBe(`The tool service refused this call (HTTP 422) and its answer was not readable. Error ID: ${ERROR_ID}. Check the arguments; if they are right, give the user this error ID.`);
  });
  it('without a reporter the sentence has no error-ID clause and is still not a bare status', async () => {
    const failure = await failureOf({ status: 500, body: HTML_500, contentType: 'text/html' });
    expect(failure.message).toBe('The tool service failed (HTTP 500) and its answer was not readable. Do not retry the same call; tell the user the tool service failed.');
    const refused = await failureOf({ status: 400, body: '' });
    expect(refused.message).toBe('The tool service refused this call (HTTP 400) and its answer was not readable. Check the arguments; if they are right, tell the user the tool service refused the call.');
  });
  it('reports exactly one record per unreadable answer, with the shape of the answer and no body text', async () => {
    const { reportFailure, records } = recordingReporter();
    await failureOf({ status: 502, body: HTML_500, contentType: 'text/html' }, { reportFailure });
    expect(records).toHaveLength(1);
    const [record] = records as [RecordedFailure];
    expect(record.step).toBe('mcp daemon call');
    expect(record.error).toBeInstanceOf(DaemonTransportFailure);
    const error = record.error as DaemonTransportFailure;
    expect({ status: error.status, route: error.route, contentType: error.contentType, bodyBytes: error.bodyBytes })
      .toEqual({ status: 502, route: '/api/x', contentType: 'text/html', bodyBytes: Buffer.byteLength(HTML_500, 'utf8') });
    expect(error.message).not.toContain('PRIVATE-CANARY');
    expect(error.message).not.toContain('private-query');
  });
});

describe('daemon client: a recognized envelope', () => {
  it('a flat 404 shows the text the server wrote for the caller', async () => {
    const failure = await failureOf({ status: 404, body: '{"error":"a live run is required"}' });
    expect(failure.message).toBe('HTTP 404: a live run is required');
  });
  it('a flat envelope with a code includes the code', async () => {
    const failure = await failureOf({ status: 409, body: '{"error":"stale","code":"CONFLICT"}' });
    expect(failure.message).toBe('HTTP 409: CONFLICT: stale');
    expect(failure.code).toBe('CONFLICT');
  });
  it('a flat 503 says the service is restarting or closed', async () => {
    const failure = await failureOf({ status: 503, body: '{"error":"site scope is closed"}' });
    expect(failure.message).toBe('The tool service is restarting or closed (HTTP 503): site scope is closed. Wait a few seconds and retry once.');
  });
  it('a nested envelope keeps the byte-identical form', async () => {
    const failure = await failureOf({ status: 403, body: '{"error":{"code":"TOOL_OPERATION_DENIED","message":"x"}}' });
    expect(failure.message).toBe('HTTP 403: TOOL_OPERATION_DENIED: x');
    expect(failure.requestId).toBeUndefined();
    expect(failure.details).toBeUndefined();
  });
  it('a nested envelope with a request ID appends it as Error ID and carries code, request ID and details', async () => {
    const body = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'It broke.', requestId: ERROR_ID, details: { toolId: 'theme_write_file' } } });
    const { reportFailure, records } = recordingReporter();
    const failure = await failureOf({ status: 500, body }, { reportFailure });
    expect(failure.message).toBe(`HTTP 500: INTERNAL_ERROR: It broke. Error ID: ${ERROR_ID}.`);
    expect({ code: failure.code, requestId: failure.requestId, details: failure.details })
      .toEqual({ code: 'INTERNAL_ERROR', requestId: ERROR_ID, details: { toolId: 'theme_write_file' } });
    expect(records).toHaveLength(0);
  });
  it('a flat envelope produces no report either', async () => {
    const { reportFailure, records } = recordingReporter();
    await failureOf({ status: 404, body: '{"error":"a live run is required"}' }, { reportFailure });
    expect(records).toHaveLength(0);
  });
  it('details that are not a plain object, or are 4 KiB or more, are absent', async () => {
    const asArray = await failureOf({ status: 400, body: '{"error":{"code":"X","message":"m","details":[1]}}' });
    expect(asArray.details).toBeUndefined();
    const big = JSON.stringify({ error: { code: 'X', message: 'm', details: { text: 'a'.repeat(5000) } } });
    expect((await failureOf({ status: 400, body: big })).details).toBeUndefined();
  });
});

describe('daemon client: no unreadable answer is ever a bare status or quotes the body', () => {
  const ALPHABET = 'qxzjvkwy';
  /** Deterministic generator so a failing case can be reproduced. */
  function randomText({ length, seed }: { length: number; seed: number }): string {
    let state = seed;
    let out = '';
    for (let i = 0; i < length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out += ALPHABET[state % ALPHABET.length];
    }
    return out;
  }

  function bodiesFor({ sentence, token }: { sentence: string; token: string }): Array<{ name: string; body: string; contentType: string }> {
    return [
      { name: 'empty', body: '', contentType: 'text/plain' },
      { name: 'html', body: `<html><body>${sentence} Bearer ${token}</body></html>`, contentType: 'text/html' },
      { name: 'plain', body: `${sentence}\nAuthorization: Bearer ${token}`, contentType: 'text/plain' },
      { name: 'invalid json', body: `{"note": "${sentence}", "token": "${token}`, contentType: 'application/json' },
      { name: '5 MB', body: `${sentence} ${token} ${'a'.repeat(5 * 1024 * 1024)}`, contentType: 'text/plain' },
    ];
  }

  function sharedRun({ message, secret }: { message: string; secret: string }): string | undefined {
    for (let i = 0; i + 8 <= secret.length; i += 1) {
      if (message.includes(secret.slice(i, i + 8))) return secret.slice(i, i + 8);
    }
    return undefined;
  }

  it('across statuses 400 to 599 and five kinds of body', async () => {
    for (let status = 400; status <= 599; status += 1) {
      const sentence = randomText({ length: 40, seed: status });
      const token = randomText({ length: 40, seed: status * 7919 });
      // The 5 MB body is read for every status of the first and last 3 and for one in 25 otherwise: it is the slow case.
      const heavy = status < 403 || status > 596 || status % 25 === 0;
      for (const { name, body, contentType } of bodiesFor({ sentence, token })) {
        if (name === '5 MB' && !heavy) continue;
        const { reportFailure, records } = recordingReporter();
        const failure = await failureOf({ status, body, contentType }, { reportFailure });
        const where = `${status} ${name}`;
        expect(failure.message, where).not.toMatch(/^HTTP \d{3}$/);
        expect(failure.message.length, where).toBeLessThanOrEqual(400);
        expect(failure.message, where).toContain('Error ID:');
        expect(sharedRun({ message: failure.message, secret: sentence }), where).toBeUndefined();
        expect(sharedRun({ message: failure.message, secret: token }), where).toBeUndefined();
        expect(records, where).toHaveLength(1);
      }
    }
  }, 60_000);
});

describe('daemon client: the same rules on POST', () => {
  it('postDaemonJson reports an unreadable answer once', async () => {
    const { reportFailure, records } = recordingReporter();
    const fetchImpl = (async () => answer({ status: 500, body: HTML_500, contentType: 'text/html' })) as unknown as typeof fetch;
    await expect(postDaemonJson({ baseUrl: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, reportFailure }))
      .rejects.toThrow(`Error ID: ${ERROR_ID}`);
    expect(records).toHaveLength(1);
  });
});
