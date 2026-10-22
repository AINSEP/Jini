/**
 * Guards the `./db/core` public surface. The export map promises this subpath resolves and
 * carries these names; a rename inside the package that forgot the barrel would break every
 * consumer while every other test in this package still passed.
 */
import { describe, expect, it } from 'vitest';

import * as core from '../../core/index.js';

describe('@jini-ai/infra/db/core barrel', () => {
  it('exports exactly the runtime surface it promises', () => {
    expect(Object.keys(core).sort()).toEqual(['PGLITE_SOCKET_FILE', 'PG_OID', 'PG_PARSERS', 'parseInt8', 'parseJsonOrUndef', 'restorePointFilename', 'row', 'rows', 'sanitizeForFilename']);
  });

  it('re-exports working implementations, not just names', () => {
    expect(core.sanitizeForFilename({ value: 'a/b' })).toBe('a_b');
    expect(core.restorePointFilename({ scopeId: 'x', watermarkAtCapture: 1, timestamp: 2 })).toBe(
      'restore-point-x-wm1-2.db',
    );
  });
});
