/**
 * @file Named transform registry tests (ADR-027 §4) — `transform-registry.ts`
 * / `transform-types.ts`. Covers: registering a definition, append-only
 * immutability across redefinition (old version rows never mutated), version
 * numbering, validation, and the `isLatestTransformVersion` query the
 * anonymous-generation bound depends on.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getLatestTransformDefinition,
  isLatestTransformVersion,
  isReferencedByPublishedContent,
  registerTransform,
  TransformValidationError,
} from "../transform-registry.js";
import { InMemoryTransformDefinitionRepo } from "../repo.memory.js";

const WORKSPACE_ID = "workspace-1";

function makeDeps() {
  let counter = 0;
  return {
    clock: { nowIso: () => "2026-07-10T00:00:00.000Z" },
    idGen: { newId: () => `id-${(counter += 1)}` },
    transformRepo: new InMemoryTransformDefinitionRepo(),
  };
}

test("registerTransform mints version 1 for a never-before-seen name", async () => {
  const deps = makeDeps();

  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumbnail", params: { width: 200, height: 200, format: "webp" }, owner: "core" },
  });

  assert.equal(definition.name, "thumbnail");
  assert.equal(definition.version, 1);
  assert.equal(definition.owner, "core");
  assert.deepEqual(definition.params, { width: 200, height: 200, format: "webp" });
});

test("registerTransform append-only: redefining a name mints a new version and never mutates the old version's row", async () => {
  const deps = makeDeps();

  const { definition: v1 } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumbnail", params: { width: 200, height: 200, format: "webp" }, owner: "core" },
  });
  const { definition: v2 } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumbnail", params: { width: 400, height: 400, format: "webp" }, owner: "core" },
  });

  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.notEqual(v1.id, v2.id);

  // The old version's row, re-read from the repo, is byte-for-byte unchanged.
  const v1Reread = await deps.transformRepo.findByNameVersion({ workspaceId: WORKSPACE_ID, name: "thumbnail", version: 1 });
  assert.deepEqual(v1Reread, v1);

  const allVersions = await deps.transformRepo.listByName({ workspaceId: WORKSPACE_ID, name: "thumbnail" });
  assert.equal(allVersions.length, 2, "both versions coexist — the old one was never deleted");
});

test("InMemoryTransformDefinitionRepo.insert rejects a duplicate (workspaceId, name, version) — defends the append-only contract at the adapter boundary", async () => {
  const deps = makeDeps();
  const { definition } = await registerTransform({
    deps,
    input: { workspaceId: WORKSPACE_ID, name: "thumbnail", params: { format: "jpeg" }, owner: "core" },
  });

  await assert.rejects(
    () => deps.transformRepo.insert(definition),
    /already exists — append-only violation/
  );
});

test("registerTransform rejects invalid params (bad format, out-of-range dimension, fit without both dimensions)", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () =>
      registerTransform({
        deps,
        // @ts-expect-error deliberately invalid format for the validation test
        input: { workspaceId: WORKSPACE_ID, name: "bad", params: { format: "bmp" }, owner: "core" },
      }),
    TransformValidationError
  );

  await assert.rejects(
    () =>
      registerTransform({
        deps,
        input: { workspaceId: WORKSPACE_ID, name: "bad", params: { width: 999999, format: "jpeg" }, owner: "core" },
      }),
    TransformValidationError
  );

  await assert.rejects(
    () =>
      registerTransform({
        deps,
        input: { workspaceId: WORKSPACE_ID, name: "bad", params: { width: 100, fit: "cover", format: "jpeg" }, owner: "core" },
      }),
    TransformValidationError,
    "fit requires both width and height"
  );

  await assert.rejects(
    () =>
      registerTransform({
        deps,
        input: { workspaceId: WORKSPACE_ID, name: "", params: { format: "jpeg" }, owner: "core" },
      }),
    TransformValidationError,
    "empty name is rejected"
  );
});

test("isLatestTransformVersion is true only for the current max version of a name", async () => {
  const deps = makeDeps();
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "hero", params: { format: "jpeg" }, owner: "core" } });
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "hero", params: { format: "webp" }, owner: "core" } });
  await registerTransform({ deps, input: { workspaceId: WORKSPACE_ID, name: "hero", params: { format: "png" }, owner: "core" } });

  assert.equal(
    await isLatestTransformVersion({ deps: { transformRepo: deps.transformRepo }, input: { workspaceId: WORKSPACE_ID, name: "hero", version: 3 } }),
    true
  );
  assert.equal(
    await isLatestTransformVersion({ deps: { transformRepo: deps.transformRepo }, input: { workspaceId: WORKSPACE_ID, name: "hero", version: 1 } }),
    false
  );
  assert.equal(
    await isLatestTransformVersion({ deps: { transformRepo: deps.transformRepo }, input: { workspaceId: WORKSPACE_ID, name: "hero", version: 2 } }),
    false
  );
});

test("getLatestTransformDefinition returns null for a name that was never registered", async () => {
  const deps = makeDeps();
  const latest = await getLatestTransformDefinition({ deps: { transformRepo: deps.transformRepo }, input: { workspaceId: WORKSPACE_ID, name: "never-registered" } });
  assert.equal(latest, null);
});

test("isReferencedByPublishedContent is a disclosed stub that always reports false", () => {
  assert.equal(isReferencedByPublishedContent({ workspaceId: WORKSPACE_ID, name: "anything", version: 1 }), false);
});

test("registerTransform serializes concurrent registrations of the same name into strictly increasing, non-colliding versions", async () => {
  const deps = makeDeps();

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      registerTransform({
        deps,
        input: { workspaceId: WORKSPACE_ID, name: "concurrent", params: { width: 10 + i, format: "jpeg" }, owner: "core" },
      })
    )
  );

  const versions = results.map((r) => r.definition.version).sort((a, b) => a - b);
  assert.deepEqual(versions, [1, 2, 3, 4, 5], "no two concurrent registrations collided on the same version number");
});
