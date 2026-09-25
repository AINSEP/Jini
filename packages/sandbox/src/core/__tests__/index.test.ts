/**
 * Guards the `./core` public surface. The export map promises this subpath resolves and carries
 * these names; a rename inside the package that forgot the barrel would break every consumer
 * while every other test in this package still passed. Almost everything here is types (which
 * this test cannot see — a runtime `Object.keys` check is blind to a type-only export), so this
 * only guards the one runtime export, `SandboxOperationError`. The type surface is guarded by
 * `tsc`, not by this file.
 */
import { describe, expect, it } from 'vitest';

import * as core from '../index.js';

describe('@jini-ai/sandbox/core barrel', () => {
  it('exports exactly the runtime surface it promises', () => {
    expect(Object.keys(core)).toEqual(['SandboxOperationError']);
  });

  it('re-exports a working implementation, not just the name', () => {
    const error = new core.SandboxOperationError('timeout', 'took too long');
    expect(error).toBeInstanceOf(Error);
    expect(error.category).toBe('timeout');
  });
});
