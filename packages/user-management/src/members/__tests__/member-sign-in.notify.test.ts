import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import assert from "node:assert/strict";
import { test } from "vitest";

import { notifyMemberCreated } from "../member-sign-in.js";
import type { MembersWriteServiceDeps } from "../ports.js";
import type { MemberRecord } from "../types.js";

const member = { id: "m1", workspaceId: "w1" } as MemberRecord;

test("notifyMemberCreated passes the written member's identity and creation facts to the observer", () => {
  const seen: unknown[] = [];
  const deps = { orFallbackSync, onMemberCreated: (event: unknown) => { seen.push(event); } } as unknown as MembersWriteServiceDeps;
  notifyMemberCreated({ deps, member, creationSource: "verified_signup", initialState: "active" });
  assert.deepEqual(seen, [{ workspaceId: "w1", memberId: "m1", creationSource: "verified_signup", initialState: "active" }]);
});

test("a throwing onMemberCreated observer never escapes notifyMemberCreated (analytics cannot alter a committed member)", () => {
  let calls = 0;
  const deps = { orFallbackSync, onMemberCreated: () => { calls += 1; throw new Error("analytics down"); } } as unknown as MembersWriteServiceDeps;
  assert.doesNotThrow(() => notifyMemberCreated({ deps, member, creationSource: "operator", initialState: "pending" }));
  assert.equal(calls, 1);
});

test("notifyMemberCreated is a no-op when no observer is bound", () => {
  assert.doesNotThrow(() => notifyMemberCreated({ deps: { orFallbackSync } as unknown as MembersWriteServiceDeps, member, creationSource: "oidc_signup", initialState: "active" }));
});

test("the observer runs through the injected fallback under the members.on-member-created step", () => {
  const steps: string[] = [];
  const injected: MembersWriteServiceDeps["orFallbackSync"] = ({ work, step }) => { steps.push(step); work(); };
  const deps = { orFallbackSync: injected, onMemberCreated: () => undefined } as unknown as MembersWriteServiceDeps;
  notifyMemberCreated({ deps, member, creationSource: "operator", initialState: "active" });
  assert.deepEqual(steps, ["members.on-member-created"]);
});
