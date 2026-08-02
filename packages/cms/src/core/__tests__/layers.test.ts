import { describe, expect, it } from 'vitest';

import { CMS_CORE_LAYER } from '../index.js';
import { CMS_SERVER_LAYER } from '../../server/index.js';

/**
 * These assertions are trivial on purpose. What they actually prove is not the value of two string
 * constants but that the package's wiring works end to end before any real code depends on it:
 * both entry points resolve, `tsconfig`'s `rootDir`/`outDir` produce the paths `package.json`'s
 * `exports` map claims, and vitest picks up tests from this layout.
 *
 * A placeholder package with no test at all would report a passing suite while proving none of
 * that, and the first real port commit would be the one to discover the build was misconfigured.
 *
 * Replace these with real tests as modules land; do not keep them as filler.
 */
describe('@jini-ai/cms package wiring', () => {
  it('resolves the core layer entry point', () => {
    expect(CMS_CORE_LAYER).toBe('core');
  });

  it('resolves the server layer entry point', () => {
    expect(CMS_SERVER_LAYER).toBe('server');
  });
});
