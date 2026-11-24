import assert from "node:assert/strict";
import { test } from "vitest";

import { CHAT_ATTACHMENT_REF_PATTERN } from "../chat-attachment.js";
import { MEMBER_OIDC_PATH } from "../member-login.js";

/** @file Characterizes the two runtime values these browser-safe contracts publish. */
test("CHAT_ATTACHMENT_REF_PATTERN accepts minted attachment ids and refuses path-like or out-of-range tails", () => {
  assert.match("attachment:3f1c2a9e-0b7d-4c1e-9a55-2d6f0e8b7c41", CHAT_ATTACHMENT_REF_PATTERN);
  assert.match("attachment:abcd1234", CHAT_ATTACHMENT_REF_PATTERN);
  for (const ref of ["attachment:abc1234", "attachment:../etc/passwd", "attachment:a.b-1234567", "attachment:abc\\12345", `attachment:${"a".repeat(81)}`, "upload:abcd1234", " attachment:abcd1234"]) {
    assert.doesNotMatch(ref, CHAT_ATTACHMENT_REF_PATTERN, ref);
  }
});

test("MEMBER_OIDC_PATH is the same-origin member OIDC route template", () => {
  assert.equal(MEMBER_OIDC_PATH, "/api/members/v1/workspaces/:workspaceId/oidc/:providerId");
});
