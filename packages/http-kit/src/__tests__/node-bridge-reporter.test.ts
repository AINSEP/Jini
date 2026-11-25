// P4-J2b node bridge reporter mode: with `reporter`, an unhandled failure's reference is the
// reporter's ERR- incident ID (one host record, one tracker report) instead of a 12-hex reference.
// A pre-header failure with `next` is still the host's to answer and is not recorded here; a failure
// after the head went out is recorded once and the connection cut, never answered a second time.
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { createNodeDispatcher, type NodeDispatcher, type NodeDispatchOptions } from '../node-bridge.js';

const ID = 'ERR-AAAA-BBBB-CCCC-0001';

let open: HttpServer | undefined;
afterEach(async () => {
  const server = open;
  open = undefined;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function serve(dispatcher: NodeDispatcher, options: NodeDispatchOptions = {}): Promise<string> {
  open = createServer((incoming, out) => { void dispatcher.handle({ incoming, out }, options); });
  await new Promise<void>((resolve) => open!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(open.address() as AddressInfo).port}`;
}

function boomRoutes(dispatcher: NodeDispatcher): void {
  dispatcher.server.route({ method: 'GET', path: '/boom', handler: () => { throw new Error('secret db path /var/x'); } });
}

/** A route whose stream sends one chunk, then fails once the test says so. */
function failingStreamRoute(dispatcher: NodeDispatcher): { fail: () => void } {
  let producer!: ReadableStreamDefaultController<Uint8Array>;
  dispatcher.server.route({ method: 'GET', path: '/stream', handler: () => new Response(new ReadableStream<Uint8Array>({
    start: (c) => { producer = c; c.enqueue(new TextEncoder().encode('part')); },
  })) });
  return { fail: () => producer.error(new Error('disk gone')) };
}

describe('createNodeDispatcher reporter mode', () => {
  it('node bridge hands a pre-header failure to next without recording it', async () => {
    const { reporter, entries, reports } = createRecordingReporter({ ids: [ID], iso: '2026-01-01T00:00:00.000Z' });
    const dispatcher = createNodeDispatcher({}, { reporter });
    boomRoutes(dispatcher);
    const handed: unknown[] = [];
    open = createServer((incoming, out) => {
      void dispatcher.handle({ incoming, out }, { next: (error) => { handed.push(error); out.statusCode = 502; out.end('host page'); } });
    });
    await new Promise<void>((resolve) => open!.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(open.address() as AddressInfo).port}/boom`);
    expect([response.status, await response.text()]).toEqual([502, 'host page']);
    expect(handed).toHaveLength(1);
    expect((handed[0] as Error).message).toBe('secret db path /var/x');
    expect(entries).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('node bridge without next records once and shows the ERR- id in the plain reply', async () => {
    const { reporter, entries, reports } = createRecordingReporter({ ids: [ID], iso: '2026-01-01T00:00:00.000Z' });
    const legacySink = vi.fn();
    const dispatcher = createNodeDispatcher({}, { reporter, onUnhandledError: legacySink });
    boomRoutes(dispatcher);
    const response = await fetch(`${await serve(dispatcher)}/boom`);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(text).toContain(`Reference: ${ID}.`);
    expect(text).not.toContain('secret');
    expect(entries).toHaveLength(1);
    expect(reports.map((report) => report.context.incidentId)).toEqual([ID]);
    // The reporter is the one ref source: the legacy sink is never also called.
    expect(legacySink).not.toHaveBeenCalled();
  });

  it('node bridge after headers records once and destroys without a second reply', async () => {
    // A spare ID, so a second record would succeed and be seen rather than fail on an exhausted list.
    const { reporter, entries, reports } = createRecordingReporter({ ids: [ID, 'ERR-AAAA-BBBB-CCCC-0002'], iso: '2026-01-01T00:00:00.000Z' });
    const dispatcher = createNodeDispatcher({}, { reporter });
    const stream = failingStreamRoute(dispatcher);
    const response = await fetch(`${await serve(dispatcher)}/stream`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('part');
    stream.fail();
    await expect(reader.read()).rejects.toThrow();
    // The record is written synchronously before the cut, so by the time the client sees the reset every record is in.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain('Write response');
    expect(reports.map((report) => report.context.incidentId)).toEqual([ID]);
  });

  it('node bridge without a reporter keeps 12-hex refs', async () => {
    const references: string[] = [];
    const dispatcher = createNodeDispatcher({}, { onUnhandledError: ({ reference }) => { references.push(reference); } });
    boomRoutes(dispatcher);
    const response = await fetch(`${await serve(dispatcher)}/boom`);
    const text = await response.text();
    expect(references).toHaveLength(1);
    expect(references[0]).toMatch(/^[0-9a-f]{12}$/);
    expect(text).toContain(`Reference: ${references[0]}.`);
  });
});
