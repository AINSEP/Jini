/** Compatibility root: preserve existing imports by re-exporting core. Prefer the explicit
 * @jini-ai/agentic/core entry for new code. DOM-free policy is compiled without browser globals;
 * only core/dom owns the PageDriver that touches a live page. See core/README.md for the split. */
export * from './core/index.js';
