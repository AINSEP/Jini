import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CLI_EXIT_CODES,
  exitWithStructuredError,
  structuredErrorData,
  structuredHttpFailure,
  type HttpFailureLike,
} from '../errors.js';

function captureExit() {
  const written: string[] = [];
  const exited: number[] = [];
  const write = ({ text }: { text: string }) => { written.push(text); };
  const exit = ({ code }: { code: number }): never => {
    exited.push(code);
    throw new ExitSentinel(code);
  };
  return { written, exited, write, exit };
}

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

describe('exitWithStructuredError', () => {
  it('maps a known default code to its exit code and writes a JSON envelope', () => {
    const { written, exited, write, exit } = captureExit();
    expect(() =>
      exitWithStructuredError({ code: 'daemon-not-running', message: 'cannot reach' }, { write, exit }),
    ).toThrow(ExitSentinel);
    expect(exited).toEqual([DEFAULT_CLI_EXIT_CODES['daemon-not-running']]);
    expect(JSON.parse(written[0]!.trim())).toEqual({
      error: { code: 'daemon-not-running', message: 'cannot reach', data: {} },
    });
  });

  it('falls back to exit code 1 for an unrecognized code', () => {
    const { exited, write, exit } = captureExit();
    expect(() => exitWithStructuredError({ code: 'totally-unknown', message: 'x' }, { write, exit })).toThrow();
    expect(exited).toEqual([1]);
  });

  it('layers caller-supplied exitCodes over the defaults', () => {
    const { exited, write, exit } = captureExit();
    expect(() =>
      exitWithStructuredError({ code: 'plugin-not-found', message: 'x' }, { write, exit, exitCodes: { 'plugin-not-found': 65 } }),
    ).toThrow();
    expect(exited).toEqual([65]);
  });

  it('includes provided data in the envelope', () => {
    const { written, write, exit } = captureExit();
    expect(() =>
      exitWithStructuredError({ code: 'missing-input', message: 'x' }, { data: { missing: ['a'] }, ...{ write, exit } }),
    ).toThrow();
    expect(JSON.parse(written[0]!.trim())).toEqual({
      error: { code: 'missing-input', message: 'x', data: { missing: ['a'] } },
    });
  });

  it('defaults write/exit to process.stderr/process.exit when not injected', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new ExitSentinel(0);
    }) as never);
    try {
      expect(() => exitWithStructuredError({ code: 'daemon-not-running', message: 'x' })).toThrow(ExitSentinel);
      expect(writeSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['daemon-not-running']);
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('structuredErrorData', () => {
  it('returns undefined for undefined input', () => {
    expect(structuredErrorData({ error: undefined })).toBeUndefined();
  });

  it('returns undefined when the error object has nothing worth attaching', () => {
    expect(structuredErrorData({ error: {} })).toBeUndefined();
  });

  it('merges a nested data object', () => {
    expect(structuredErrorData({ error: { data: { missing: ['a'] } } })).toEqual({ missing: ['a'] });
  });

  it('ignores a non-object data field', () => {
    expect(structuredErrorData({ error: { data: 'not-an-object' } })).toBeUndefined();
  });

  it('carries details through', () => {
    expect(structuredErrorData({ error: { details: 'why' } })).toEqual({ details: 'why' });
  });

  it('carries a boolean retryable flag through', () => {
    expect(structuredErrorData({ error: { retryable: true } })).toEqual({ retryable: true });
    expect(structuredErrorData({ error: { retryable: false } })).toEqual({ retryable: false });
  });

  it('ignores a non-boolean retryable field', () => {
    expect(structuredErrorData({ error: { retryable: 'yes' } })).toBeUndefined();
  });
});

function fakeResponse(status: number, body: string): HttpFailureLike {
  return { status, text: async () => body };
}

describe('structuredHttpFailure', () => {
  it('surfaces a structured { error: { code, message, data } } body', async () => {
    const { written, exited, write, exit } = captureExit();
    const resp = fakeResponse(404, JSON.stringify({ error: { code: 'not-found', message: 'gone', data: { id: 1 } } }));
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    expect(exited).toEqual([1]);
    expect(JSON.parse(written[0]!.trim())).toEqual({
      error: { code: 'not-found', message: 'gone', data: { id: 1 } },
    });
  });

  it('surfaces a flat { error: "message" } body under the fallback code', async () => {
    const { written, exited, write, exit } = captureExit();
    const resp = fakeResponse(400, JSON.stringify({ error: 'bad request' }));
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'missing-input', ...{ write, exit } })).rejects.toThrow();
    expect(exited).toEqual([DEFAULT_CLI_EXIT_CODES['missing-input']]);
    expect(JSON.parse(written[0]!.trim())).toEqual({
      error: { code: 'missing-input', message: 'bad request', data: {} },
    });
  });

  it('falls back to a stable "HTTP <status>" message plus a redacted raw excerpt in data when the body has no error envelope', async () => {
    const { written, write, exit } = captureExit();
    const resp = fakeResponse(500, 'internal server error');
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.message).toBe('HTTP 500');
    expect(envelope.error.data).toEqual({ rawExcerpt: 'internal server error' });
  });

  it('falls back to a bare "HTTP <status>" with no data when the body is empty', async () => {
    const { written, write, exit } = captureExit();
    const resp = fakeResponse(503, '');
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.message).toBe('HTTP 503');
    expect(envelope.error.data).toEqual({});
  });

  it('treats unparsable JSON the same as an empty body, still surfacing a bounded raw excerpt', async () => {
    const { written, write, exit } = captureExit();
    const resp = fakeResponse(502, '{not json');
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.message).toBe('HTTP 502');
    expect(envelope.error.data).toEqual({ rawExcerpt: '{not json' });
  });

  it('falls back to the generic message plus a raw excerpt when the error field is neither a string nor an object', async () => {
    const { written, write, exit } = captureExit();
    const resp = fakeResponse(500, JSON.stringify({ error: 42 }));
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.message).toBe('HTTP 500');
    expect(envelope.error.data).toEqual({ rawExcerpt: '{"error":42}' });
  });

  it('strips terminal control/ANSI escape sequences from the raw body excerpt', async () => {
    const { written, write, exit } = captureExit();
    // Built via fromCharCode rather than an escape literal so the ESC byte's presence in this
    // source file is unambiguous rather than relying on how a string-escape sequence is
    // transcribed.
    const esc = String.fromCharCode(0x1b);
    const resp = fakeResponse(500, `${esc}[31mDANGER${esc}[0m raw daemon body`);
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.data.rawExcerpt as string).not.toContain(esc);
    expect(envelope.error.data.rawExcerpt).toBe('DANGER raw daemon body');
  });

  it('redacts a long token-looking substring from the raw body excerpt', async () => {
    const { written, write, exit } = captureExit();
    const secret = 'A'.repeat(40);
    const resp = fakeResponse(500, `unexpected failure, token=${secret} end`);
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.data.rawExcerpt).not.toContain(secret);
  });

  it('truncates an overlong raw body excerpt instead of embedding it verbatim', async () => {
    const { written, write, exit } = captureExit();
    // Space-separated so no run is long enough to also trip the opaque-token redaction pass —
    // this test is specifically about the length cap, not the secret redaction above it.
    const resp = fakeResponse(500, 'word '.repeat(2000));
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect((envelope.error.data.rawExcerpt as string).length).toBeLessThan(1000);
    expect(envelope.error.data.rawExcerpt).toContain('truncated');
  });

  it('sanitizes a structured error message the same way (control sequences stripped)', async () => {
    const { written, write, exit } = captureExit();
    const esc = String.fromCharCode(0x1b);
    const resp = fakeResponse(
      400,
      JSON.stringify({ error: { code: 'bad-input', message: `${esc}[2Jclobbered message` } }),
    );
    await expect(structuredHttpFailure({ resp }, { fallbackCode: 'daemon-not-running', ...{ write, exit } })).rejects.toThrow();
    const envelope = JSON.parse(written[0]!.trim());
    expect(envelope.error.message as string).not.toContain(esc);
    expect(envelope.error.message).toBe('clobbered message');
  });

  it('defaults fallbackCode to "daemon-not-running"', async () => {
    const { exited, write, exit } = captureExit();
    const resp = fakeResponse(500, '');
    await expect(structuredHttpFailure({ resp }, { ...{ write, exit } })).rejects.toThrow();
    expect(exited).toEqual([DEFAULT_CLI_EXIT_CODES['daemon-not-running']]);
  });
});
