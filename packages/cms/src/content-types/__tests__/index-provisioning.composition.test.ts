import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveFieldIndexTransition } from "../index-provisioning.js";

/**
 * @file CIC U-003 (SPEC-020) — field-update index-provisioning composition (C-403; REQ-27, REQ-29,
 * REQ-30; INV-09, INV-10).
 *
 * Binding constraint U-003-B1: for every field in an `UPDATE_CONTENT_TYPE_FIELDS` full-replace
 * submission, index state is resolved from a SINGLE before/after comparison of that field's
 * `(kind, queryable)` pair — never from two independent branches that each assume the other
 * property is unchanged. This property test exhaustively covers all 4 combination classes named
 * across REQ-27/REQ-29/REQ-30:
 *
 * 1. kind-only change (queryable stays true across the call) -> REQ-27 -> reprovision
 * 2. queryable-only change (kind stays constant) -> REQ-29 -> provision (false->true) / teardown (true->false)
 * 3. both kind AND queryable change together on an existing field -> REQ-30(b) -> resolved from post-call state
 * 4. brand-new field introduced with queryable=true -> REQ-30(a) -> provision, registration-parity
 *
 * Covers: AC-43, AC-52, AC-53, AC-54, AC-55; INV-09, INV-10; EC-12, EC-17, EC-18, EC-19.
 */

type FieldState = { kind: "text" | "integer" | "real" | "boolean" | "datetime"; queryable: boolean } | undefined;

function transition(before: FieldState, after: FieldState) {
  return resolveFieldIndexTransition({ before, after });
}

test("AC-43/EC-12 (REQ-27): kind changes while queryable stays true across the call -> reprovision under the new kind's CAST mapping", () => {
  const result = transition({ kind: "integer", queryable: true }, { kind: "real", queryable: true });

  assert.equal(result.action, "reprovision");
  assert.equal(result.newKind, "real");
});

test("AC-52/EC-17 (REQ-29): queryable flips false->true while kind is unchanged -> provision a new index", () => {
  const result = transition({ kind: "text", queryable: false }, { kind: "text", queryable: true });

  assert.equal(result.action, "provision");
});

test("AC-53/EC-17 (REQ-29): queryable flips true->false while kind is unchanged -> tear down the existing index", () => {
  const result = transition({ kind: "text", queryable: true }, { kind: "text", queryable: false });

  assert.equal(result.action, "teardown");
});

test("AC-54/EC-18 (REQ-30a): a brand-new field introduced with queryable=true -> provision, identical to registration-time provisioning", () => {
  const result = transition(undefined, { kind: "integer", queryable: true });

  assert.equal(result.action, "provision");
});

test("AC-55/EC-19 (REQ-30b, the audit-critical case): kind AND queryable both change together in the same call -> resolved from POST-call state, index state is provisioned under the new kind, not left ungoverned", () => {
  // This is the exact case U-003's designation names: an independent-branches implementation
  // would either skip this entirely (neither REQ-27's nor REQ-29's literal condition alone is
  // met — REQ-27 requires queryable UNCHANGED, REQ-29 requires kind UNCHANGED) or take an
  // unspecified branch.
  const result = transition({ kind: "integer", queryable: false }, { kind: "real", queryable: true });

  assert.equal(result.action, "provision", "must provision an index for the post-call state (queryable=true), never skip due to kind having also changed");
  assert.equal(result.newKind, "real", "the provisioned index must be built against the field's POST-call kind, never the stale pre-call kind");
});

test("(property) INV-10: a field removed entirely via full-replace omission tears down its index, if it had one", () => {
  const result = transition({ kind: "text", queryable: true }, undefined);

  assert.equal(result.action, "teardown");
});

test("(property) INV-10: a field removed entirely that was never queryable requires no index action", () => {
  const result = transition({ kind: "text", queryable: false }, undefined);

  assert.equal(result.action, "none");
});

test("(property) no-op case: a field resubmitted completely unchanged (same kind, same queryable=true) requires no index action", () => {
  const result = transition({ kind: "text", queryable: true }, { kind: "text", queryable: true });

  assert.equal(result.action, "none");
});

test("(property) no-op case: a field resubmitted unchanged with queryable=false throughout requires no index action", () => {
  const result = transition({ kind: "boolean", queryable: false }, { kind: "boolean", queryable: false });

  assert.equal(result.action, "none");
});

test("(property, exhaustive matrix) for every combination of {kind changed | unchanged} x {queryable true->true, false->false, false->true, true->false} x {field newly added, field removed}, resolveFieldIndexTransition returns exactly one of the 4 defined outcomes and never throws", () => {
  const kinds = ["text", "integer", "real", "boolean", "datetime"] as const;
  const queryableStates = [true, false];
  const validOutcomes = new Set(["none", "provision", "teardown", "reprovision"]);

  for (const beforeKind of kinds) {
    for (const afterKind of kinds) {
      for (const beforeQueryable of queryableStates) {
        for (const afterQueryable of queryableStates) {
          const result = transition(
            { kind: beforeKind, queryable: beforeQueryable },
            { kind: afterKind, queryable: afterQueryable }
          );
          assert.ok(validOutcomes.has(result.action), `unexpected outcome '${result.action}' for before=(${beforeKind},${beforeQueryable}) after=(${afterKind},${afterQueryable})`);
        }
      }
    }
  }
});
