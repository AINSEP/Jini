/** Compatibility entry; the shared implementation serves browser and server consumers. */
export * from './contracts/plugins.js';
export { consentBridgeContribution, declaredScriptsContribution, parseConsentContributions } from './contracts/consent-file.js';
