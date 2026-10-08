import assert from "node:assert/strict";
import { test } from "vitest";

import { describeEachDialect } from "./support/dialect-matrix.fixture.js";
import type { ContentKernel } from "./support/dialect-matrix.fixture.js";
import { FormSlugConflictError } from "../index.js";
import { formDefinitionRepoFor, formSubmissionRepoFor } from "./support/repo-ports.fixture.js";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../index.js";

/**
 * @file Both forms repos on every dialect through the kernel's matrix (`describeEachDialect` + ONE
 * factory: one query body serves every dialect). Covers every public method: hit, miss,
 * other-workspace isolation, trashed-row handling and rollback.
 */

const WS = "ws-dialects";
const OTHER = "ws-other";
const T0 = "2026-09-28T00:00:00.000Z";

function definition(id: string, slug: string, overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id,
    workspaceId: WS,
    name: `Form ${slug}`,
    slug,
    fields: [{ id: "name", label: "Name", type: "text", required: true }],
    notify: { enabled: true, recipients: ["a@example.com"] },
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    version: 1,
    ...overrides,
  };
}

function submission(id: string, submittedAt: string, overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord {
  return {
    id,
    workspaceId: WS,
    formDefinitionId: "def-1",
    data: { name: `n-${id}`, agree: true },
    sourceIp: "203.0.113.9",
    submittedAt,
    ...overrides,
  };
}

function repos(kernel: ContentKernel) {
  return { kernel, defs: formDefinitionRepoFor(kernel), subs: formSubmissionRepoFor(kernel) };
}

describeEachDialect(
  "forms repos",
  { tables: ["form_definitions", "form_submissions"], make: repos },
  (makeRepos) => {
    const trash = (kernel: ContentKernel, table: "form_definitions" | "form_submissions", id: string) =>
      kernel.run((db) => db.updateTable(table).set({ deleted_at: T0 }).where("id", "=", id).execute());

    test("definition create then findById / findBySlug / list round-trip", async () => {
      const { defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await defs.create(definition("def-2", "survey"));
      await defs.create(definition("def-x", "contact", { workspaceId: OTHER }));
      assert.deepEqual(await defs.findById({ workspaceId: WS, id: "def-1" }), definition("def-1", "contact"));
      assert.deepEqual(await defs.findBySlug({ workspaceId: WS, slug: "survey" }), definition("def-2", "survey"));
      assert.deepEqual((await defs.list({ workspaceId: WS })).map((d) => d.id).sort(), ["def-1", "def-2"]);
    });

    test("definition reads miss unknown ids/slugs and never cross workspaces", async () => {
      const { defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      assert.equal(await defs.findById({ workspaceId: WS, id: "nope" }), null);
      assert.equal(await defs.findById({ workspaceId: OTHER, id: "def-1" }), null);
      assert.equal(await defs.findBySlug({ workspaceId: WS, slug: "nope" }), null);
      assert.equal(await defs.findBySlug({ workspaceId: OTHER, slug: "contact" }), null);
      assert.deepEqual(await defs.list({ workspaceId: OTHER }), []);
    });

    test("a duplicate slug throws FormSlugConflictError; another workspace may reuse it", async () => {
      const { defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await assert.rejects(
        defs.create(definition("def-2", "contact")),
        (err: unknown) => err instanceof FormSlugConflictError && /already exists/.test(err.message) && err.slug === "contact"
      );
      await defs.create(definition("def-3", "contact", { workspaceId: OTHER }));
      assert.equal((await defs.list({ workspaceId: WS })).length, 1);
    });

    test("a trashed row hides from reads but still holds its slug, with the Trash message", async () => {
      const { kernel, defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await trash(kernel, "form_definitions", "def-1");
      assert.equal(await defs.findById({ workspaceId: WS, id: "def-1" }), null);
      assert.equal(await defs.findBySlug({ workspaceId: WS, slug: "contact" }), null);
      assert.deepEqual(await defs.list({ workspaceId: WS }), []);
      assert.equal(await defs.isSlugTaken({ workspaceId: WS, slug: "contact" }), true);
      await assert.rejects(defs.create(definition("def-2", "contact")), /in the Trash/);
    });

    test("isSlugTaken: hit, miss and other workspace", async () => {
      const { defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      assert.equal(await defs.isSlugTaken({ workspaceId: WS, slug: "contact" }), true);
      assert.equal(await defs.isSlugTaken({ workspaceId: WS, slug: "nope" }), false);
      assert.equal(await defs.isSlugTaken({ workspaceId: OTHER, slug: "contact" }), false);
    });

    test("update rewrites the live row but never moves version; other workspaces and trashed rows are untouched", async () => {
      const { kernel, defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await defs.create(definition("def-t", "old"));
      await defs.create(definition("def-o", "contact", { workspaceId: OTHER }));
      await trash(kernel, "form_definitions", "def-t");
      await defs.update(definition("def-1", "contact", { name: "Renamed", fields: [], status: "disabled", updatedAt: "2026-09-29T00:00:00.000Z", version: 99 }));
      await defs.update(definition("def-t", "old", { name: "Ghost" }));
      await defs.update(definition("def-o", "contact", { workspaceId: WS, name: "Wrong ws" }));
      assert.deepEqual(
        await defs.findById({ workspaceId: WS, id: "def-1" }),
        definition("def-1", "contact", { name: "Renamed", fields: [], status: "disabled", updatedAt: "2026-09-29T00:00:00.000Z", version: 1 })
      );
      assert.equal((await defs.findById({ workspaceId: OTHER, id: "def-o" }))?.name, "Form contact");
      const trashed = await kernel.run((db) => db.selectFrom("form_definitions").select("name").where("id", "=", "def-t").executeTakeFirst());
      assert.equal(trashed?.name, "Form old");
    });

    test("submission create then findById round-trips; misses, other workspace and trashed rows return null", async () => {
      const { kernel, defs, subs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await subs.create(submission("s1", T0));
      await subs.create(submission("s2", T0));
      assert.deepEqual(await subs.findById({ workspaceId: WS, id: "s1" }), submission("s1", T0));
      assert.equal(await subs.findById({ workspaceId: WS, id: "nope" }), null);
      assert.equal(await subs.findById({ workspaceId: OTHER, id: "s1" }), null);
      await trash(kernel, "form_submissions", "s2");
      assert.equal(await subs.findById({ workspaceId: WS, id: "s2" }), null);
    });

    test("listByDefinition pages newest-first with an id tie-break and a cursor", async () => {
      const { defs, subs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await subs.create(submission("a", "2026-09-28T01:00:00.000Z"));
      await subs.create(submission("b", "2026-09-28T02:00:00.000Z"));
      await subs.create(submission("c", "2026-09-28T02:00:00.000Z"));
      await subs.create(submission("d", "2026-09-28T03:00:00.000Z"));
      const first = await subs.listByDefinition({ workspaceId: WS, formDefinitionId: "def-1", limit: 2 });
      assert.deepEqual(first.items.map((s) => s.id), ["d", "c"]);
      assert.equal(first.nextCursor, "c");
      const second = await subs.listByDefinition({ workspaceId: WS, formDefinitionId: "def-1", limit: 2, cursor: first.nextCursor });
      assert.deepEqual(second.items.map((s) => s.id), ["b", "a"]);
      assert.equal(second.nextCursor, null);
    });

    test("listByDefinition ignores an unknown cursor and excludes other definitions, workspaces and trashed rows", async () => {
      const { kernel, defs, subs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await defs.create(definition("def-2", "survey"));
      await defs.create(definition("def-w", "contact", { workspaceId: OTHER }));
      await subs.create(submission("a", "2026-09-28T01:00:00.000Z"));
      await subs.create(submission("t", "2026-09-28T02:00:00.000Z"));
      await subs.create(submission("o", "2026-09-28T03:00:00.000Z", { formDefinitionId: "def-2" }));
      await subs.create(submission("w", "2026-09-28T04:00:00.000Z", { workspaceId: OTHER, formDefinitionId: "def-w" }));
      await trash(kernel, "form_submissions", "t");
      const page = await subs.listByDefinition({ workspaceId: WS, formDefinitionId: "def-1", limit: 10, cursor: "unknown" });
      assert.deepEqual(page.items.map((s) => s.id), ["a"]);
      assert.equal(page.nextCursor, null);
      // A cursor id from another workspace resolves to nothing (first page), never leaks its position.
      const crossWs = await subs.listByDefinition({ workspaceId: WS, formDefinitionId: "def-1", limit: 10, cursor: "w" });
      assert.deepEqual(crossWs.items.map((s) => s.id), ["a"]);
      assert.deepEqual(await subs.listByDefinition({ workspaceId: WS, formDefinitionId: "empty", limit: 5 }), { items: [], nextCursor: null });
    });

    test("a transaction's definition + submission writes roll back together", async () => {
      const { kernel, defs, subs } = makeRepos();
      await assert.rejects(
        kernel.transaction(async () => {
          await defs.create(definition("def-1", "contact"));
          await subs.create(submission("s1", T0));
          throw new Error("boom");
        }),
        /boom/
      );
      assert.equal(await defs.findById({ workspaceId: WS, id: "def-1" }), null);
      assert.equal(await subs.findById({ workspaceId: WS, id: "s1" }), null);
    });

    test("a slug conflict inside a caller's transaction aborts the earlier writes too", async () => {
      const { kernel, defs } = makeRepos();
      await defs.create(definition("def-1", "contact"));
      await assert.rejects(
        kernel.transaction(async () => {
          await defs.create(definition("def-2", "fresh"));
          await defs.create(definition("def-3", "contact"));
        }),
        FormSlugConflictError
      );
      assert.equal(await defs.findBySlug({ workspaceId: WS, slug: "fresh" }), null);
    });
  }
);
