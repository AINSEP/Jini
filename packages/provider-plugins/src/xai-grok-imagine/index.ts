/** Setup registers the media contribution factory; the host owns selection, credentials and activation. */
import type { MediaWirePort } from '@jini-ai/core/contracts/site/media-provider-contribution';
import type { PluginSdk } from '@jini-ai/core/contracts/plugin-sdk';
import { createXaiMediaContribution } from './media.js';

const WIRE_METHODS = [
  'requireApiKey', 'imageAspectFor', 'imageGenerationUrl', 'jsonPostInit', 'parseJson', 'imageBytesFromData', 'sniffImageExt', 'createRawBytesParser',
] as const;

/** A host registered the media contract without the wire helpers the provider needs. Plain words; `details` is what Copy details shows. */
export class XaiMediaConfigError extends Error {
  readonly code = 'xai_grok_imagine_context_missing' as const;
  readonly details: string;
  constructor(required: { details: string }, _optional: Record<string, never> = {}) {
    super('The xAI media provider was started without the media helpers it needs, so it cannot generate media. Restart the app; if this keeps happening, copy the details into a bug report.');
    this.name = 'XaiMediaConfigError';
    this.details = required.details;
  }
}

/** Reads the wire helpers the host put in `optional.context.mediaWire`, at initialize and never at first use. */
function readMediaWire({ context }: { context: unknown }, _optional: Record<string, never> = {}): MediaWirePort {
  const record = context !== null && typeof context === 'object' ? context as Record<string, unknown> : {};
  const wire = record.mediaWire !== null && typeof record.mediaWire === 'object' ? record.mediaWire as Record<string, unknown> : {};
  const missing = WIRE_METHODS.filter(name => typeof wire[name] !== 'function');
  if (missing.length > 0) throw new XaiMediaConfigError({ details: `optional.context.mediaWire is missing: ${missing.join(', ')}` });
  return wire as unknown as MediaWirePort;
}

/**
 * Builds a stateless media contribution. Credentials are resolved by the host per call, never read here.
 * @param _required Host initialization input; unused.
 * @param optional `context.mediaWire`: the host's generic wire helpers.
 * @returns The contribution as `port` and a no-op disposer; opens no connections.
 * @throws XaiMediaConfigError at initialize when a helper is absent.
 * @complexity O(1) time and space; no I/O.
 */
export function createXaiMediaProvider(_required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  return { port: createXaiMediaContribution({ mediaWire: readMediaWire({ context: optional.context }) }), dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => {} };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      // The shared provider-id grammar forbids hyphens, so the registered id is the media registry key (`-` -> `_`) of the public id.
      sdk.providers.register({ contract: 'media', id: 'xai_grok_imagine', contractVersion: 1, factory: createXaiMediaProvider });
    },
  },
};
