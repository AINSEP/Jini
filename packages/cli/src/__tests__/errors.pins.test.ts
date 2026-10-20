import { describe, expect, it } from 'vitest';
import { structuredErrorData, structuredHttpFailure, type HttpFailureLike, type StructuredErrorEnvelope } from '../errors.js';

// Characterization pins for errors.ts's structuredHttpFailure/structuredErrorData,
// written against the pre-refactor code.

class ExitSentinel extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

interface Captured {
  envelope: StructuredErrorEnvelope;
  exitCode: number;
}

async function capture(
  resp: HttpFailureLike,
  options: Parameters<typeof structuredHttpFailure>[1] = {},
): Promise<Captured> {
  const written: string[] = [];
  try {
    await structuredHttpFailure(
      { resp },
      {
        ...options,
        write: ({ text }) => { written.push(text); },
        exit: ({ code }) => { throw new ExitSentinel(code); },
      },
    );
  } catch (err) {
    if (!(err instanceof ExitSentinel)) throw err;
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('\n')).toBe(true);
    return { envelope: JSON.parse(written[0]!) as StructuredErrorEnvelope, exitCode: err.code };
  }
  throw new Error('structuredHttpFailure returned without exiting');
}

function body(status: number, text: string): HttpFailureLike {
  return { status, text: async () => text };
}

describe('structuredHttpFailure pins', () => {
  it('uses the default exit table for a structured daemon code', async () => {
    const out = await capture(body(400, JSON.stringify({ error: { code: 'invalid-flag', message: 'bad' } })));
    expect(out).toEqual({ exitCode: 2, envelope: { error: { code: 'invalid-flag', message: 'bad', data: {} } } });
  });

  it('honours a caller fallbackCode and exitCodes when the body has no code', async () => {
    const out = await capture(body(500, ''), { fallbackCode: 'boom', exitCodes: { boom: 9 } });
    expect(out).toEqual({ exitCode: 9, envelope: { error: { code: 'boom', message: 'HTTP 500', data: {} } } });
  });

  it('treats a resp.text() rejection like an empty body', async () => {
    const resp: HttpFailureLike = { status: 503, text: async () => { throw new Error('socket closed'); } };
    const out = await capture(resp);
    expect(out).toEqual({ exitCode: 64, envelope: { error: { code: 'daemon-not-running', message: 'HTTP 503', data: {} } } });
  });

  it('strips control sequences from a structured code', async () => {
    const out = await capture(body(400, JSON.stringify({ error: { code: 'x\u001b[31my', message: 'm' } })));
    expect(out.envelope.error.code).toBe('xy');
  });

  it('ignores a non-string code and falls back', async () => {
    const out = await capture(body(400, JSON.stringify({ error: { code: 7, message: 'm' } })));
    expect(out.envelope.error.code).toBe('daemon-not-running');
  });

  it('falls back to HTTP <status> plus rawExcerpt when the error object has a non-string message', async () => {
    const raw = JSON.stringify({ error: { message: 42, retryable: true } });
    const out = await capture(body(418, raw));
    expect(out.envelope.error.message).toBe('HTTP 418');
    expect(out.envelope.error.data).toEqual({ retryable: true, rawExcerpt: raw });
  });

  it('does not attach rawExcerpt when a structured message is present', async () => {
    const out = await capture(body(400, JSON.stringify({ error: { message: 'nope', details: 'd' } })));
    expect(out.envelope.error).toEqual({ code: 'daemon-not-running', message: 'nope', data: { details: 'd' } });
  });

  it('attaches rawExcerpt for a JSON body without an error key', async () => {
    const out = await capture(body(500, '{"ok":false}'));
    expect(out.envelope.error.data).toEqual({ rawExcerpt: '{"ok":false}' });
  });

  it('attaches rawExcerpt for a JSON null body', async () => {
    const out = await capture(body(500, 'null'));
    expect(out.envelope.error.data).toEqual({ rawExcerpt: 'null' });
  });

  it('lets a caller-supplied options.data override the daemon-derived data', async () => {
    const out = await capture(body(400, JSON.stringify({ error: { message: 'm', details: 'd' } })), { data: { mine: 1 } });
    expect(out.envelope.error.data).toEqual({ mine: 1 });
  });
});

describe('structuredErrorData pins', () => {
  it('ignores a null data field', () => {
    expect(structuredErrorData({ error: { data: null } })).toBeUndefined();
  });

  it('merges an array data field as index keys', () => {
    expect(structuredErrorData({ error: { data: ['a'] } })).toEqual({ 0: 'a' });
  });

  it('carries a falsy-but-defined details value', () => {
    expect(structuredErrorData({ error: { details: 0 } })).toEqual({ details: 0 });
  });

  it('carries retryable=false', () => {
    expect(structuredErrorData({ error: { retryable: false } })).toEqual({ retryable: false });
  });

  it('lets details/retryable win over same-named keys inside data', () => {
    expect(structuredErrorData({ error: { data: { details: 'x', retryable: 'y' }, details: 'd', retryable: true } })).toEqual({
      details: 'd',
      retryable: true,
    });
  });
});
