import type { FormsCatalogPort } from '../../../core/ports/forms-catalog.js';
import { catalogFieldKinds, catalogMaxFileBytes, catalogSafeFileTypes } from './catalog-fixture.js';

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** A `FormsCatalogPort` built from the recorded fixture data; override any member to prove the port is the authority. */
export function fakeFormsCatalog(overrides: Partial<FormsCatalogPort> = {}): FormsCatalogPort {
  return {
    fieldKinds: catalogFieldKinds,
    maxFileBytes: catalogMaxFileBytes,
    safeFileTypes: catalogSafeFileTypes,
    // The browser's own rule: the pattern must compile in `v` mode.
    isBrowserSafePattern: ({ pattern }) => { try { new RegExp(`^(?:${pattern})$`, 'v'); return true; } catch { return false; } },
    escapeHtml: ({ value }) => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!),
    ...overrides,
  };
}
