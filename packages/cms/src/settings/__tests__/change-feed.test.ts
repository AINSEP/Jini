import assert from "node:assert/strict";
import { test } from "vitest";

import { collectChangedNamespaces, isRevisionVisibleTo, type ChangeFeedViewer } from "../change-feed.js";
import type { SettingRevisionRecord } from "../types.js";

/**
 * @file The change feed's disclosure rule.
 *
 * The feature is "tell an open tab something moved"; the risk is telling it about movement it was
 * never entitled to observe. A namespace name is not a value, but "another operator's preferences
 * just changed" still discloses that the principal exists and is active — so the negative cases
 * carry the weight here.
 */

const VIEWER: ChangeFeedViewer = { workspaceId: "ws-1", principalId: "p-1" };

function revision(overrides: Partial<SettingRevisionRecord> = {}): SettingRevisionRecord {
  return {
    seq: 1,
    entityKind: "value",
    settingId: "setting-1",
    scope: "workspace",
    workspaceId: "ws-1",
    principalId: null,
    op: "set",
    beforeJson: null,
    afterJson: "x",
    defVersion: 1,
    actor: "p-1",
    originPluginId: null,
    changeSetId: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

// --- visibility ------------------------------------------------------------

test("global-scope changes are visible to everyone", () => {
  assert.equal(isRevisionVisibleTo(revision({ scope: "global", workspaceId: null }), VIEWER), true);
});

test("workspace-scope changes are visible only within their own workspace", () => {
  assert.equal(isRevisionVisibleTo(revision({ scope: "workspace", workspaceId: "ws-1" }), VIEWER), true);
  assert.equal(
    isRevisionVisibleTo(revision({ scope: "workspace", workspaceId: "ws-2" }), VIEWER),
    false,
    "another tenant's workspace change must not be disclosed",
  );
});

test("user-scope changes are visible ONLY to the principal they belong to", () => {
  assert.equal(isRevisionVisibleTo(revision({ scope: "user", workspaceId: "ws-1", principalId: "p-1" }), VIEWER), true);
  assert.equal(
    isRevisionVisibleTo(revision({ scope: "user", workspaceId: "ws-1", principalId: "p-2" }), VIEWER),
    false,
    "another operator's preference change must not be disclosed — it reveals that principal is active",
  );
  assert.equal(
    isRevisionVisibleTo(revision({ scope: "user", workspaceId: "ws-2", principalId: "p-1" }), VIEWER),
    false,
    "a same-id principal in another workspace is a different principal",
  );
});

test("definition revisions follow the definition's own workspace, with null meaning platform-wide", () => {
  assert.equal(isRevisionVisibleTo(revision({ entityKind: "definition", scope: null, workspaceId: null }), VIEWER), true);
  assert.equal(isRevisionVisibleTo(revision({ entityKind: "definition", scope: null, workspaceId: "ws-1" }), VIEWER), true);
  assert.equal(
    isRevisionVisibleTo(revision({ entityKind: "definition", scope: null, workspaceId: "ws-2" }), VIEWER),
    false,
    "another workspace's site-owned definition is not this viewer's business",
  );
});

test("an unrecognized scope is withheld, not passed through", () => {
  // The allowlist's whole point: a scope added to `SettingScope` later is invisible until someone
  // decides what it should mean, rather than silently broadcast.
  const unknown = revision({ scope: "future-scope" as never, workspaceId: "ws-1" });
  assert.equal(isRevisionVisibleTo(unknown, VIEWER), false);
});

// --- batching --------------------------------------------------------------

const resolver = (map: Record<string, string | null>) => async (settingId: string) => map[settingId] ?? null;

test("collects the namespaces of visible revisions, deduplicated", async () => {
  const batch = await collectChangedNamespaces(
    [
      revision({ seq: 5, settingId: "s-lang" }),
      revision({ seq: 6, settingId: "s-lang" }),
      revision({ seq: 7, settingId: "s-theme" }),
    ],
    VIEWER,
    resolver({ "s-lang": "core.language", "s-theme": "core.appearance" }),
  );

  assert.deepEqual([...batch.namespaces].sort(), ["core.appearance", "core.language"]);
  assert.equal(batch.cursor, 7);
});

test("advances the cursor past invisible revisions so they are never re-examined", async () => {
  const batch = await collectChangedNamespaces(
    [
      revision({ seq: 10, scope: "user", principalId: "p-2", settingId: "s-lang" }),
      revision({ seq: 11, scope: "workspace", workspaceId: "ws-2", settingId: "s-lang" }),
    ],
    VIEWER,
    resolver({ "s-lang": "core.language" }),
  );

  assert.deepEqual(batch.namespaces, [], "nothing visible changed");
  assert.equal(batch.cursor, 11, "the cursor must still advance, or these rows are re-read every tick forever");
});

test("a revision whose definition cannot be resolved advances the cursor but names nothing", async () => {
  const batch = await collectChangedNamespaces([revision({ seq: 3, settingId: "s-deleted" })], VIEWER, resolver({}));

  assert.deepEqual(batch.namespaces, [], "there is no namespace to name for a deleted definition");
  assert.equal(batch.cursor, 3);
});

test("mixes visible and invisible revisions without leaking the invisible ones", async () => {
  const batch = await collectChangedNamespaces(
    [
      revision({ seq: 1, scope: "user", principalId: "p-1", settingId: "s-mine" }),
      revision({ seq: 2, scope: "user", principalId: "p-2", settingId: "s-theirs" }),
    ],
    VIEWER,
    resolver({ "s-mine": "core.language", "s-theirs": "core.privacy" }),
  );

  assert.deepEqual(batch.namespaces, ["core.language"]);
  assert.equal(batch.namespaces.includes("core.privacy"), false, "the other principal's namespace must not appear");
  assert.equal(batch.cursor, 2);
});

test("an empty batch is not an error", async () => {
  const batch = await collectChangedNamespaces([], VIEWER, resolver({}));
  assert.deepEqual(batch.namespaces, []);
  assert.equal(batch.cursor, 0);
});
