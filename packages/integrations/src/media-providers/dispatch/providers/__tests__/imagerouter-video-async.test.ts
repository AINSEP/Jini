import { testHttpClient } from '../../__tests__/outbound-fixtures.js';
import { partitionArgs } from '../../../../args.js';
import { describe, expect, it, vi } from 'vitest';

import { createImageRouterVideoPollingAdapter } from '../imagerouter-video-async.js';
import { createInMemoryAsyncOperationStore } from '../../async-operation-store.js';
import { createBearerSigner } from '../../polling-adapter.js';
import { pollDueOperations, startOperation } from '../../operation-runtime.js';
import type { RenderContext } from '../../types.js';

const CTX: RenderContext = {
  surface: 'video', model: 'veo-3', wireModel: 'veo-3', prompt: 'a cat', aspect: '16:9',
  length: 5, duration: undefined, voice: '', audioKind: undefined, language: 'en', loop: false,
  promptInfluence: undefined, imageRef: null, imageRefs: [], requestInit: {}, speechFormat: 'mp3',
};

const signer = createBearerSigner({ resolve: () => ({ apiKey: 'sk-ir' }), missingCredentialMessage: 'no key' });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createImageRouterVideoPollingAdapter', () => {
    it('builds a submit request carrying no credential of any kind', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const request = adapter.buildSubmitRequest({ ctx: CTX });
        expect(request.url).toBe('https://api.imagerouter.io/v1/openai/videos/generations');
        expect(JSON.stringify(request.init)).not.toContain('sk-ir');
        expect((request.init.headers as Record<string, string>).authorization).toBeUndefined();
        expect(JSON.parse(request.init.body as string)).toMatchObject({ model: 'veo-3', size: '1024x576', seconds: 5 });
    });
    it('takes endpoint config as a plain data object, so it can be sourced from a row', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({ baseUrl: 'https://proxy.test/v1', wireModel: 'sora-2' }, []));
        const request = adapter.buildSubmitRequest({ ctx: CTX });
        expect(request.url).toBe('https://proxy.test/v1/videos/generations');
        expect(JSON.parse(request.init.body as string).model).toBe('sora-2');
    });
    it('completes inline when the vendor returns bytes on the submit itself (today behaviour, preserved)', async () => {
        const store = createInMemoryAsyncOperationStore();
        const fetchImpl = vi.fn(async () => json({ data: [{ b64_json: Buffer.from('MP4BYTES').toString('base64') }] }));
        const outcome = await startOperation(...partitionArgs({ ...{ store, signer, httpClient: testHttpClient(fetchImpl) }, ...{
        adapter: createImageRouterVideoPollingAdapter(...partitionArgs({}, [])), ctx: CTX, providerId: 'imagerouter',
        routeKey: 'video', ownerRef: 'run-1', graceMs: 1000,
    } }, ["store", "signer", "adapter", "ctx", "providerId", "routeKey", "ownerRef"]));
        expect(outcome.done).toBe(true);
        expect(outcome.done && outcome.result.bytes.toString()).toBe('MP4BYTES');
        expect(outcome.done && outcome.result.suggestedExt).toBe('.mp4');
    });
    it('moves to polling when the vendor returns a job handle, then completes on a later tick', async () => {
        const store = createInMemoryAsyncOperationStore();
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith('/videos/generations'))
                return json({ id: 'vid_1', status: 'queued' });
            return json({ id: 'vid_1', status: 'completed', data: [{ b64_json: Buffer.from('LATER').toString('base64') }] });
        });
        const outcome = await startOperation(...partitionArgs({ ...{ store, signer, httpClient: testHttpClient(fetchImpl) }, ...{ adapter, ctx: CTX, providerId: 'imagerouter', routeKey: 'video', ownerRef: 'run-1', graceMs: 1000 } }, ["store", "signer", "adapter", "ctx", "providerId", "routeKey", "ownerRef"]));
        expect(outcome.done).toBe(false);
        expect((await store.get({ id: outcome.operationId }))?.state).toEqual({ jobId: 'vid_1' });
        await store.update({ id: outcome.operationId, patch: { nextPollAt: 0 } });
        const stats = await pollDueOperations(...partitionArgs({ ...{ store, signer, httpClient: testHttpClient(fetchImpl) }, ...{ adapters: () => adapter, resolveContext: () => CTX, leaseOwner: 'w1', leaseMs: 1000 } }, ["store", "signer", "adapters", "resolveContext", "leaseOwner", "leaseMs"]));
        const row = await store.get({ id: outcome.operationId });
        expect(stats.completed).toBe(1);
        expect(Buffer.from(row!.result!.bytesBase64, 'base64').toString()).toBe('LATER');
    });
    it('polls the job-scoped URL, and never persists the bearer token alongside the handle', async () => {
        const store = createInMemoryAsyncOperationStore();
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const urls: string[] = [];
        const fetchImpl = vi.fn(async (url: string) => {
            urls.push(url);
            if (url.endsWith('/videos/generations'))
                return json({ id: 'vid_9', status: 'queued' });
            return json({ id: 'vid_9', status: 'in_progress' });
        });
        const outcome = await startOperation(...partitionArgs({ ...{ store, signer, httpClient: testHttpClient(fetchImpl) }, ...{ adapter, ctx: CTX, providerId: 'imagerouter', routeKey: 'video', ownerRef: 'run-1', graceMs: 1000 } }, ["store", "signer", "adapter", "ctx", "providerId", "routeKey", "ownerRef"]));
        await store.update({ id: outcome.operationId, patch: { nextPollAt: 0 } });
        await pollDueOperations(...partitionArgs({ ...{ store, signer, httpClient: testHttpClient(fetchImpl) }, ...{ adapters: () => adapter, resolveContext: () => CTX, leaseOwner: 'w1', leaseMs: 1000 } }, ["store", "signer", "adapters", "resolveContext", "leaseOwner", "leaseMs"]));
        expect(urls[1]).toBe('https://api.imagerouter.io/v1/openai/videos/vid_9');
        expect(JSON.stringify(await store.get({ id: outcome.operationId }))).not.toContain('sk-ir');
    });
    it('surfaces a vendor-reported job failure with the vendor tag and message', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const outcome = await adapter.parsePollResponse({ resp: json({ id: 'v', status: 'failed', error: { message: 'content policy' } }), ctx: CTX, state: { jobId: 'v' } });
        expect(outcome).toEqual({ kind: 'failed', message: 'imagerouter video job failed: content policy' });
    });
    it('rejects a submit response that is neither bytes nor a job handle', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        await expect(adapter.parseSubmitResponse({ resp: json({ nonsense: true }), ctx: CTX, request: adapter.buildSubmitRequest({ ctx: CTX }) })).rejects.toThrow('imagerouter video submit returned neither generated data nor a job id');
    });
    it('rejects a submit job id that is an empty string', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        await expect(adapter.parseSubmitResponse({ resp: json({ id: '' }), ctx: CTX, request: adapter.buildSubmitRequest({ ctx: CTX }) })).rejects.toThrow('imagerouter video submit returned neither generated data nor a job id');
    });
    it('carries a numeric Retry-After (seconds) from the submit response as retryAfterMs', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const resp = new Response(JSON.stringify({ id: 'vid_2' }), { status: 200, headers: { 'content-type': 'application/json', 'retry-after': '7' } });
        expect(await adapter.parseSubmitResponse({ resp, ctx: CTX, request: adapter.buildSubmitRequest({ ctx: CTX }) })).toEqual({ kind: 'pending', state: { jobId: 'vid_2' }, retryAfterMs: 7000 });
    });
    it('ignores a non-numeric Retry-After header', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const resp = new Response(JSON.stringify({ status: 'queued' }), { status: 200, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });
        expect(await adapter.parsePollResponse({ resp, ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'pending' });
    });
    it('ignores a zero Retry-After header', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const resp = new Response(JSON.stringify({ status: 'queued' }), { status: 200, headers: { 'retry-after': '0' } });
        expect(await adapter.parsePollResponse({ resp, ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'pending' });
    });
    it('carries a numeric Retry-After from a pending poll response', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const resp = new Response(JSON.stringify({ status: 'in_progress' }), { status: 200, headers: { 'retry-after': '2.5' } });
        expect(await adapter.parsePollResponse({ resp, ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'pending', retryAfterMs: 2500 });
    });
    it('treats a missing status as still pending', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(await adapter.parsePollResponse({ resp: json({ id: 'v', status: 42 }), ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'pending' });
    });
    it('keeps polling a "completed" job that carries no data (reported, not fixed)', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(await adapter.parsePollResponse({ resp: json({ id: 'v', status: 'completed' }), ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'pending' });
    });
    it('matches terminal failure statuses case-insensitively and falls back to the status as the detail', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(await adapter.parsePollResponse({ resp: json({ status: 'CANCELLED', error: { message: '' } }), ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'failed', message: 'imagerouter video job failed: cancelled' });
    });
    it('uses the status as the failure detail when the error message is not a string', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(await adapter.parsePollResponse({ resp: json({ status: 'error', error: { message: 500 } }), ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'failed', message: 'imagerouter video job failed: error' });
    });
    it('reports a failure even when the failed response also carries data', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const data = [{ b64_json: Buffer.from('X').toString('base64') }];
        expect(await adapter.parsePollResponse({ resp: json({ status: 'failed', data }), ctx: CTX, state: { jobId: 'v' } })).toEqual({ kind: 'failed', message: 'imagerouter video job failed: failed' });
    });
    it('completes a poll with data, noting the configured wire model, size and "auto" seconds', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({ wireModel: ' sora-2 ' }, []));
        const outcome = await adapter.parsePollResponse({ resp: json({ data: [{ b64_json: Buffer.from('VID').toString('base64') }] }), ctx: { ...CTX, length: undefined }, state: { jobId: 'v' } });
        expect(outcome).toEqual({ kind: 'complete', result: { bytes: Buffer.from('VID'), providerNote: 'imagerouter/sora-2 · 1024x576 · auto · 3 bytes', suggestedExt: '.mp4' } });
    });
    it('notes the submit request meta (seconds) when completing inline on submit', async () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const outcome = await adapter.parseSubmitResponse({ resp: json({ data: [{ b64_json: Buffer.from('AB').toString('base64') }] }), ctx: CTX, request: adapter.buildSubmitRequest({ ctx: CTX }) });
        expect(outcome).toEqual({ kind: 'complete', result: { bytes: Buffer.from('AB'), providerNote: 'imagerouter/veo-3 · 1024x576 · 5s · 2 bytes', suggestedExt: '.mp4' } });
    });
    it('builds the poll request against the URL-encoded job id with the context-derived meta', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({ baseUrl: ' https://proxy.test/v1// ' }, []));
        const request = adapter.buildPollRequest({ state: { jobId: 'a/b?c' }, ctx: { ...CTX, length: undefined } });
        expect(request.url).toBe('https://proxy.test/v1/videos/a%2Fb%3Fc');
        expect(request.init).toEqual({ method: 'GET', headers: { accept: 'application/json' } });
        expect(request.meta).toEqual({ wireModel: 'veo-3', size: '1024x576', seconds: 'auto' });
    });
    it('refuses to build a poll request without a persisted string jobId', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(() => adapter.buildPollRequest({ state: { jobId: 7 }, ctx: CTX })).toThrow('imagerouter video poll requires a persisted jobId');
    });
    it('refuses to build a poll request for an empty jobId', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        expect(() => adapter.buildPollRequest({ state: { jobId: '' }, ctx: CTX })).toThrow('imagerouter video poll requires a persisted jobId');
    });
    it('defaults the submit prompt and seconds when the context leaves them unset', () => {
        const adapter = createImageRouterVideoPollingAdapter(...partitionArgs({}, []));
        const request = adapter.buildSubmitRequest({ ctx: { ...CTX, prompt: '', length: undefined } });
        expect(JSON.parse(request.init.body as string)).toEqual({ prompt: 'A short cinematic clip.', model: 'veo-3', size: '1024x576', seconds: 'auto', response_format: 'b64_json' });
        expect(request.meta).toEqual({ wireModel: 'veo-3', size: '1024x576', seconds: 'auto' });
    });
    it('does not declare its submit idempotent — a duplicate submit is a duplicate charge', () => {
        expect(createImageRouterVideoPollingAdapter(...partitionArgs({}, [])).submitIsIdempotent).toBe(false);
    });
});
