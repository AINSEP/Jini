import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { expect, test, vi } from 'vitest';
import { captureHtmlResponse } from '../html-response.js';

async function request(handler: RequestListener): Promise<{ body: string; headers: Headers }> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    return { body: await response.text(), headers: response.headers };
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('buffers HTML writes, transforms once and preserves write/end callbacks and deferred headers', async () => {
  let writes = 0, ends = 0;
  const transform = vi.fn(async ({ body }: { body: Buffer }) => Buffer.from(body.toString() + '!'));
  const response = await request((_req, res) => {
    captureHtmlResponse({ response: res, transform });
    res.writeHead(201, 'Created', { 'Content-Type': 'text/html', 'Content-Length': '10', ETag: 'old', 'X-Kept': 'yes' });
    res.flushHeaders();
    res.write('<html>', () => { writes++; });
    res.end('body', () => { ends++; });
  });
  expect(response.body).toBe('<html>body!');
  expect(transform).toHaveBeenCalledTimes(1);
  expect(writes).toBe(1); expect(ends).toBe(1);
  expect(response.headers.get('etag')).toBeNull();
  expect(response.headers.get('x-kept')).toBe('yes');
  expect(response.headers.get('content-security-policy')).toBeNull();
});

test('transform failures and oversized end chunks preserve original bytes and validators', async () => {
  for (const overflow of [false, true]) {
    const transform = vi.fn(async ({ body }: { body: Buffer }) => { body.fill('x'); throw new Error('transform unavailable'); });
    let ended = false;
    const response = await request((_req, res) => {
      captureHtmlResponse({ response: res, transform }, { maxBytes: overflow ? 4 : 1024 });
      res.setHeader('Content-Type', 'text/html'); res.setHeader('ETag', 'original');
      res.end('<html>unchanged</html>', () => { ended = true; });
    });
    expect(response.body).toBe('<html>unchanged</html>');
    expect(response.headers.get('etag')).toBe('original');
    expect(ended).toBe(true);
    expect(transform).toHaveBeenCalledTimes(overflow ? 0 : 1);
  }
});

test('piped oversized HTML resumes native backpressure without dropping chunks', async () => {
  const parts = ['<html>', 'a'.repeat(128 * 1024), 'b'.repeat(128 * 1024), '</html>'];
  const transform = vi.fn(async ({ body }: { body: Buffer }) => body);
  const response = await request((_req, res) => {
    captureHtmlResponse({ response: res, transform }, { maxBytes: 16 });
    res.setHeader('Content-Type', 'text/html');
    Readable.from(parts).pipe(res);
  });
  expect(response.body).toBe(parts.join(''));
  expect(transform).not.toHaveBeenCalled();
});

test('sendFile HTML transforms with fresh lengths; binary output stays on native methods', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'html-response-'));
  try {
    await writeFile(path.join(directory, 'page.html'), '<html>file</html>');
    const app = express();
    app.use((_req, res, next) => { captureHtmlResponse({ response: res, transform: async ({ body }) => Buffer.from(body.toString() + ' transformed') }); next(); });
    app.get('/', (_req, res) => res.sendFile(path.join(directory, 'page.html')));
    expect((await request(app)).body).toBe('<html>file</html> transformed');
    const transform = vi.fn(async () => Buffer.from('wrong'));
    const binary = await request((_req, res) => {
      captureHtmlResponse({ response: res, transform });
      res.writeHead(200, ['Content-Type', 'application/octet-stream', 'X-Kept', 'yes']);
      res.flushHeaders(); res.write('original'); res.end(' bytes');
    });
    expect(binary.body).toBe('original bytes'); expect(binary.headers.get('x-kept')).toBe('yes');
    expect(transform).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
