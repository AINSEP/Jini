/** Node-only stub-guard I/O. Keep it separate so importing universal types or pure decisions
 * never forces resolution of node:fs or node:path. */
export * from './stub-guard.js';
