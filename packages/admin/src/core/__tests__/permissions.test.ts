import { describe, expect, it } from 'vitest';
import { hasPermission } from '../permissions/rules.js';

describe('hasPermission', () => {
  it('matches an exact grant', () => {
    expect(hasPermission(['comments.read'], 'comments.read')).toBe(true);
  });

  it('rejects a permission that is not granted', () => {
    expect(hasPermission(['comments.read'], 'comments.write')).toBe(false);
  });

  it('lets the owner wildcard satisfy any permission', () => {
    // The regression this whole module exists for: a plain `.includes()` treats "*" as a
    // permission NAME and never matches it against a real one, which locked the workspace owner
    // out of every gated affordance in the admin.
    expect(hasPermission(['*'], 'comments.read')).toBe(true);
    expect(hasPermission(['*'], 'anything.at.all')).toBe(true);
  });

  it('returns false for an empty grant list', () => {
    expect(hasPermission([], 'comments.read')).toBe(false);
  });

  it('does not treat the wildcard as a prefix match', () => {
    // "*" is the whole grant or nothing; there is no "comments.*" semantics here, and inventing
    // one would diverge from the server-side evaluator.
    expect(hasPermission(['comments.*'], 'comments.read')).toBe(false);
  });
});
