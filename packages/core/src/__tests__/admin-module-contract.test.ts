import { describe, expect, it } from 'vitest';
import { adminPort, defineAdminModule } from '../contracts/admin-module.js';

describe('admin-module contract', () => {
  it('adminPort builds a frozen core token with version 1 by default', () => {
    const port = adminPort({ id: 'x' });
    expect(port).toEqual({ id: 'x', version: 1, cardinality: 'one' });
    expect(Object.isFrozen(port)).toBe(true);
  });

  it('adminPort honours an explicit version', () => {
    expect(adminPort({ id: 'x' }, { version: 3 }).version).toBe(3);
  });

  it('defineAdminModule returns the same object, frozen', () => {
    const module = { id: 'm', pages: {} };
    const defined = defineAdminModule(module);
    expect(defined).toBe(module);
    expect(Object.isFrozen(defined)).toBe(true);
  });
});
