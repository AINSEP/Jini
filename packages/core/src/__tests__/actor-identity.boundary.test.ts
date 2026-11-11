import { describe, expect, it } from 'vitest';
import { WorkspaceMismatchError, appendActorReference } from '../gated-mutations/actor-identity.js';

/** L2 §4 actor-identity: each workspace clause refuses on its own; absent delegation becomes null. */
const required = { referencingRowWorkspaceId: 'w', actorWorkspaceId: 'w', actorId: 'a' };
describe('appendActorReference', () => {
  it('fills null delegation when omitted or null, and keeps a same-workspace delegator', () => {
    expect(appendActorReference(required)).toStrictEqual({ actorWorkspaceId: 'w', actorId: 'a', delegatedByWorkspaceId: null, delegatedById: null });
    expect(appendActorReference(required, { delegatedByWorkspaceId: null, delegatedById: null })).toStrictEqual({ actorWorkspaceId: 'w', actorId: 'a', delegatedByWorkspaceId: null, delegatedById: null });
    expect(appendActorReference(required, { delegatedByWorkspaceId: 'w', delegatedById: 'u' })).toStrictEqual({ actorWorkspaceId: 'w', actorId: 'a', delegatedByWorkspaceId: 'w', delegatedById: 'u' });
  });
  it('refuses an actor from another workspace', () => {
    expect(() => appendActorReference({ ...required, actorWorkspaceId: 'x' })).toThrow(new WorkspaceMismatchError({ message: "actor workspace 'x' does not match referencing row workspace 'w'" }));
  });
  it('refuses a delegator from another workspace, even an empty-string one', () => {
    for (const delegatedByWorkspaceId of ['x', '']) {
      expect(() => appendActorReference(required, { delegatedByWorkspaceId, delegatedById: 'u' })).toThrow(WorkspaceMismatchError);
    }
    // UPDATED (6cb5190b8): a delegator workspace without a delegator id is now refused by the pairing
    // check first, so the mismatch message is pinned with a complete delegator pair.
    expect(() => appendActorReference(required, { delegatedByWorkspaceId: 'x' })).toThrow('delegator workspace and id must be provided together');
    expect(() => appendActorReference(required, { delegatedByWorkspaceId: 'x', delegatedById: 'u' })).toThrow(`delegator workspace 'x' does not match referencing row workspace 'w'`);
  });
});
