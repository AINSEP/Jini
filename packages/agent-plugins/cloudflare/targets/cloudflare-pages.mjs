import { createTarget, previewTarget, validateConfig, verifyCredential } from '../lib/target.mjs';
import { uploadPages } from '../lib/pages-upload.mjs';

export const CLOUDFLARE_PAGES_TARGET_ID = 'cloudflare-pages';

export default {
  destinationConfig: ({ providerMetadata }, _options = {}) => typeof providerMetadata?.resourceName === 'string' ? { resourceName: providerMetadata.resourceName } : {},
  validateConfig,
  verifyCredential,
  preview: (input, options = {}) => previewTarget({ ...input, targetId: CLOUDFLARE_PAGES_TARGET_ID }, options),
  create: (context, options = {}) => createTarget({ ...context, targetId: CLOUDFLARE_PAGES_TARGET_ID, upload: uploadPages }, options),
};
