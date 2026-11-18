import assert from "node:assert/strict";
import { test } from "vitest";
import { decideMemberLogin } from "../link-policy.js";
import type { LoginLinkMember } from "../link-policy.js";

const member: LoginLinkMember = { id: "member", status: "active" };
const identity = { providerId: "test", issuer: "https://issuer.example", subject: "subject", email: "new@example.com", emailAuthoritative: true };
const input = { identity, member, subjectLinked: false, unlinked: false };

test("linked subject keeps its member when email changes", () => {
  assert.equal(decideMemberLogin({ ...input, subjectLinked: true }), "sign_in");
});
for (const status of ["disabled", "trash"] as const) {
  test(`${status} remains blocked even with an existing subject`, () => {
    assert.equal(decideMemberLogin({ ...input, member: { ...member, status }, subjectLinked: true }), "blocked");
  });
}
test("unlink blocks auto-link, deliberate connect permits relink", () => {
  assert.equal(decideMemberLogin({ ...input, unlinked: true }), "blocked");
  assert.equal(decideMemberLogin({ ...input, unlinked: true, connectMemberId: member.id }), "link");
});
test("connect never moves an identity to another member", () => {
  assert.equal(decideMemberLogin({ ...input, subjectLinked: true, connectMemberId: "other" }), "conflict");
});
test("pending verified match links and new authoritative email creates", () => {
  assert.equal(decideMemberLogin({ ...input, member: { ...member, status: "pending" } }), "link");
  assert.equal(decideMemberLogin({ ...input, member: null }), "create");
});
test("custom-domain first link needs inbox proof, subsequent subject sign-in does not", () => {
  const custom = { ...input, identity: { ...identity, emailAuthoritative: false } };
  assert.equal(decideMemberLogin(custom), "email_verification_required");
  assert.equal(decideMemberLogin({ ...custom, member: null }), "email_verification_required");
  // A deliberate signed-in connect is not an auto-link, so it needs no extra emailed code.
  assert.equal(decideMemberLogin({ ...custom, connectMemberId: member.id }), "link");
  assert.equal(decideMemberLogin({ ...custom, emailProofVerified: true }), "link");
  assert.equal(decideMemberLogin({ ...custom, subjectLinked: true }), "sign_in");
});
test("a signed-in connect whose member row is missing is a conflict, not a crash", () => {
  assert.equal(decideMemberLogin({ ...input, member: null, connectMemberId: "member" }), "conflict");
});
