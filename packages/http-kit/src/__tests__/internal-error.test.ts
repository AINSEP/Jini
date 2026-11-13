import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatErrorForLog } from '@jini-ai/core';
import { reportRouteInternalError } from '../internal-error.js';
import * as HttpBarrel from '../index.js';

// A host-specific token shape Jini's default policy does not know: only the host's injected
// options can redact it. Tovu's real key shape is a public prefix plus a secret run.
const HOST_SECRET = 'S'.repeat(32);
const HOST_KEY = `hostkey_0123456789ab.${HOST_SECRET}`;
const HOST_OPTIONS = { extraPatterns: [{ name: 'host_key', regex: /(?<=hostkey_[0-9a-f]{12}\.)[A-Za-z0-9_-]{20,}/g }] };
const MESSAGE = 'The run list could not be loaded. Try again; if it keeps failing, copy the request ID and report this problem.';

afterEach(() => { vi.restoreAllMocks(); });

describe('reportRouteInternalError', () => {
  it('gives the caller plain words and a request ID, and the host sink the same ID, its own fields and the original error', () => {
    const thrown = new Error(`boom ${HOST_KEY}`);
    const seen: unknown[] = [];
    const apiError = reportRouteInternalError(
      { report: { source: 'run-start', runId: 'r1', error: thrown }, logSource: 'run-start', message: MESSAGE },
      { onInternalError: context => { seen.push(context); } },
    );
    expect(apiError.code).toBe('INTERNAL_ERROR');
    expect(apiError.message).toBe(MESSAGE);
    expect(apiError.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // The host channel: the full error, the request ID the caller copies, the operation label and
    // the route's own fields (here `runId`), so the host can store one record under that ID.
    expect(seen).toEqual([{ source: 'run-start', runId: 'r1', error: thrown, correlationId: apiError.requestId, logSource: 'run-start' }]);
    expect((seen[0] as { error: unknown }).error).toBe(thrown);
    expect(JSON.stringify(apiError)).not.toContain(HOST_SECRET);
  });

  it('lets a host sink apply its own redaction policy to a bare host-shaped key', () => {
    const lines: string[] = [];
    reportRouteInternalError(
      { report: { source: 'tool-catalog', error: new Error(`boom ${HOST_KEY}`) }, logSource: 'tool-catalog', message: MESSAGE },
      { onInternalError: ({ error }) => { lines.push(formatErrorForLog({ error }, HOST_OPTIONS)); } },
    );
    expect(lines[0]).toContain('hostkey_0123456789ab.');
    expect(lines[0]).not.toContain(HOST_SECRET);
    expect(lines[0]).toContain('internal-error.test.ts');
  });

  it('logs only the error class and request ID when the host gives no sink (the message can quote input)', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const apiError = reportRouteInternalError({
      report: { source: 'tool-catalog', error: new TypeError('boom api_key=SECRETSECRETSECRETSECRET') }, logSource: 'tool-catalog', message: MESSAGE,
    });
    const line = logged.mock.calls.map(args => args.join(' ')).join('\n');
    expect(line).toBe(`[@jini-ai/http-kit] internal error (tool-catalog, correlationId=${apiError.requestId}) TypeError`);
    expect(line).not.toContain('boom');
    expect(line).not.toContain('internal-error.test.ts');
    expect(line).not.toContain('SECRETSECRET');
  });

  it('keeps the answer and logs the class of the original error and of the sink failure when the host sink throws', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const apiError = reportRouteInternalError(
      { report: { source: 'stream', error: new Error('original api_key=SECRETSECRETSECRETSECRET') }, logSource: 'frontend-sessions:stream', message: MESSAGE },
      { onInternalError: () => { throw new Error('sink down password=hunter2hunter2'); } },
    );
    expect(apiError.message).toBe(MESSAGE);
    const line = logged.mock.calls.map(args => args.join(' ')).join('\n');
    expect(line).toContain(`internal error (frontend-sessions:stream, correlationId=${apiError.requestId}) Error`);
    expect(line).toContain(`internal error sink failed (frontend-sessions:stream, correlationId=${apiError.requestId}) Error`);
    expect(line).not.toContain('original');
    expect(line).not.toContain('sink down');
    expect(line).not.toContain('SECRETSECRET');
    expect(line).not.toContain('hunter2hunter2');
  });

  it('keeps a route field named like the operation label untouched (the label has its own key)', () => {
    const seen: Record<string, unknown>[] = [];
    reportRouteInternalError(
      { report: { source: 'auth', operation: 'list', error: new Error('x') }, logSource: 'connectors/auth.list', message: MESSAGE },
      { onInternalError: context => { seen.push(context); } },
    );
    expect(seen[0]).toMatchObject({ source: 'auth', operation: 'list', logSource: 'connectors/auth.list' });
  });

  it('is part of the public barrel', () => {
    expect(HttpBarrel.reportRouteInternalError).toBe(reportRouteInternalError);
  });
});
