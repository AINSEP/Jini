import { describe, expect, it } from "vitest";
import { parseContentTypeFieldDefs } from "../content-types/field-defs.js";
import { validateIdentifierGrammar, mapFieldKindToCast } from "../content-types/index-provisioning.js";
import { EntryFieldValidationError } from "../entries/errors.js";
import { parseMediaHtmlAttributes } from "../media/html-attributes.js";
import { InMemoryMediaRepo } from "../media/repo.memory.js";
import { withSha256Lock } from "../media/blob-gc-lock.js";
import { assertValidTransformParams } from "../media/transform-types.js";
import { validateFieldsAgainstSchema } from "../entries/field-validation.js";
import { isContentTypeOnAllowList } from "../taxonomy/write-service.js";
import { validateHierarchyAssignment } from "../taxonomy/validation-chain.js";
import { InMemoryWorkspaceRepo } from "../workspace/repo.memory.js";
import { SecretNotSupportedError, PurgeRequiredError } from "@jini-ai/core/settings";
import { executeCommand } from "../core/commands/command.js";
import type { ChangeSetItemRecord, ChangeSetRepoPort } from "../core/commands/change-set.js";
import type { DomainEvent } from "../core/ports.js";

describe("existing CMS APIs use required and optional argument objects", () => {
  it("keeps schema and identifier validation behavior", () => {
    expect(parseContentTypeFieldDefs({ value: [] })).toEqual({ ok: true, value: [] });
    expect(validateIdentifierGrammar({ value: "safe_key" })).toBe(true);
    expect(validateIdentifierGrammar({ value: "bad;drop" })).toBe(false);
    expect(mapFieldKindToCast({ kind: "integer" })).toBe("INTEGER");
  });

  it("retains error details and empty memory repositories", async () => {
    const fieldErrors = [{ field: "title", reason: "required" }];
    const error = new EntryFieldValidationError({ fieldErrors });
    expect(error.fieldErrors).toBe(fieldErrors);
    expect(error.message).toBe("fieldsJson failed schema validation: title: required");
    const repo = new InMemoryMediaRepo({});
    expect(await repo.list({ workspaceId: "workspace" })).toEqual([]);
  });

  it("preserves HTML parsing and taxonomy policy", () => {
    expect(parseMediaHtmlAttributes({ text: 'loading="lazy"' })).toEqual({ attributes: { loading: "lazy" }, error: null });
    expect(isContentTypeOnAllowList({ contentType: "post" })).toBe(true);
    expect(isContentTypeOnAllowList({ contentType: "unknown" })).toBe(false);
  });

  it("releases a keyed lock after failure and keeps queued work ordered", async () => {
    const calls: string[] = [];
    const failed = withSha256Lock({ key: "same", criticalSection: async () => {
      calls.push("first");
      throw new Error("expected failure");
    } });
    const next = withSha256Lock({ key: "same", criticalSection: async () => {
      calls.push("second");
      return 42;
    } });
    await expect(failed).rejects.toThrow("expected failure");
    await expect(next).resolves.toBe(42);
    expect(calls).toEqual(["first", "second"]);
  });

  it("uses optional dimensions and field ownership from the second object", () => {
    expect(() => assertValidTransformParams({ format: "webp" }, { width: 0 })).toThrow("params.width");
    expect(() => assertValidTransformParams({ format: "webp" }, { width: 100 })).not.toThrow();
    expect(validateFieldsAgainstSchema({
      schema: [{ name: "title", kind: "text", required: true, queryable: false }],
      fieldsJson: { ext: { article: { title: "Hello" } } },
    }, { owner: "article" })).toEqual({ valid: true, fieldErrors: [] });
  });

  it("passes cycle checks a named parent ID", () => {
    const parents: string[] = [];
    validateHierarchyAssignment({
      childTaxonomyId: "taxonomy", taxonomyIsHierarchical: true,
      candidateParentId: "parent", resolvedParent: { id: "parent", taxonomyId: "taxonomy" },
      termId: "child", wouldCreateCycle: ({ candidateParentId }) => {
        parents.push(candidateParentId);
        return false;
      },
    });
    expect(parents).toEqual(["parent"]);
  });

  it("keeps workspace queries and error causes explicit", async () => {
    const repo = new InMemoryWorkspaceRepo({});
    expect(await repo.findById({ id: "missing" })).toBeNull();
    expect(await repo.findBySlug({ slug: "missing" })).toBeNull();
    const cause = new Error("cause");
    expect(new SecretNotSupportedError({ message: "secret" }, { cause }).cause).toBe(cause);
    expect(new PurgeRequiredError({ message: "purge" }).message).toBe("purge");
  });

  it("records a scalar mutation result through a named callback argument and one atomic insert", async () => {
    const persisted: Array<{ items: ChangeSetItemRecord[]; event: DomainEvent | undefined }> = [];
    const changeSets: ChangeSetRepoPort = {
      insert: async ({ items }, { event } = {}) => { persisted.push({ items, event }); },
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      listByWorkspace: async () => [],
      save: async () => {},
    };
    let nextId = 0;
    const result = await executeCommand({
      deps: {
        clock: { nowMs: () => Date.parse("2026-10-01T00:00:00.000Z")},
        idGen: { newId: () => `id-${++nextId}` },
        changeSets,
        outbox: {
          enqueue: async () => { throw new Error("event must be persisted by the change-set insert"); },
          claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {},
        },
      },
      command: { workspaceId: "workspace", actor: { id: "human", kind: "user" }, summary: "Create entry" },
      mutation: {
        entityType: "entry", entityId: "entry", operation: "create",
        captureInverse: async () => null, execute: async () => 7,
        captureEntityVersion: ({ result }) => result,
      },
    });
    expect(result.result).toBe(7);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.items[0]?.entityVersionAtApply).toBe(7);
    expect(persisted[0]?.event?.changeSetId).toBe(result.changeSetId);
  });
});
