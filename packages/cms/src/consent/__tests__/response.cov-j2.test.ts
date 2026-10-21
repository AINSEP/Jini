import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { captureConsentHtml } from '../express/response.js';

/** Same hand-written response double as response.test.ts, with the native write's backpressure
 * result made configurable. */
function fakeResponse({ type, writeResult = true }: { type: string; writeResult?: boolean }) {
  const headers = new Map<string, unknown>([['content-type', type]]);
  const calls: unknown[][] = [];
  const response = {
    statusCode: 200, statusMessage: '', destroyed: false, emit: vi.fn(() => true),
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: unknown) => { headers.set(name.toLowerCase(), value); return response; },
    removeHeader: (name: string) => { headers.delete(name.toLowerCase()); },
    write(...args: unknown[]) { calls.push(['write', ...args]); return writeResult; },
    end(...args: unknown[]) { calls.push(['end', ...args]); return response; },
    writeHead(...args: unknown[]) { calls.push(['writeHead', ...args]); return response; },
    flushHeaders() { calls.push(['flushHeaders']); },
  };
  return { response: response as unknown as Response & { destroyed: boolean; emit: ReturnType<typeof vi.fn> }, headers, calls };
}
const inertText = 'This page could not be delivered with cookie preferences enforced. Please try again or contact the site owner.';
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const upper = async ({ body }: { body: Buffer }) => Buffer.from(body.toString('utf8').toUpperCase());

describe('captureConsentHtml overflow policy edges', () => {
  it('a throwing overflow policy is reported and the page completes as inert text under the blocking CSP', async () => {
    const { response, headers, calls } = fakeResponse({ type: 'text/html' });
    const reported: unknown[] = [];
    const policyError = new Error('policy store down');
    captureConsentHtml({ response, transform: upper }, { maxBytes: 10, overflow: async () => { throw policyError; }, reportError: ({ error }) => { reported.push(error); } });

    response.write('<p>more than ten bytes</p>');
    response.end('<p>tail</p>');
    await settle();

    expect(reported).toEqual([policyError]);
    expect(calls).toEqual([['end', Buffer.from(inertText), undefined]]);
    expect(headers.get('content-security-policy')).toContain("script-src 'none'");
  });

  it('a response destroyed before the overflow decision gets no write, callback or drain', async () => {
    const { response, calls } = fakeResponse({ type: 'text/html' });
    let decide!: (body: Buffer | null) => void;
    captureConsentHtml({ response, transform: upper }, { maxBytes: 10, overflow: () => new Promise(resolve => { decide = resolve; }) });
    const written = vi.fn();

    expect(response.write('<p>more than ten bytes</p>', written)).toBe(false);
    response.destroyed = true;
    decide(null);
    await settle();

    expect(calls).toEqual([]);
    expect(written).not.toHaveBeenCalled();
    expect(response.emit).not.toHaveBeenCalled();
  });

  it('under a disabled policy, native backpressure on the flushed prefix leaves drain to the native stream', async () => {
    const { response, calls } = fakeResponse({ type: 'text/html', writeResult: false });
    captureConsentHtml({ response, transform: upper }, { maxBytes: 10, overflow: async () => null });

    expect(response.write('<p>more than ten bytes</p>')).toBe(false);
    await settle();

    expect(calls).toEqual([['write', Buffer.from('<p>more than ten bytes</p>'), undefined]]);
    expect(response.emit).not.toHaveBeenCalled();
  });

  it('under a disabled policy with an accepted write, a synthetic drain resumes the paused producer', async () => {
    const { response, calls } = fakeResponse({ type: 'text/html' });
    captureConsentHtml({ response, transform: upper }, { maxBytes: 10, overflow: async () => null });

    expect(response.write('<p>more than ten bytes</p>')).toBe(false);
    await settle();

    expect(calls).toEqual([['write', Buffer.from('<p>more than ten bytes</p>'), undefined]]);
    expect(response.emit).toHaveBeenCalledWith('drain');
  });
});
