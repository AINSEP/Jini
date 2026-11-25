import { expect, it } from "vitest";

import { packHandlerEntities } from "../export-bundle.js";
import type { PublishContentHandler } from "../type-registry.js";
import type { PackedEntity } from "../../transfer/index.js";

/** @file The per-type authorization gate and packed-metadata check of `packAuthorizedEntities`,
 *  driven through its handler-list seam with hand-written handlers. */

function entity(entityType: string, id: string, schemaVersion = 1): PackedEntity {
  return { entityType, id, schemaVersion, contentHash: `hash-${id}`, hashVersion: 1, requiredBlobs: [], state: {} };
}

function fakeHandler(over: Partial<PublishContentHandler> & { entityType: string; permission: string }): PublishContentHandler {
  return {
    schemaVersion: 1,
    dependsOn: [],
    async *pack() {},
    async inspect() { return null; },
    async precheck() { return null; },
    async apply() { return { changeSetId: "cs1" }; },
    ...over,
  };
}

async function collect(handlers: PublishContentHandler[], allowed: ReadonlySet<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const packed of packHandlerEntities({ handlers, authorize: async ({ permission }) => ({ allowed: allowed.has(permission) }), workspaceId: "ws1", principalId: "p1" })) {
    out.push(`${packed.entityType}:${packed.id}`);
  }
  return out;
}

it("a type the principal may not write is left out of the bundle, without failing the export", async () => {
  let unauthorizedPacked = false;
  const handlers = [
    fakeHandler({ entityType: "post", permission: "content.write", async *pack() { yield entity("post", "p1"); } }),
    fakeHandler({ entityType: "theme-files", permission: "theme.set", async *pack() { unauthorizedPacked = true; yield entity("theme-files", "t1"); } }),
  ];
  expect(await collect(handlers, new Set(["content.write"]))).toStrictEqual(["post:p1"]);
  expect(unauthorizedPacked, "an unauthorized type is never even packed").toBe(false);
});

it("a handler that packs another type's entity, or a different schema version, fails the export loudly", async () => {
  const wrongType = [fakeHandler({ entityType: "post", permission: "content.write", async *pack() { yield entity("page", "x"); } })];
  await await expect(collect(wrongType, new Set(["content.write"]))).rejects.toThrow(/handler 'post' packed incompatible entity metadata \(entityType 'page', schema version 1; expected 'post' version 1\)/);
  const wrongVersion = [fakeHandler({ entityType: "post", permission: "content.write", async *pack() { yield entity("post", "x", 2); } })];
  await await expect(collect(wrongVersion, new Set(["content.write"]))).rejects.toThrow(/schema version 2; expected 'post' version 1/);
});
