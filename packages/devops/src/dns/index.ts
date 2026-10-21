/**
 * `@jini-ai/devops/dns` — the generic DNS kernel: RRset contract, pure planner + fingerprint,
 * NS delegation check, authoritative propagation verification, approval binding and the built-in
 * `manual` provider. Applying changes (D4) and vendor providers live elsewhere.
 */
export * from './contract.js';
export * from './records.js';
export * from './spf.js';
export * from './plan.js';
export * from './delegation.js';
export * from './verify.js';
export * from './approval.js';
export * from './manual.js';
export * from './registry.js';
