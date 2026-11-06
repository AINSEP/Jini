/** Compatibility entry; the shared implementation serves browser and server consumers. */
export * from './contracts/policy.js';

export { allows, validateScripts } from './contracts/scripts.js';
