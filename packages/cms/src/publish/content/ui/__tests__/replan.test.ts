import assert from "node:assert/strict";
import { test } from "vitest";
import { overwriteReplanIsConsistent, preparePublishConfirmation, PublishPlanDriftError } from "../replan.js";
import type { PublishContentOutcomeRow, PublishContentPlanResult } from "../contract.js";

const DRIFT_MESSAGE = "The live site changed while publishing was being planned. Check the list again.";

function row(entityType: string, entityId: string, outcome: PublishContentOutcomeRow["outcome"], includedFor?: readonly string[]): PublishContentOutcomeRow {
  return { entityType, entityId, entityLabel: entityId, outcome, writes: ["created", "applied", "forced"].includes(outcome), reason: null,
    ...(includedFor ? { includedFor } : {}) };
}
function plan(rows: readonly PublishContentOutcomeRow[], overwriteEntityKeys?: readonly string[]): PublishContentPlanResult {
  return { planId: "plan", planHash: "hash", bundleId: "bundle", liveCanOverwrite: true,
    details: { refused: false, refusalReason: null, applyOrder: ["page", "media"], rows },
    ...(overwriteEntityKeys ? { overwriteEntityKeys } : {}) };
}
test("narrowing retains a carried media overwrite but removes a deselected page overwrite", async () => {
  const shown = plan([row("page", "home", "created"), row("page", "about", "forced"), row("media", "hero", "forced", ["page:home"])], ["page:about", "media:hero"]);
  let requested: unknown;
  const next = plan([row("page", "home", "created"), row("media", "hero", "forced", ["page:home"])], ["media:hero"]);
  assert.equal(await preparePublishConfirmation({ plan: shown, deselectedKeys: new Set(["page:about"]), driftMessage: DRIFT_MESSAGE, planPublish: async input => { requested = input; return next; } }), next);
  assert.deepEqual(requested, { selectedEntityKeys: ["page:home"], overwriteEntityKeys: ["media:hero"] });
});
test("removing a referrer also removes its carried dependency and its overwrite", async () => {
  const shown = plan([row("page", "home", "created"), row("page", "about", "created"), row("media", "hero", "forced", ["page:home"])], ["media:hero"]);
  let requested: unknown;
  await preparePublishConfirmation({ plan: shown, deselectedKeys: new Set(["page:home"]), driftMessage: DRIFT_MESSAGE, planPublish: async input => { requested = input; return plan([row("page", "about", "created")]); } });
  assert.deepEqual(requested, { selectedEntityKeys: ["page:about"] });
});
test("re-plan checks every overwrite and the unchanged remainder of the write set", () => {
  const shown = plan([row("page", "home", "created"), row("page", "about", "conflict")]);
  assert.equal(overwriteReplanIsConsistent({ shown: shown.details,
    next: plan([row("page", "home", "created"), row("page", "about", "forced")]).details,
    tickedKeys: new Set(["page:about"]), changing: new Set(["page:about"]) }), true);
  assert.equal(overwriteReplanIsConsistent({ shown: shown.details,
    next: plan([row("page", "home", "conflict"), row("page", "about", "forced")]).details,
    tickedKeys: new Set(["page:about"]), changing: new Set(["page:about"]) }), false);
});
test("a narrowed re-plan that writes a different set refuses with the new plan attached", async () => {
  const shown = plan([row("page", "home", "created"), row("page", "about", "created"), row("page", "contact", "created")]);
  const drifted = plan([row("page", "home", "conflict"), row("page", "about", "created")]);
  await assert.rejects(
    () => preparePublishConfirmation({ plan: shown, deselectedKeys: new Set(["page:contact"]), driftMessage: DRIFT_MESSAGE, planPublish: async () => drifted }),
    (error: unknown) => error instanceof PublishPlanDriftError && error.plan === drifted &&
      error.message === "The live site changed while publishing was being planned. Check the list again."
  );
});
test("a confirmation with nothing deselected keeps the shown plan and never re-plans", async () => {
  const shown = plan([row("page", "home", "created"), row("page", "about", "created")]);
  let calls = 0;
  assert.equal(await preparePublishConfirmation({ plan: shown, deselectedKeys: new Set(), driftMessage: DRIFT_MESSAGE, planPublish: async () => { calls += 1; return shown; } }), shown);
  assert.equal(calls, 0);
});
test("a ticked overwrite the re-plan no longer forces, or no longer lists, is inconsistent", () => {
  const shown = plan([row("page", "about", "conflict")]).details;
  const changing = new Set(["page:about"]);
  assert.equal(overwriteReplanIsConsistent({ shown, next: plan([row("page", "about", "conflict")]).details, tickedKeys: changing, changing }), false);
  assert.equal(overwriteReplanIsConsistent({ shown, next: plan([]).details, tickedKeys: changing, changing }), false);
});
test("a re-plan writing a same-sized but different remainder is inconsistent", () => {
  assert.equal(overwriteReplanIsConsistent({
    shown: plan([row("page", "home", "created"), row("page", "about", "unchanged")]).details,
    next: plan([row("page", "home", "unchanged"), row("page", "about", "applied")]).details,
    tickedKeys: new Set(), changing: new Set(),
  }), false);
});
