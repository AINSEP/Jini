import { describe, expect, it } from 'vitest';
import type { RouteInputContext } from '@jini-ai/http-kit';
import { RUN_MESSAGE_MAX_CHARS, runMessageRoute } from '../runs.js';

/** Pins every branch of the `POST /api/runs/:runId/messages` body parser. */
function parse({ body }: { body: unknown }, { runId = 'r' }: { runId?: string } = {}) {
  const input: RouteInputContext = { body, query: {}, params: { runId } };
  return runMessageRoute.parse(input);
}

const BAD_ATTACHMENTS = { ok: false, error: { code: 'BAD_REQUEST', message: 'attachmentIds must contain at most 10 opaque attachment refs' } };

function textRequired() {
  return {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message: 'text must be a non-empty string',
      details: { kind: 'validation', issues: [{ path: 'text', message: 'required non-empty string' }] },
    },
  };
}

describe('run message body parser', () => {
  it('refuses an empty runId before looking at the body', () => {
    expect(parse({ body: 'nope' }, { runId: '' })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'runId must be a non-empty path parameter' } });
  });

  it('refuses a non-object body', () => {
    expect(parse({ body: null })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('refuses missing text', () => {
    expect(parse({ body: {} })).toEqual(textRequired());
  });

  it('refuses whitespace-only text', () => {
    expect(parse({ body: { text: '   ' } })).toEqual(textRequired());
  });

  it('refuses non-string text', () => {
    expect(parse({ body: { text: 5 } })).toEqual(textRequired());
  });

  it('accepts text exactly at the ceiling', () => {
    const text = 'a'.repeat(RUN_MESSAGE_MAX_CHARS);
    expect(parse({ body: { text } })).toEqual({ ok: true, value: { runId: 'r', text } });
  });

  it('refuses text one character over the ceiling', () => {
    expect(parse({ body: { text: 'a'.repeat(RUN_MESSAGE_MAX_CHARS + 1) } })).toEqual({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: `text must be at most ${RUN_MESSAGE_MAX_CHARS} characters`,
        details: { kind: 'validation', issues: [{ path: 'text', message: 'too long' }] },
      },
    });
  });

  it('keeps surrounding whitespace in accepted text', () => {
    expect(parse({ body: { text: ' hi ' } })).toEqual({ ok: true, value: { runId: 'r', text: ' hi ' } });
  });

  it('omits attachmentIds when absent', () => {
    expect(parse({ body: { text: 'hi' } })).toEqual({ ok: true, value: { runId: 'r', text: 'hi' } });
  });

  it('refuses a non-array attachmentIds', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: 'attachment:1' } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses a null attachmentIds', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: null } })).toEqual(BAD_ATTACHMENTS);
  });

  it('accepts exactly 10 attachment refs', () => {
    const attachmentIds = Array.from({ length: 10 }, (_, i) => `attachment:${i}`);
    expect(parse({ body: { text: 'hi', attachmentIds } })).toEqual({ ok: true, value: { runId: 'r', text: 'hi', attachmentIds } });
  });

  it('refuses 11 attachment refs', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: Array.from({ length: 11 }, (_, i) => `attachment:${i}`) } })).toEqual(BAD_ATTACHMENTS);
  });

  it('accepts an empty attachment list and keeps it', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: [] } })).toEqual({ ok: true, value: { runId: 'r', text: 'hi', attachmentIds: [] } });
  });

  it('refuses a non-string ref', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: [1] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses a ref without the attachment: prefix', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: ['file:1'] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses a path-shaped ref', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: ['attachment:../secret'] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses an empty ref id', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: ['attachment:'] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('accepts a 128-character ref id with word characters and dashes', () => {
    const attachmentIds = [`attachment:${'a-_'.repeat(42)}ab`];
    expect(parse({ body: { text: 'hi', attachmentIds } })).toEqual({ ok: true, value: { runId: 'r', text: 'hi', attachmentIds } });
  });

  it('refuses a 129-character ref id', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: [`attachment:${'a'.repeat(129)}`] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses a ref with a trailing newline', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: ['attachment:1\n'] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('refuses a list where only a later ref is malformed', () => {
    expect(parse({ body: { text: 'hi', attachmentIds: ['attachment:1', 'attachment:2/x'] } })).toEqual(BAD_ATTACHMENTS);
  });

  it('checks text before attachmentIds', () => {
    expect(parse({ body: { attachmentIds: 'bad' } })).toEqual(textRequired());
  });
});
