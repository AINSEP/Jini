import { EventEmitter } from 'node:events';
import type { request as httpRequest, RequestOptions } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createRemoteAttachmentLookup } from '../../remote-attachment-lookup.js';
import { AttachmentRejectedError } from '../attachments.js';

function transport({ status = 200, chunks = [], failure }: {
  status?: number | null; chunks?: string[]; failure?: 'request' | 'response';
}) {
  const calls: { url: string; options: RequestOptions; payload: unknown }[] = [];
  const error = new Error('transport disconnected');
  const request = (url: URL, options: RequestOptions, receive: (response: EventEmitter) => void) => {
    const req = new EventEmitter();
    return Object.assign(req, { end(body: string) {
      calls.push({ url: url.href, options, payload: JSON.parse(body) });
      if (failure === 'request') { req.emit('error', error); return; }
      const response = Object.assign(new EventEmitter(), { statusCode: status ?? undefined, setEncoding() {} });
      receive(response);
      if (failure === 'response') { response.emit('error', error); return; }
      for (const chunk of chunks) response.emit('data', chunk);
      response.emit('end');
    } });
  };
  const lookup = createRemoteAttachmentLookup({ baseUrl: 'http://127.0.0.1:4567/ignored', token: 'test-token' },
    { request: request as unknown as typeof httpRequest });
  return { lookup, calls, error };
}

describe('remote attachment lookup transport boundary', () => {
  it('sends the exact operation, authorization and UTF-8 byte length, then joins response chunks', async () => {
    const f = transport({ chunks: ['{"value":', '{"name":"café.txt"}}'] });
    await expect(f.lookup.resolveForRun({ ref: 'attachment:café', runId: 'r' })).resolves.toEqual({ name: 'café.txt' });
    const payload = { op: 'resolveForRun', ref: 'attachment:café', runId: 'r' };
    expect(f.calls).toEqual([{
      url: 'http://127.0.0.1:4567/internal/attachment-lookup', payload,
      options: { method: 'POST', agent: false, headers: {
        authorization: 'Bearer test-token', 'content-type': 'application/json',
        'content-length': Buffer.byteLength(JSON.stringify(payload)),
      } },
    }]);
  });

  it.each(['null', '{}', '{"value":null}', '{not-json'])('maps missing resolve values to undefined: %s', body => {
    const f = transport({ chunks: [body] });
    return expect(f.lookup.resolveForRun({ ref: 'ref', runId: 'r' })).resolves.toBeUndefined();
  });

  it.each([
    { status: null, body: '{}', message: 'attachment lookup failed: HTTP 0' },
    { status: null, body: 'broken', message: 'attachment lookup failed: HTTP 0' },
    { status: 502, body: 'broken', message: 'attachment lookup failed: HTTP 502' },
    { status: 500, body: '{"error":"opaque"}', message: 'attachment lookup failed: HTTP 500' },
    { status: 403, body: '{"error":{"code":"DENIED"}}', message: 'attachment lookup failed: HTTP 403 DENIED' },
    { status: 400, body: '{"error":{"code":7}}', message: 'attachment lookup failed: HTTP 400' },
    { status: 400, body: '{"error":{"code":"ATTACHMENT_REJECTED"}}', message: 'attachment lookup failed: HTTP 400 ATTACHMENT_REJECTED' },
  ])('rejects malformed or non-store failures with a bounded status message: $message', async ({ status, body, message }) => {
    const f = transport({ status, chunks: [body] });
    await expect(f.lookup.listPendingForOwner({ ownerId: 'owner' })).rejects.toThrow(message);
  });

  it('restores typed store rejections even when the remote message is absent', async () => {
    const f = transport({ status: 400, chunks: [JSON.stringify({ error: {
      code: 'ATTACHMENT_REJECTED', details: { reason: 'attachment-unknown-or-claimed' },
    } })] });
    await expect(f.lookup.resolveForRun({ ref: 'ref', runId: 'r' })).rejects.toMatchObject({
      name: 'AttachmentRejectedError', reason: 'attachment-unknown-or-claimed', message: '',
    });
    await expect(f.lookup.resolveForRun({ ref: 'ref', runId: 'r' })).rejects.toBeInstanceOf(AttachmentRejectedError);
  });

  it.each(['request', 'response'] as const)('propagates a %s stream error without replacing it', async failure => {
    const f = transport({ failure });
    await expect(f.lookup.listPendingForOwner({ ownerId: 'owner' }, { runId: 'run' })).rejects.toBe(f.error);
    expect(f.calls[0]!.payload).toEqual({ op: 'listPendingForOwner', ownerId: 'owner', runId: 'run' });
  });
});
