import { validateManifest as validate, type ValidateManifestRequired } from '../../manifest.js';
import { manifestHost } from './fixture-bindings.js';
export * from '../../manifest.js';
export function validateManifest(required: Omit<ValidateManifestRequired, keyof typeof manifestHost>, optional = {}) {
  return validate({ ...manifestHost, ...required }, optional);
}
