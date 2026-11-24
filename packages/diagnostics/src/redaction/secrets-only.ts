// Compatibility path; the shared implementation lives in core.
export * from '../core/secrets-only.js';
// Text scanner built on the same vendor catalog, so a scan and a redaction can never disagree.
export * from './secret-scan.js';
