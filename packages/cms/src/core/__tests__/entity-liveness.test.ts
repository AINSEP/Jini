import { describe, expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';

import { assertEntityLive, EntityNotLiveError } from '../entity-liveness.js';

/**
 * @file S4 (web-high fix plan, 2026-09-24) RED coverage for the generic entity-liveness guard.
 * Every domain writer this plan touches (pages, SEO, redirects, media, content-types, taxonomy)
 * calls `assertEntityLive` right after its own load and relies on these exact messages and on
 * `EntityNotLiveError instanceof ToolInputError` to reach the caller unredacted.
 */
describe('assertEntityLive', () => {
  it('throws EntityNotLiveError, an instanceof ToolInputError, for a trashed entity', () => {
    let caught: unknown;
    try {
      assertEntityLive({ entityType: 'post', entityId: 'p1', state: 'trashed' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EntityNotLiveError);
    expect(caught).toBeInstanceOf(ToolInputError);
    const err = caught as EntityNotLiveError;
    expect(err.code).toBe('ENTITY_IN_TRASH');
    expect(err.message).toBe("ENTITY_IN_TRASH: post 'p1' is in the Trash. Restore it from the Trash before changing it.");
  });

  it('throws with ENTITY_TOMBSTONED code and message for a tombstoned entity', () => {
    let caught: unknown;
    try {
      assertEntityLive({ entityType: 'content type', entityId: 'recipe', state: 'tombstoned' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EntityNotLiveError);
    const err = caught as EntityNotLiveError;
    expect(err.code).toBe('ENTITY_TOMBSTONED');
    expect(err.message).toBe("ENTITY_TOMBSTONED: content type 'recipe' was permanently deleted and can't be changed.");
  });

  it('does not throw for a live entity', () => {
    expect(() => assertEntityLive({ entityType: 'post', entityId: 'p1', state: 'live' })).not.toThrow();
  });
});
