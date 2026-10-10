import { describe, expect, it } from 'vitest';
import { omitEnvironmentKeys } from '../child-environment.js';

describe('omitEnvironmentKeys', () => {
  it('omits scoped overrides without changing the parent or reporting their values', () => {
    const parent = Object.freeze({ PATH: '/bin', STORE: '/private/value', SKILLS: '', OTHER: 'keep' });
    const result = omitEnvironmentKeys({ env: parent, keys: ['STORE', 'SKILLS', 'ABSENT'] });
    expect(result).toEqual({ env: { PATH: '/bin', OTHER: 'keep' }, omitted: ['STORE', 'SKILLS'] });
    expect(parent.STORE).toBe('/private/value');
  });

  it('removes every Windows case variant and reports a key only once', () => {
    expect(omitEnvironmentKeys({ env: { store: 'one', STORE: 'two', Store: 'three', PATH: '/bin' },
      keys: ['STORE', 'STORE'] }, { caseInsensitive: true })).toEqual({ env: { PATH: '/bin' }, omitted: ['STORE'] });
  });

  it('keeps distinct POSIX names and ignores unset keys', () => {
    expect(omitEnvironmentKeys({ env: { store: 'keep', STORE: undefined }, keys: ['STORE'] })).toEqual({
      env: { store: 'keep' }, omitted: [],
    });
  });
});
