import assert from "node:assert/strict";
import { test } from "vitest";

import { WorkspaceMismatchError, appendActorReference } from "../gated-mutations/actor-identity.js";

test("AC-23 / REQ-16: the populated reference carries the composite (actorWorkspaceId, actorId) pair exactly as given, for a direct (non-delegated) user action", () => {
  const ref = appendActorReference({
    referencingRowWorkspaceId: "ws-1",
    actorWorkspaceId: "ws-1",
    actorId: "user-1",
  });

  assert.equal(ref.actorWorkspaceId, "ws-1");
  assert.equal(ref.actorId, "user-1");
  assert.equal(ref.delegatedByWorkspaceId, null);
  assert.equal(ref.delegatedById, null);
});

test("AC-23 / REQ-16: an agent-delegated action additionally carries (delegatedByWorkspaceId, delegatedById) identifying the delegator", () => {
  const ref = appendActorReference({
    referencingRowWorkspaceId: "ws-1",
    actorWorkspaceId: "ws-1",
    actorId: "agent-1",
  }, {
    delegatedByWorkspaceId: "ws-1",
    delegatedById: "user-1",
  });

  assert.equal(ref.actorId, "agent-1");
  assert.equal(ref.delegatedById, "user-1");
});

test("REQ-16: an api_key action acting for its owning user carries the owning user as (delegatedByWorkspaceId, delegatedById) — symmetric with the agent case", () => {
  const ref = appendActorReference({
    referencingRowWorkspaceId: "ws-1",
    actorWorkspaceId: "ws-1",
    actorId: "api-key-1",
  }, {
    delegatedByWorkspaceId: "ws-1",
    delegatedById: "owning-user-1",
  });

  assert.equal(ref.delegatedByWorkspaceId, "ws-1");
  assert.equal(ref.delegatedById, "owning-user-1");
});

test("AC-24 / REQ-17: the returned reference is a plain value object with no DB-level FK metadata — population is a pure, side-effect-free helper", () => {
  const ref = appendActorReference({
    referencingRowWorkspaceId: "ws-1",
    actorWorkspaceId: "ws-1",
    actorId: "user-1",
  });

  assert.deepEqual(Object.keys(ref).sort(), [
    "actorId",
    "actorWorkspaceId",
    "delegatedById",
    "delegatedByWorkspaceId",
  ]);
});

test("INV-06: a composite actor-identity pair whose workspace does not match the referencing row's workspace is rejected", () => {
  assert.throws(
    () =>
      appendActorReference({
        referencingRowWorkspaceId: "ws-1",
        actorWorkspaceId: "ws-2", // mismatched
        actorId: "user-1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof WorkspaceMismatchError);
      return true;
    }
  );
});

test("INV-06: a mismatched delegator workspace is also rejected, independent of the actor's own workspace matching", () => {
  assert.throws(
    () =>
      appendActorReference({
        referencingRowWorkspaceId: "ws-1",
        actorWorkspaceId: "ws-1",
        actorId: "agent-1",
      }, {
        delegatedByWorkspaceId: "ws-2", // mismatched
        delegatedById: "user-1",
      }),
    (err: unknown) => err instanceof WorkspaceMismatchError
  );
});
