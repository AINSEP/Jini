import { describe, expect, it } from 'vitest';
import { createSiteGuideResource } from '../site-guide-resource.js';
import { buildResourceIndex, handleResourceRead } from '../../resource-protocol.js';

describe('site guide MCP resource uses the existing authorization gateway', () => {
  it('delegates a read-only overview with host-bound run identity and caller auth', async () => {
    const requests: { url: string; body: unknown; auth: string | null }[] = [];
    const output = { topics: [{ id: 'forms' }], facts: { forms: { status: 'ok', data: { fieldTypes: ['text'] } } } };
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ result: { status: 'completed', output } }), { headers: { 'Content-Type': 'application/json' } });
    };
    const resource = createSiteGuideResource({ runId: 'host-run' }, { generateToolUseId: () => 'read-1' });
    const result = await handleResourceRead({ uri: resource.uri, resources: buildResourceIndex({ resources: [resource] }), ctx: { baseUrl: 'http://127.0.0.1:3000', fetchImpl, authHeaders: { Authorization: 'Bearer test-only-placeholder' } } });
    expect(requests).toEqual([{ url: 'http://127.0.0.1:3000/api/delegated-tool-calls', body: { runId: 'host-run', toolUseId: 'read-1', toolId: 'site_guide', input: { operation: 'overview' }, requireReadOnly: true }, auth: 'Bearer test-only-placeholder' }]);
    expect(result.contents).toEqual([{ uri: 'jini://site-guide', mimeType: 'application/json', text: JSON.stringify(output, null, 2) }]);
  });
  it('propagates an authorization rejection instead of attaching an empty overview', async () => {
    const resource = createSiteGuideResource({ runId: 'host-run' });
    // MOVE: HTTP diagnostics now expose the status without repeating the daemon endpoint.
    await expect(resource.read({ ctx: { baseUrl: 'http://127.0.0.1:3000', fetchImpl: async () => new Response('Forbidden', { status: 403 }) } })).rejects.toThrow('HTTP 403');
  });
  it('refuses a noncompleted envelope and never returns arbitrary failure output', async () => {
    const resource = createSiteGuideResource({ runId: 'host-run' });
    await expect(resource.read({ ctx: { baseUrl: 'http://127.0.0.1:3000', fetchImpl: async () => new Response(JSON.stringify({ result: { status: 'failed', output: 'PRIVATE_CANARY' } })) } })).rejects.toThrow('site_guide resource read did not complete. Use the delegated tool result to inspect authorization or availability.');
  });
  // Stryker L3 (2026-10-25): each clause of the envelope check survived alone. One broken clause per case.
  it.each([
    ['a completed envelope without output', { status: 'completed' }],
    ['output without a status', { output: { a: 1 } }],
    ['a non-completed status with output', { status: 'pending', output: { a: 1 } }],
    ['a null result', null],
    ['a string result', 'completed'],
  ])('refuses %s with the specific message', async (_label, result) => {
    const resource = createSiteGuideResource({ runId: 'host-run' });
    await expect(resource.read({ ctx: { baseUrl: 'http://127.0.0.1:3000', fetchImpl: async () => new Response(JSON.stringify({ result })) } }))
      .rejects.toThrow('site_guide resource read did not complete. Use the delegated tool result to inspect authorization or availability.');
  });
  it('returns the completed output as pretty JSON, and declares its descriptor', async () => {
    const resource = createSiteGuideResource({ runId: 'host-run' });
    const out = await resource.read({ ctx: { baseUrl: 'http://127.0.0.1:3000', fetchImpl: async () => new Response(JSON.stringify({ result: { status: 'completed', output: { a: [1] } } })) } });
    expect(out).toEqual({ text: '{\n  "a": [\n    1\n  ]\n}' });
    expect({ uri: resource.uri, name: resource.name, mimeType: resource.mimeType }).toEqual({ uri: 'jini://site-guide', name: 'How this site works', mimeType: 'application/json' });
  });
});
