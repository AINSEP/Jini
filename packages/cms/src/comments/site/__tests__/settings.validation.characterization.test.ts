/**
 * @file Characterization pin for `settings.ts`'s patch validation, complementing `settings.test.ts`.
 *
 * `validateCommentsSettingsPatch` is module-private, so it is pinned the only way a caller can
 * reach it: through `setCommentsSettings`. That existing suite asserts only that two of the rules
 * reject at all. This one pins the parts a restructuring can silently change:
 *
 * - the exact message of every rejection, since `put-settings.ts` maps
 *   `CommentsSettingsValidationError` straight onto a 400 body the admin UI shows verbatim;
 * - which field wins when several are invalid — validation runs in a fixed field order and throws
 *   on the FIRST failure, so the reported message is order-dependent, not set-dependent;
 * - the accepted boundary values on both sides of every range, so a rewritten comparison cannot
 *   quietly become exclusive;
 * - the all-or-nothing property: a rejected patch writes nothing, including its valid fields.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySettingsRepo } from "@jini-ai/core/settings";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import { CommentsSettingsValidationError } from "../../errors.js";
import { MAX_DEPTH_CEILING, MAX_PER_IP_PER_HOUR_CEILING } from "../../settings-limits.js";
import {
  ensureCommentsSettingDefinitions,
  getCommentsSettings,
  setCommentsSettings,
} from "../settings.js";
import type { CommentsSettings } from "../../types.js";

const WORKSPACE = "workspace-1";
const clock = { nowIso: () => "2026-07-16T00:00:00.000Z", nowMs: () => Date.parse("2026-07-16T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `comments-settings-characterization-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

async function makeRegisteredDeps() {
  const settingsRepo = new InMemorySettingsRepo();
  // An empty principal repo: the lookup resolves no principal, exactly as the host policy does for an empty repo.
  const principals = {} as PrincipalRepoPort;
  const deps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals, createPrincipalLookup: () => ({ findActiveById: async () => null }) };
  await ensureCommentsSettingDefinitions(deps, { workspaceId: WORKSPACE, systemPrincipalId: "system-comments" });
  return deps;
}

/** Applies `patch` and returns the thrown validation message, failing if it was accepted. */
async function rejectionMessage(patch: Partial<CommentsSettings>): Promise<string> {
  const deps = await makeRegisteredDeps();
  try {
    await setCommentsSettings(deps, { workspaceId: WORKSPACE, patch, callerPrincipalId: "principal-1" });
  } catch (error) {
    assert.ok(error instanceof CommentsSettingsValidationError, `expected CommentsSettingsValidationError, got ${String(error)}`);
    return error.message;
  }
  assert.fail(`expected patch ${JSON.stringify(patch)} to be rejected`);
}

/** Applies `patch` and returns the resulting settings, failing if it was rejected. */
async function accepted(patch: Partial<CommentsSettings>): Promise<CommentsSettings> {
  const deps = await makeRegisteredDeps();
  return setCommentsSettings(deps, { workspaceId: WORKSPACE, patch, callerPrincipalId: "principal-1" });
}

// ---------------------------------------------------------------------------
// Exact rejection text, one rule at a time.
// ---------------------------------------------------------------------------

test("setCommentsSettings: the boolean rules report their own field name", async () => {
  assert.equal(await rejectionMessage({ enabled: "yes" as unknown as boolean }), "enabled must be a boolean");
  assert.equal(
    await rejectionMessage({ requireModeration: 1 as unknown as boolean }),
    "requireModeration must be a boolean"
  );
});

test("setCommentsSettings: maxDepth rejects non-numbers, non-integers and negatives with one shared message", async () => {
  const expected = "maxDepth must be a non-negative integer";
  assert.equal(await rejectionMessage({ maxDepth: "3" as unknown as number }), expected);
  assert.equal(await rejectionMessage({ maxDepth: 2.5 }), expected);
  assert.equal(await rejectionMessage({ maxDepth: -1 }), expected);
  assert.equal(await rejectionMessage({ maxDepth: Number.NaN }), expected);
});

test("setCommentsSettings: maxDepth over the ceiling reports the ceiling, not the shape rule", async () => {
  assert.equal(await rejectionMessage({ maxDepth: MAX_DEPTH_CEILING + 1 }), "maxDepth must be at most 20");
});

test("setCommentsSettings: closeAfterDays keeps its 'or null' wording and has NO ceiling", async () => {
  const expected = "closeAfterDays must be a non-negative integer or null";
  assert.equal(await rejectionMessage({ closeAfterDays: -1 }), expected);
  assert.equal(await rejectionMessage({ closeAfterDays: 1.5 }), expected);
  assert.equal(await rejectionMessage({ closeAfterDays: "7" as unknown as number }), expected);

  // Deliberately far above every other field's ceiling: this rule has no upper bound.
  const settings = await accepted({ closeAfterDays: 100_000 });
  assert.equal(settings.closeAfterDays, 100_000);
});

test("setCommentsSettings: spamAutoRejectScore rejects both ends of the [0,1] range with one message", async () => {
  const expected = "spamAutoRejectScore must be a number in [0,1]";
  assert.equal(await rejectionMessage({ spamAutoRejectScore: -0.01 }), expected);
  assert.equal(await rejectionMessage({ spamAutoRejectScore: 1.01 }), expected);
  assert.equal(await rejectionMessage({ spamAutoRejectScore: "0.5" as unknown as number }), expected);
});

test("setCommentsSettings: spamAutoRejectScore accepts fractions — it is the one field that is not an integer rule", async () => {
  const settings = await accepted({ spamAutoRejectScore: 0.25 });
  assert.equal(settings.spamAutoRejectScore, 0.25);
});

test("setCommentsSettings: maxPerIpPerHour is POSITIVE, so zero is rejected by the shape rule", async () => {
  const expected = "maxPerIpPerHour must be a positive integer";
  assert.equal(await rejectionMessage({ maxPerIpPerHour: 0 }), expected);
  assert.equal(await rejectionMessage({ maxPerIpPerHour: -5 }), expected);
  assert.equal(await rejectionMessage({ maxPerIpPerHour: 1.5 }), expected);
});

test("setCommentsSettings: maxPerIpPerHour over the ceiling reports the ceiling", async () => {
  assert.equal(
    await rejectionMessage({ maxPerIpPerHour: MAX_PER_IP_PER_HOUR_CEILING + 1 }),
    "maxPerIpPerHour must be at most 1000"
  );
});

// ---------------------------------------------------------------------------
// Field order decides which message a multi-error patch reports.
// ---------------------------------------------------------------------------

test("setCommentsSettings: validation throws on the FIRST invalid field in declaration order", async () => {
  const everythingInvalid = {
    maxPerIpPerHour: 0,
    spamAutoRejectScore: 9,
    closeAfterDays: -1,
    maxDepth: -1,
    requireModeration: "no" as unknown as boolean,
    enabled: "yes" as unknown as boolean,
  };
  assert.equal(await rejectionMessage(everythingInvalid), "enabled must be a boolean");

  const { enabled: _enabled, ...withoutEnabled } = everythingInvalid;
  assert.equal(await rejectionMessage(withoutEnabled), "requireModeration must be a boolean");

  const { requireModeration: _requireModeration, ...withoutBooleans } = withoutEnabled;
  assert.equal(await rejectionMessage(withoutBooleans), "maxDepth must be a non-negative integer");

  const { maxDepth: _maxDepth, ...withoutMaxDepth } = withoutBooleans;
  assert.equal(await rejectionMessage(withoutMaxDepth), "closeAfterDays must be a non-negative integer or null");

  const { closeAfterDays: _closeAfterDays, ...withoutCloseAfterDays } = withoutMaxDepth;
  assert.equal(await rejectionMessage(withoutCloseAfterDays), "spamAutoRejectScore must be a number in [0,1]");
});

test("setCommentsSettings: the shape rule is checked before the ceiling rule on the same field", async () => {
  assert.equal(await rejectionMessage({ maxDepth: -99 }), "maxDepth must be a non-negative integer");
  assert.equal(await rejectionMessage({ maxDepth: 25.5 }), "maxDepth must be a non-negative integer");
});

// ---------------------------------------------------------------------------
// Accepted boundaries — every range is inclusive on both ends.
// ---------------------------------------------------------------------------

test("setCommentsSettings: every range boundary is accepted, not rejected", async () => {
  assert.equal((await accepted({ maxDepth: 0 })).maxDepth, 0);
  assert.equal((await accepted({ maxDepth: MAX_DEPTH_CEILING })).maxDepth, 20);
  assert.equal((await accepted({ closeAfterDays: 0 })).closeAfterDays, 0);
  assert.equal((await accepted({ spamAutoRejectScore: 0 })).spamAutoRejectScore, 0);
  assert.equal((await accepted({ spamAutoRejectScore: 1 })).spamAutoRejectScore, 1);
  assert.equal((await accepted({ maxPerIpPerHour: 1 })).maxPerIpPerHour, 1);
  assert.equal((await accepted({ maxPerIpPerHour: MAX_PER_IP_PER_HOUR_CEILING })).maxPerIpPerHour, 1000);
});

test("setCommentsSettings: an explicit null closeAfterDays skips the number rules entirely and round-trips as null", async () => {
  const settings = await accepted({ closeAfterDays: null });
  assert.equal(settings.closeAfterDays, null);
});

test("setCommentsSettings: an empty patch is accepted and changes nothing", async () => {
  const settings = await accepted({});
  assert.deepEqual(settings, {
    enabled: true,
    requireModeration: true,
    maxDepth: 5,
    closeAfterDays: null,
    spamAutoRejectScore: 0.5,
    maxPerIpPerHour: 20,
  });
});

// ---------------------------------------------------------------------------
// All-or-nothing.
// ---------------------------------------------------------------------------

test("setCommentsSettings: a rejected patch persists none of its VALID fields either", async () => {
  const deps = await makeRegisteredDeps();
  await assert.rejects(
    () =>
      setCommentsSettings(deps, {
        workspaceId: WORKSPACE,
        // `enabled` and `maxDepth` are both valid and both ordered BEFORE the failing field.
        patch: { enabled: false, maxDepth: 9, maxPerIpPerHour: 0 },
        callerPrincipalId: "principal-1",
      }),
    CommentsSettingsValidationError
  );

  const settings = await getCommentsSettings({ settingsRepo: deps.settingsRepo }, { workspaceId: WORKSPACE });
  assert.equal(settings.enabled, true, "the valid `enabled` field must not have been written");
  assert.equal(settings.maxDepth, 5, "the valid `maxDepth` field must not have been written");
});
