import { expect, it } from "vitest";

import { CONTENT_HASH_VERSION } from "../content-hash.js";
import { appendSkippedRowsToPeerPlan, keepChangingIncludedEntities, labelPeerPlanRows, tagTrashingRows } from "../report-labels.js";
import type { SkippedPackEntity } from "../type-registry.js";
import type { PackedEntity } from "../../transfer/index.js";

/**
 * @file `labelPeerPlanRows` — the source side naming the rows of a report the DESTINATION produced.
 *
 * The case this exists for is live: production is a build that predates `entityLabel`, so its plan
 * rows arrive unlabelled and the dialog would fall back to short ids for content this machine can
 * name exactly. These tests pin that the fill-in happens, that it never overwrites a label the peer
 * did supply, and that an unrecognized envelope is passed through rather than reshaped.
 */

function entity(over: { entityType: string; id: string; state: Record<string, unknown> }): PackedEntity {
  return {
    entityType: over.entityType,
    id: over.id,
    schemaVersion: 1,
    contentHash: `hash-${over.id}`,
    hashVersion: CONTENT_HASH_VERSION,
    requiredBlobs: [],
    state: over.state,
  };
}

const ENTITIES: readonly PackedEntity[] = [
  entity({ entityType: "post", id: "p1", state: { slug: "spring-sale", title: "Spring Sale" } }),
  entity({ entityType: "media", id: "m1", state: { slug: "logo-png", title: "Logo" } }),
  entity({ entityType: "media", id: "m2", state: { caption: "nothing nameable here" } }),
];

function planWith(rows: unknown[]): Record<string, unknown> {
  return { planId: "plan-1", planHash: "hash-1", details: { refused: false, refusalReason: null, applyOrder: ["media", "post"], rows } };
}

function rowsOf(plan: Record<string, unknown>): Array<Record<string, unknown>> {
  return (plan.details as { rows: Array<Record<string, unknown>> }).rows;
}

it("names an unlabelled peer row from the bundle this side sent", () => {
  const labelled = labelPeerPlanRows(
    {
      plan: planWith([
        { entityType: "post", entityId: "p1", outcome: "applied", writes: true, reason: null },
        { entityType: "media", entityId: "m1", outcome: "unchanged", writes: false, reason: null },
      ]),
      entities: ENTITIES
    }
  );

  expect(rowsOf(labelled).map((r) => [r.entityId, r.entityLabel])).toStrictEqual([["p1", "spring-sale"], ["m1", "logo-png"]]);
});

it("leaves every decision-bearing field of the peer's row exactly as it arrived", () => {
  const labelled = labelPeerPlanRows(
    {
      plan: planWith([{ entityType: "post", entityId: "p1", outcome: "conflict", writes: false, reason: "edited on the live site" }]),
      entities: ENTITIES
    }
  );

  expect(rowsOf(labelled)[0]).toStrictEqual({
    entityType: "post",
    entityId: "p1",
    entityLabel: "spring-sale",
    outcome: "conflict",
    writes: false,
    reason: "edited on the live site",
  });
  expect((labelled as { planHash: string }).planHash).toBe("hash-1");
});

it("never overwrites a label the peer supplied itself", () => {
  const labelled = labelPeerPlanRows(
    {
      plan: planWith([{ entityType: "post", entityId: "p1", entityLabel: "the-peers-own-name", outcome: "applied", writes: true, reason: null }]),
      entities: ENTITIES
    }
  );

  expect(rowsOf(labelled)[0]!.entityLabel).toBe("the-peers-own-name");
});

it("leaves a row it cannot name alone rather than inventing one", () => {
  const labelled = labelPeerPlanRows(
    {
      plan: planWith([
        { entityType: "media", entityId: "m2", outcome: "blocked", writes: false, reason: "required blob is absent" },
        { entityType: "widget", entityId: "not-in-this-bundle", outcome: "blocked", writes: false, reason: "no handler" },
      ]),
      entities: ENTITIES
    }
  );

  expect("entityLabel" in rowsOf(labelled)[0]!).toBe(false);
  expect("entityLabel" in rowsOf(labelled)[1]!).toBe(false);
});

it("passes an envelope it does not recognize straight through", () => {
  for (const plan of [{}, { details: null }, { details: { rows: "not an array" } }, { details: {} }]) {
    expect(labelPeerPlanRows({ plan, entities: ENTITIES })).toBe(plan);
  }
});

it("passes a refused report through with no rows invented", () => {
  const refused = { planId: "p", planHash: "h", details: { refused: true, refusalReason: "version mismatch", applyOrder: [], rows: [] } };
  const labelled = labelPeerPlanRows({ plan: refused, entities: ENTITIES });
  expect(rowsOf(labelled)).toStrictEqual([]);
  expect((labelled.details as { refusalReason: string }).refusalReason).toBe("version mismatch");
});

/**
 * @file `appendSkippedRowsToPeerPlan` — the other half of "this side has local context the
 * destination's report doesn't": a whole theme tree refused by `file-tree-policy.ts` at THIS
 * instance's own export step never reaches the peer's bundle at all (`export-bundle.ts`'s
 * `SkippedPackEntity`), so the peer's plan can never report it. This is where those locally-known
 * refusals join the same `rows` array the dialog already renders a non-selectable `blocked` row from.
 */
const SKIPPED: readonly SkippedPackEntity[] = [
  {
    entityType: "theme-files",
    id: "static/kuinetic-showcase",
    label: "static/kuinetic-showcase",
    reason: "Can't publish: contains a video file (video.mp4)",
  },
];

it("appendSkippedRowsToPeerPlan adds one non-writing blocked row per skipped unit", () => {
  const withSkipped = appendSkippedRowsToPeerPlan({ plan: planWith([{ entityType: "post", entityId: "p1", outcome: "applied", writes: true, reason: null }]), skipped: SKIPPED });

  expect(rowsOf(withSkipped)).toStrictEqual([
    { entityType: "post", entityId: "p1", outcome: "applied", writes: true, reason: null },
    {
      entityType: "theme-files",
      entityId: "static/kuinetic-showcase",
      entityLabel: "static/kuinetic-showcase",
      outcome: "blocked",
      writes: false,
      reason: SKIPPED[0]!.reason,
      canOverwrite: false,
      retires: null,
    },
  ]);
});

it("appendSkippedRowsToPeerPlan is a no-op with an empty skipped list", () => {
  const plan = planWith([{ entityType: "post", entityId: "p1", outcome: "applied", writes: true, reason: null }]);
  expect(appendSkippedRowsToPeerPlan({ plan, skipped: [] })).toBe(plan);
});

it("appendSkippedRowsToPeerPlan passes an envelope it does not recognize straight through", () => {
  for (const plan of [{}, { details: null }, { details: { rows: "not an array" } }]) {
    expect(appendSkippedRowsToPeerPlan({ plan, skipped: SKIPPED })).toBe(plan);
  }
});

it("appendSkippedRowsToPeerPlan adds nothing to a refused report", () => {
  const refused = { planId: "p", planHash: "h", details: { refused: true, refusalReason: "version mismatch", applyOrder: [], rows: [] } };
  const withSkipped = appendSkippedRowsToPeerPlan({ plan: refused, skipped: SKIPPED });
  expect(rowsOf(withSkipped)).toStrictEqual([]);
});

/**
 * `keepChangingIncludedEntities` — owner decision 2026-09-25: media carried along with a scoped
 * pages/posts run shows ONLY when live would actually change (created or updated). Every other
 * outcome for such a row is dropped from the report; every row that was not carried along is left
 * exactly as it arrived.
 */
function mediaRow(id: string, outcome: string, writes: boolean): Record<string, unknown> {
  return { entityType: "media", entityId: id, outcome, writes, reason: null };
}

it("keepChangingIncludedEntities tags created/updated/overwritten carried-along media with who uses it, and drops unchanged", () => {
  const plan = planWith([
    mediaRow("m-new", "created", true),
    mediaRow("m-upd", "applied", true),
    mediaRow("m-forced", "forced", true),
    mediaRow("m-same", "unchanged", false),
    { entityType: "page", entityId: "pg1", outcome: "unchanged", writes: false, reason: null },
  ]);
  const includedFor = new Map([
    ["media:m-new", ["page:pg1"]],
    ["media:m-upd", ["page:pg1"]],
    ["media:m-forced", ["page:pg1"]],
    ["media:m-same", ["page:pg1"]],
  ]);

  const rows = rowsOf(keepChangingIncludedEntities({ plan, includedFor }));

  expect(rows.map((row) => [row.entityId, row.includedFor ?? null])).toStrictEqual([
      ["m-new", ["page:pg1"]],
      ["m-upd", ["page:pg1"]],
      ["m-forced", ["page:pg1"]],
      ["pg1", null],
    ]);
});

/**
 * A carried-along media row live reports as conflict/blocked is NOT hidden: the page would otherwise
 * publish pointing at an image live doesn't have (or holds differently). It shows as an ordinary row
 * — untagged, reason and `canOverwrite` intact — exactly like any conflicting media row, so the
 * dialog gives it the plain reason and the "Overwrite on live" box.
 */
it("keepChangingIncludedEntities keeps a conflicting or blocked carried-along media row as an ordinary row", () => {
  const conflict = { ...mediaRow("m-conf", "conflict", false), reason: "Edited on live", canOverwrite: true };
  const blocked = { ...mediaRow("m-block", "blocked", false), reason: "Slug taken", canOverwrite: false };
  const plan = planWith([conflict, blocked]);
  const includedFor = new Map([
    ["media:m-conf", ["page:pg1"]],
    ["media:m-block", ["post:po1"]],
  ]);

  const rows = rowsOf(keepChangingIncludedEntities({ plan, includedFor }));

  expect(rows).toStrictEqual([conflict, blocked]);
});

it("keepChangingIncludedEntities leaves an ordinary media row alone whatever its outcome", () => {
  const plan = planWith([mediaRow("m-own", "unchanged", false)]);
  const rows = rowsOf(keepChangingIncludedEntities({ plan, includedFor: new Map() }));
  expect(rows).toStrictEqual([mediaRow("m-own", "unchanged", false)]);
});

it("keepChangingIncludedEntities passes an envelope it does not recognize straight through", () => {
  const odd = { planId: "x", details: "not a report" };
  expect(keepChangingIncludedEntities({ plan: odd, includedFor: new Map([["media:m1", ["page:p"]]]) })).toBe(odd);
});

it("a source-set displayLabel names the row even over the peer's own state-derived label", () => {
  // A live build that predates `displayLabel` names a theme row from `state.title` ("Theme: static/x");
  // the source's `theme.json` name for its own tree wins. Rows without one keep the peer's label.
  const named: PackedEntity = {
    ...entity({ entityType: "theme-files", id: "static/demo-theme", state: { title: "Theme: static/demo-theme" } }),
    displayLabel: "Demo Theme",
  };
  const labelled = labelPeerPlanRows(
    {
      plan: planWith([
        { entityType: "theme-files", entityId: "static/demo-theme", entityLabel: "Theme: static/demo-theme", outcome: "applied", writes: true, reason: null },
        { entityType: "post", entityId: "p1", entityLabel: "peer-name", outcome: "applied", writes: true, reason: null },
      ]),
      entities: [...ENTITIES, named]
    }
  );

  expect(rowsOf(labelled).map((r) => [r.entityId, r.entityLabel])).toStrictEqual([["static/demo-theme", "Demo Theme"], ["p1", "peer-name"]]);
});

// 2026-09-26: a locally trashed media item plans on live as an ordinary `applied` update, and the
// dialog said "Will publish — update" for what is really a trash on live.
it("tagTrashingRows marks an update or overwrite whose local item is trashed, and nothing else", () => {
  const entities = [
    entity({ entityType: "media", id: "gone", state: { slug: "gone", status: "trashed" } }),
    entity({ entityType: "media", id: "forced-gone", state: { slug: "forced-gone", status: "trashed" } }),
    entity({ entityType: "media", id: "new-gone", state: { slug: "new-gone", status: "trashed" } }),
    entity({ entityType: "media", id: "same-gone", state: { slug: "same-gone", status: "trashed" } }),
    entity({ entityType: "media", id: "kept", state: { slug: "kept", status: "active" } }),
  ];
  const plan = planWith([
    { entityType: "media", entityId: "gone", outcome: "applied", writes: true, reason: null },
    { entityType: "media", entityId: "forced-gone", outcome: "forced", writes: true, reason: "edited on live" },
    { entityType: "media", entityId: "new-gone", outcome: "created", writes: true, reason: null },
    { entityType: "media", entityId: "same-gone", outcome: "unchanged", writes: false, reason: null },
    { entityType: "media", entityId: "kept", outcome: "applied", writes: true, reason: null },
  ]);

  const tagged = rowsOf(tagTrashingRows({ plan, entities }));

  expect(tagged.map((row) => `${String(row.entityId)}:${String(row.trashes ?? false)}`)).toStrictEqual(["gone:true", "forced-gone:true", "new-gone:false", "same-gone:false", "kept:false"]);
  expect({ ...tagged[0], trashes: undefined }).toStrictEqual({ ...rowsOf(plan)[0], trashes: undefined });
});

it("tagTrashingRows passes an envelope it does not recognize straight through", () => {
  const odd = { planId: "plan-1", details: "not a report" };
  expect(tagTrashingRows({ plan: odd, entities: ENTITIES })).toBe(odd);
});

it("L163 included rows preserve malformed and ordinary values while filtering only included unchanged rows", () => {
  const malformed = [null, 42, "row", ["row"]];
  const ordinary = { outcome: "unchanged" };
  const conflict = { entityType: "media", entityId: "conflict", outcome: "conflict", reason: "Keep me" };
  const created = { entityType: "media", entityId: "new", outcome: "created" };
  const same = { entityType: "media", entityId: "same", outcome: "unchanged" };
  const plan = { details: { rows: [...malformed, ordinary, conflict, created, same] } };
  const included = new Map(["conflict", "new", "same"].map(id => [`media:${id}`, ["page:p"]]));
  const result = keepChangingIncludedEntities({ plan, includedFor: included });
  expect(result).toStrictEqual({ details: { rows: [...malformed, ordinary, conflict, { ...created, includedFor: ["page:p"] }] } });
  expect(plan.details.rows.length).toBe(8);
  expect(keepChangingIncludedEntities({ plan, includedFor: new Map() })).toBe(plan);
  const odd = { details: { rows: null } };
  expect(keepChangingIncludedEntities({ plan: odd, includedFor: included })).toBe(odd);
});

it("labelPeerPlanRows passes malformed rows and id-less rows through untouched", () => {
  const malformed = [null, 42, "row", ["row"]];
  const idless = { outcome: "created", writes: true };
  const plan = planWith([...malformed, idless, { entityType: "post", entityId: "p1", outcome: "created" }]);

  const rows = rowsOf(labelPeerPlanRows({ plan, entities: ENTITIES }));

  expect(rows.slice(0, 5)).toStrictEqual([...malformed, idless]);
  expect(rows[5]?.entityLabel).toBe("spring-sale");
  const notRows = { details: { rows: "not rows" } };
  expect(labelPeerPlanRows({ plan: notRows, entities: ENTITIES })).toBe(notRows);
});

it("tagTrashingRows leaves malformed rows and id-less update rows alone", () => {
  const entities = [entity({ entityType: "media", id: "gone", state: { slug: "gone", status: "trashed" } })];
  const malformed = [null, 42];
  const idless = { outcome: "applied", writes: true };
  const plan = planWith([...malformed, idless, { entityType: "media", entityId: "gone", outcome: "applied" }]);

  const rows = rowsOf(tagTrashingRows({ plan, entities }));

  expect(rows.slice(0, 3)).toStrictEqual([...malformed, idless]);
  expect(rows[3]?.trashes).toBe(true);
  expect(tagTrashingRows({ plan, entities: ENTITIES })).toBe(plan);
});
