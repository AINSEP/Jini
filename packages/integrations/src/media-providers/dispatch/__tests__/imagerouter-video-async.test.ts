import { testHttpClient } from './outbound-fixtures.js';
import { partitionArgs } from '../../../args.js';
import { describe, expect, it, vi } from 'vitest';

import { createImageRouterVideoPollingAdapter } from '../providers/imagerouter-video-async.js';
import { createInMemoryAsyncOperationStore } from '../async-operation-store.js';
import { createBearerSigner } from '../polling-adapter.js';
import { pollDueOperations, startOperation } from '../operation-runtime.js';
import type { RenderContext } from '../types.js';

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
    it('does not declare its submit idempotent — a duplicate submit is a duplicate charge', () => {
        expect(createImageRouterVideoPollingAdapter(...partitionArgs({}, [])).submitIsIdempotent).toBe(false);
    });
});
