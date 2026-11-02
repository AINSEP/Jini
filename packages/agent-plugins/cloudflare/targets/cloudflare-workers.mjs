import { createTarget, previewTarget, validateConfig, verifyCredential } from '../lib/target.mjs';
import { uploadWorker } from '../lib/workers-upload.mjs';

/** Workers serves static exports only; the host's own server stays where it runs today.
 * A site with active forms also gets the bundled submissions receiver (D1) on the same Worker; pulling
 * what it stored is form destination `cloudflare-d1` (`form-destinations/cloudflare-d1.mjs`). */
export default {
  defaultForNewDestination: true,
  // Historical worksFor:[cloudflare] meant Pages only. Adding Workers must not expand that grant.
  defaultCredentialWorksFor: ['cloudflare-workers'],
  acceptsCredential: ({ worksFor }, _options = {}) => worksFor.includes('cloudflare-workers'),
  destinationConfig: ({ providerMetadata }, _options = {}) => typeof providerMetadata?.resourceName === 'string' ? { resourceName: providerMetadata.resourceName } : {},
  validateConfig,
  verifyCredential,
  preview: (input, options = {}) => previewTarget({ ...input, targetId: 'cloudflare-workers' }, options),
  create: (context, options = {}) => createTarget({ ...context, targetId: 'cloudflare-workers', upload: uploadWorker }, options),
};
