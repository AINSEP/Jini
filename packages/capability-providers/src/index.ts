/**
 * @jini-ai/capability-providers supplies independently bindable auth/storage/payment/db/realtime
 * ports and tokens, with no current consumer commitment. Avoid an optional-method umbrella bag:
 * a consumer should see only the capabilities it binds. One adapter can implement several ports
 * and bind to several tokens at the composition site.
 * @jini-ai/core's bindings already own registration; this package must not create a second registry.
 * Concrete implementations are separate entries. unsafe-reference stubs prove the interfaces are
 * implementable, with non-cryptographic/non-production behavior; never infer production guarantees
 * from them. See that entry's index header for its specific limitations.
 */
export * from './auth.js';
export * from './storage.js';
export * from './payments.js';
export * from './db.js';
export * from './realtime.js';
export * from './tokens.js';
