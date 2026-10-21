/**
 * @file The universal `redirects` entry and the Node-only `redirects/sql` entry re-export their
 * owning modules' runtime bindings unchanged (same identities), and the universal entry carries no
 * SQL adapter.
 */
import { expect, test } from "vitest";
import * as entry from "../index.js";
import * as sqlEntry from "../sql/index.js";
import * as types from "../types.js";
import * as ports from "../ports.js";
import * as matcher from "../matcher.js";
import * as order from "../order.js";
import * as referrerAlias from "../referrer-alias.js";
import * as reservedDestination from "../reserved-destination.js";
import * as repoMemory from "../repo.memory.js";
import * as capture from "../capture.js";
import * as resolver from "../resolver.js";
import * as hitSink from "../hit-sink.js";
import * as redirects from "../redirects.js";
import * as targetGate from "../target-gate.js";
import * as sqlRepo from "../sql/repo.js";
import * as sqlRows from "../sql/repo.rows.js";
import * as portsInternal from "../ports.internal.js";

function expectReexports(barrel: object, owners: object[]) {
  const expected = Object.assign({}, ...owners.map((owner) => ({ ...owner })));
  expect(Object.keys(barrel).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, binding] of Object.entries(expected)) expect((barrel as Record<string, unknown>)[name], name).toBe(binding);
}

test("the redirects entry re-exports every runtime binding of its framework-free modules, and no SQL adapter", () => {
  expectReexports(entry, [types, ports, matcher, order, referrerAlias, reservedDestination, repoMemory, capture, resolver, hitSink, redirects, targetGate]);
  expect("SqlRedirectRepo" in entry).toBe(false);
});

test("the redirects/sql entry exposes the SQL repo, row mappers and the shared insert helper", () => {
  const { SqlRedirectRepo, redirectRepoFor } = sqlRepo;
  const { toRecord, toRow, toRevision, toRevisionRow, updatableColumns } = sqlRows;
  const { insertRedirectAndRevision } = portsInternal;
  expectReexports(sqlEntry, [{ SqlRedirectRepo, redirectRepoFor, toRecord, toRow, toRevision, toRevisionRow, updatableColumns, insertRedirectAndRevision }]);
});
