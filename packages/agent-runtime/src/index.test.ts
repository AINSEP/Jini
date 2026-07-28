import { describe, expect, it } from 'vitest';
import * as barrel from './index.js';

/**
 * `src/index.ts` is a pure re-export barrel — no logic of its own. Importing
 * it directly is the only way to execute its own statement under coverage;
 * see `@jini-ai/chat-react`'s `src/index.test.ts` for the same convention.
 */
describe('index barrel', () => {
  it('re-exports the registry helpers', () => {
    expect(typeof barrel.resolveCredentialStatus).toBe('function');
    expect(typeof barrel.mergeModelOptions).toBe('function');
    expect(typeof barrel.fingerprintCredential).toBe('function');
    expect(typeof barrel.modelCatalogCacheKey).toBe('function');
    expect(typeof barrel.normalizeAgentModelChoice).toBe('function');
    expect(typeof barrel.effectiveAgentModelChoice).toBe('function');
  });
});
