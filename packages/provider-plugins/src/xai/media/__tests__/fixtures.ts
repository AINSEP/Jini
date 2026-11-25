import type { HttpClientPort } from '@jini-ai/core/primitives';
import {
  buildOpenAIImageUrl, bytesFromOpenAICompatibleData, catalogMediaProviderContribution, createRawBytesParser, dispatchVendorRequest,
  jsonPostInit, parseOpenAICompatibleJson, requireApiKey, sniffImageExt, standardImageAspectFor,
} from '@jini-ai/integrations/media-providers';
import type { MediaProviderContribution, RenderContext } from '@jini-ai/integrations/media-providers';
import type { XaiMediaKit } from '../kit.js';

/** A trusted-port double: the wire request goes to `fetchImpl`, bypassing DNS and sockets (tests never dial out). */
export function testHttpClient(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): HttpClientPort {
  return { send: async ({ request }, optional = {}) => {
    const response = await fetchImpl(request.url, {
      method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body as BodyInit }),
      signal: request.signal ?? AbortSignal.timeout(request.totalDeadlineMs ?? request.timeoutMs ?? request.idleTimeoutMs!),
      redirect: optional.redirect ?? 'error',
    });
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()),
      bodyText: Buffer.from(bodyBytes).toString('utf8'), bodyBytes };
  } };
}

/** The dispatch kit the host composition injects, built from the real `@jini-ai/integrations/media-providers` exports. */
export const realKit: XaiMediaKit<RenderContext, MediaProviderContribution> = {
  requireApiKey, createRawBytesParser, jsonPostInit, buildOpenAIImageUrl, parseOpenAICompatibleJson,
  bytesFromOpenAICompatibleData, sniffImageExt, standardImageAspectFor, dispatchVendorRequest, catalogMediaProviderContribution,
};
