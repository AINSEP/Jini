import { describe, expect, it } from "vitest";

import { ContentTypeNotFoundError, EntryFieldValidationError, ForbiddenError, VersionConflictError } from "../errors.js";
import type { AuthorizeFn, ContentTypeLookupPort, EntryRepoPort, EntryRevisionInput, EntrySaveOptions, OutboxPort, WatermarkPort } from "../write-service.js";
import { createEntry, importEntry, publishEntry, updateEntry } from "../write-service.js";
import type { EntryRecord, OwningContentType } from "../types.js";

/**
 * @file Boundary pins for the `entries` write chokepoint: the optional same-transaction side effects
 * (watermark, `onWritten`) on every write path, the exact `save` call shape per path, `updateEntry`'s
 * keep-or-replace rule per field, and `importEntry`'s create-vs-update record and revision shape.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
const allow: AuthorizeFn = async () => ({ allowed: true, reason: "matched" });
const deny: AuthorizeFn = async () => ({ allowed: false, reason: "no grant" });

interface Recorder {
  log: string[];
  saves: Array<{ row: EntryRecord; argCount: number; options: EntrySaveOptions | undefined }>;
  revisions: EntryRevisionInput[];
  events: Array<{ name: string; payload: Record<string, unknown> }>;
}

function harness(seed: EntryRecord[] = [], contentType: OwningContentType | null = type()) {
  const rec: Recorder = { log: [], saves: [], revisions: [], events: [] };
  const rows = [...seed];
  const entryRepo: EntryRepoPort = {
    findBySlug: async (p) => rows.find((r) => r.workspaceId === p.workspaceId && r.type === p.type && r.slug === p.slug) ?? null,
    findById: async (p) => rows.find((r) => r.workspaceId === p.workspaceId && r.id === p.id) ?? null,
    save: async (...args: [EntryRecord, EntrySaveOptions?]) => {
      rec.log.push("save");
      rec.saves.push({ row: args[0], argCount: args.length, options: args[1] });
    },
    appendRevision: async (r) => {
      rec.log.push("revision");
      rec.revisions.push(r);
    },
    transaction: async ({ fn }) => {
      rec.log.push("begin");
      const out = await fn();
      rec.log.push("commit");
      return out;
    },
  };
  const contentTypeRepo: ContentTypeLookupPort = { findByKey: async () => contentType };
  const outbox: OutboxPort = { enqueue: async (e) => { rec.log.push("outbox"); rec.events.push(e); } };
  const watermark: WatermarkPort = { stampWatermark: async (i) => { rec.log.push(`watermark:${i.workspaceId}`); return 1; } };
  const onWritten = async (e: EntryRecord) => { rec.log.push(`onWritten:${e.id}@${e.version}`); };
  return { rec, entryRepo, contentTypeRepo, outbox, watermark, onWritten };
}

function type(overrides: Partial<OwningContentType> = {}): OwningContentType {
  return { workspaceId: "ws-1", key: "recipe", status: "active", fields: [{ name: "title", kind: "text", required: false, queryable: false }], ...overrides };
}

function row(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id: "e-1", workspaceId: "ws-1", type: "recipe", slug: "pie", status: "draft", title: "Pie",
    bodyJson: { doc: 1 }, fieldsJson: { ext: { site: { title: "old" } } }, publishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 3, ...overrides,
  };
}

const actor = { actorId: "user-1" };

function asFieldError(error: Error): EntryFieldValidationError {
  if (!(error instanceof EntryFieldValidationError)) throw new Error(`expected EntryFieldValidationError, got ${error.name}: ${error.message}`);
  return error;
}

describe("createEntry", () => {
  it("runs watermark then onWritten inside the transaction, before the outbox event", async () => {
    const h = harness();
    await createEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, ids: { newId: () => "new-1" }, authorize: allow, outbox: h.outbox, watermark: h.watermark, onWritten: h.onWritten },
      input: { ...actor, workspaceId: "ws-1", type: "recipe", slug: "s", title: "T", fieldsJson: { ext: { site: {} } } },
    });
    expect(h.rec.log).toEqual(["begin", "save", "revision", "watermark:ws-1", "onWritten:new-1@1", "commit", "outbox"]);
  });

  it("saves without a save-options argument (an unconditional write of a fresh id)", async () => {
    const h = harness();
    await createEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, ids: { newId: () => "new-1" }, authorize: allow, outbox: h.outbox },
      input: { ...actor, workspaceId: "ws-1", type: "recipe", slug: "s", title: "T", fieldsJson: { ext: { site: {} } } },
    });
    expect(h.rec.saves.map((s) => s.argCount)).toEqual([1]);
  });

  it("records the actor's delegation fields on the revision, defaulting each to null", async () => {
    const h = harness();
    await createEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, ids: { newId: () => "new-1" }, authorize: allow, outbox: h.outbox },
      input: { ...actor, delegatedById: "agent-9", workspaceId: "ws-1", type: "recipe", slug: "s", title: "T", fieldsJson: { ext: { site: {} } } },
    });
    expect(h.rec.revisions[0]).toMatchObject({ op: "create", actorId: "user-1", delegatedById: "agent-9", delegatedByWorkspaceId: null, recordedAt: NOW });
  });

  it("refuses a content type owned by another workspace as not found", async () => {
    const h = harness([], type({ workspaceId: "ws-2" }));
    const result = await createEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, ids: { newId: () => "new-1" }, authorize: allow, outbox: h.outbox },
      input: { ...actor, workspaceId: "ws-1", type: "recipe", slug: "s", title: "T", fieldsJson: { ext: { site: {} } } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ContentTypeNotFoundError);
    expect(result.error.message).toBe("content type 'recipe' was not found in workspace 'ws-1'");
  });
});

describe("updateEntry", () => {
  function update(h: ReturnType<typeof harness>, input: { title?: string; fieldsJson?: unknown; bodyJson?: unknown }) {
    return updateEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, authorize: allow, outbox: h.outbox, watermark: h.watermark, onWritten: h.onWritten },
      input: { ...actor, workspaceId: "ws-1", id: "e-1", expectedVersion: 3, ...input },
    });
  }

  it("keeps title, fieldsJson and bodyJson when none are supplied, and bumps version", async () => {
    const h = harness([row()]);
    const result = await update(h, {});
    expect(result).toEqual({ ok: true, value: { entry: { ...row(), updatedAt: NOW, version: 4 } } });
  });

  it("replaces bodyJson with a supplied null rather than keeping the current body", async () => {
    const h = harness([row()]);
    const result = await update(h, { bodyJson: null });
    expect(result.ok && result.value.entry.bodyJson).toBeNull();
  });

  it("replaces title and fieldsJson when supplied", async () => {
    const h = harness([row()]);
    const fieldsJson = { ext: { site: { title: "new" } } };
    const result = await update(h, { title: "Tart", fieldsJson });
    expect(result.ok && { title: result.value.entry.title, fieldsJson: result.value.entry.fieldsJson }).toEqual({ title: "Tart", fieldsJson });
  });

  it("saves with the caller's expectedVersion and runs watermark then onWritten in the transaction", async () => {
    const h = harness([row()]);
    await update(h, {});
    expect(h.rec.saves[0]?.options).toEqual({ expectedVersion: 3 });
    expect(h.rec.log).toEqual(["begin", "save", "revision", "watermark:ws-1", "onWritten:e-1@4", "commit", "outbox"]);
  });

  it("validates fieldsJson against an empty site schema when the owning type no longer exists", async () => {
    const h = harness([row()], null);
    const result = await update(h, { fieldsJson: { ext: { site: { title: "x" } } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = asFieldError(result.error);
    expect(error.fieldErrors).toEqual([{ field: "title", reason: "unrecognized field: not present in the current content-type schema" }]);
    expect(error.entitySchema).toEqual({ type: "recipe", owner: "site", fields: [] });
  });

  it("validates fieldsJson under the owning type's own owner namespace", async () => {
    const h = harness([row()], type({ owner: "widget" }));
    const result = await update(h, { fieldsJson: { ext: { site: { title: "x" } } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(asFieldError(result.error).entitySchema).toEqual({ type: "recipe", owner: "widget", fields: type().fields });
  });
});

describe("importEntry", () => {
  function importInput(overrides: { expectedVersion?: number | undefined; fieldsJson?: unknown } = {}) {
    return {
      ...actor, workspaceId: "ws-1", id: "e-1", type: "recipe", slug: "pie", title: "Imported", status: "published" as const,
      fieldsJson: { ext: { site: {} } }, publishedAt: "2026-06-01T00:00:00.000Z", expectedVersion: undefined, ...overrides,
    };
  }
  function deps(h: ReturnType<typeof harness>, authorize: AuthorizeFn = allow) {
    return { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, authorize, outbox: h.outbox, watermark: h.watermark, onWritten: h.onWritten };
  }

  it("an import-as-create saves with expectedVersion null, revision op create, version 1, bodyJson null", async () => {
    const h = harness();
    const result = await importEntry({ deps: deps(h), input: importInput() });
    expect(h.rec.saves[0]?.options).toEqual({ expectedVersion: null });
    expect(h.rec.revisions[0]?.op).toBe("create");
    expect(result.ok && result.value.entry).toEqual({
      id: "e-1", workspaceId: "ws-1", type: "recipe", slug: "pie", status: "published", title: "Imported", bodyJson: null,
      fieldsJson: { ext: { site: {} } }, publishedAt: "2026-06-01T00:00:00.000Z", createdAt: NOW, updatedAt: NOW, version: 1,
    });
  });

  it("an import-as-update keeps createdAt, bumps version, and records revision op update", async () => {
    const h = harness([row()]);
    const result = await importEntry({ deps: deps(h), input: importInput({ expectedVersion: 3 }) });
    expect(h.rec.saves[0]?.options).toEqual({ expectedVersion: 3 });
    expect(h.rec.revisions[0]?.op).toBe("update");
    expect(result.ok && { createdAt: result.value.entry.createdAt, version: result.value.entry.version }).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", version: 4 });
  });

  it("runs watermark then onWritten inside the transaction, before the outbox event", async () => {
    const h = harness();
    await importEntry({ deps: deps(h), input: importInput() });
    expect(h.rec.log).toEqual(["begin", "save", "revision", "watermark:ws-1", "onWritten:e-1@1", "commit", "outbox"]);
    expect(h.rec.events).toEqual([{ name: "entry.imported", payload: { workspaceId: "ws-1", entryId: "e-1", type: "recipe", slug: "pie" } }]);
  });

  it("names the import and the entry id in the FORBIDDEN message", async () => {
    const h = harness();
    const result = await importEntry({ deps: deps(h, deny), input: importInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ForbiddenError);
    expect(result.error.message).toBe("principal 'user-1' cannot import entry 'e-1' (no grant)");
  });

  it("refuses a content type owned by another workspace as not found", async () => {
    const h = harness([], type({ workspaceId: "ws-2" }));
    const result = await importEntry({ deps: deps(h), input: importInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ContentTypeNotFoundError);
    expect(result.error.message).toBe("content type 'recipe' was not found in workspace 'ws-1'");
  });

  it("reports the owning type's key and owner in a field-validation refusal", async () => {
    const h = harness([], type({ owner: "widget" }));
    const result = await importEntry({ deps: deps(h), input: importInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(asFieldError(result.error).entitySchema).toEqual({ type: "recipe", owner: "widget", fields: type().fields });
  });

  it("exact text for an existing id imported without expectedVersion", async () => {
    const h = harness([row()]);
    const result = await importEntry({ deps: deps(h), input: importInput() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(VersionConflictError);
    expect(result.error.message).toBe("entry 'e-1' already exists in workspace 'ws-1', but no expectedVersion was supplied for import");
  });

  it("exact text for an expectedVersion against a missing id", async () => {
    const h = harness();
    const result = await importEntry({ deps: deps(h), input: importInput({ expectedVersion: 2 }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(VersionConflictError);
    expect(result.error.message).toBe("expected version 2 for entry 'e-1', but no such entry exists");
  });

  it("checks the version before the type: a stale version on a different-type row reports the version", async () => {
    const h = harness([row({ type: "other" })]);
    const result = await importEntry({ deps: deps(h), input: importInput({ expectedVersion: 1 }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("expected version 1 for entry 'e-1', found 3");
  });
});

describe("publishEntry", () => {
  it("stamps the watermark inside the transaction and never calls onWritten", async () => {
    const h = harness([row()]);
    await publishEntry({
      deps: { entryRepo: h.entryRepo, contentTypeRepo: h.contentTypeRepo, clock, authorize: allow, outbox: h.outbox, watermark: h.watermark, onWritten: h.onWritten },
      input: { ...actor, workspaceId: "ws-1", id: "e-1", expectedVersion: 3 },
    });
    expect(h.rec.log).toEqual(["begin", "save", "revision", "watermark:ws-1", "commit", "outbox"]);
    expect(h.rec.saves[0]?.options).toEqual({ expectedVersion: 3 });
  });
});
