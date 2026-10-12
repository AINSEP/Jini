import { afterAll, beforeAll, expect, test } from "vitest";

import { standingDraftRecoveryMessage } from "../standing-draft-recovery-message.js";

// Fixed viewer zone so the default local-time rendering is deterministic on any machine.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const draft = { bodyFormat: "doc" as const, title: "Typed", slug: "typed", baseVersion: 2, savedAt: "2026-10-11T19:26:00.665Z", savedByPrincipalId: "operator-1", serverUpdatedAt: "2026-10-11T19:00:00.000Z" };

test("the restore banner shows the capture in the viewer's local time, never the raw ISO string", () => {
  const message = standingDraftRecoveryMessage({ draft, t: key => key });
  expect(message).toBe("Restore unsaved changes from 2026-10-11 12:26 · Local changes are newer.");
  expect(message).not.toContain("T19:26");
});

test("a host-supplied formatter replaces the default", () => {
  expect(standingDraftRecoveryMessage({ draft, t: key => key }, { formatSavedAt: () => "just now" }))
    .toBe("Restore unsaved changes from just now · Local changes are newer.");
});
