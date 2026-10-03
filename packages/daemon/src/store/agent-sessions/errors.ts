/** Stable boundary failure with the original driver failure retained as a cause. */
export class AgentSessionStoreError extends Error {
 readonly code: 'invalid-input'|'unavailable';
  constructor({ code }: { readonly code: 'invalid-input'|'unavailable' }, options: ErrorOptions = {}) {
  super(code==='invalid-input'?'invalid agent session kernel':'agent session store unavailable',options);
    this.code = code;
  this.name='AgentSessionStoreError';
 }
}
