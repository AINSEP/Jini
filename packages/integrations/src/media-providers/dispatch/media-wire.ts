/**
 * The generic wire helpers lent to a media provider plugin at initialize (`MediaWirePort`). Each entry
 * wraps a helper this package already owns for its built-in vendors, so a plugin's request building,
 * response parsing and safe download behave exactly like a built-in's without the plugin importing
 * dispatch. Nothing here knows a vendor.
 */
import type { MediaWirePort } from '@jini-ai/core/contracts/site/media-provider-contribution';
import {
  buildOpenAIImageUrl, bytesFromOpenAICompatibleData, jsonPostInit, parseOpenAICompatibleJson, sniffImageExt, standardImageAspectFor,
} from './openai-compatible.js';
import { createRawBytesParser } from './response-parsers.js';
import type { RenderContext } from './types.js';
import { requireApiKey } from './vendor-adapter.js';

/**
 * Builds the port a host passes as `context.mediaWire` when it initializes a `media` provider.
 * @returns A stateless port; reads no environment and holds no connection.
 * @complexity O(1) time and space.
 */
export function createMediaWire(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): MediaWirePort {
  return {
    requireApiKey,
    imageAspectFor: standardImageAspectFor,
    imageGenerationUrl: ({ baseUrl }) => buildOpenAIImageUrl({ baseUrl, isAzure: false }),
    jsonPostInit,
    parseJson: parseOpenAICompatibleJson,
    // The adapter's context IS the dispatch `RenderContext`, which carries the guarded outbound client a URL download needs.
    imageBytesFromData: ({ data, providerTag, ctx }) => bytesFromOpenAICompatibleData({ data, providerTag }, ctx as RenderContext),
    sniffImageExt: ({ bytes }) => sniffImageExt(bytes),
    createRawBytesParser: (options) => createRawBytesParser(options) as never,
  };
}
