import { expect, test } from "vitest";
import { ContentTypeAlreadyExistsError, InvalidFieldKindError } from "../errors.js";
import { buildQueryableFieldIndexName, mapFieldKindToCast, resolveFieldIndexTransition } from "../index-provisioning.js";

test("invalid index kinds retain useful error text without specification suffixes", () => {
  const kinds = "text|integer|real|boolean|datetime|relation";
  expect(() => mapFieldKindToCast({ kind: "json" })).toThrow(new InvalidFieldKindError({ message: `'json' is not an indexable field kind (${kinds})` }));
  expect(() => resolveFieldIndexTransition({ before: undefined, after: { kind: "json", queryable: true } }))
    .toThrow(new InvalidFieldKindError({ message: `storage-only kind 'json' reached index provisioning; only (${kinds}) may be queryable` }));
});

test("index identifier grammar errors retain the grammar and offending identifier without spec IDs", () => {
  expect(() => buildQueryableFieldIndexName({ workspaceId: "ws", contentTypeKey: "bad-key", fieldName: "title" }))
    .toThrow("content-type key 'bad-key' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$");
  expect(() => buildQueryableFieldIndexName({ workspaceId: "ws", contentTypeKey: "article", fieldName: "bad-field" }))
    .toThrow("field name 'bad-field' fails the identifier grammar gate ^[a-z][a-z0-9_]{0,63}$");
  expect(new ContentTypeAlreadyExistsError({ key: "article", tombstoned: true }).message)
    .toBe("content type 'article' was permanently deleted; its key can't be reused");
});
