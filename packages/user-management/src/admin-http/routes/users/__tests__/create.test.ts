import { describe, expect, it } from "vitest";
import { createUser } from "../../../../server/grant-service.js";
import { normalizeUsername } from "../../../../server/username.js";
import { userCreateRoute } from "../create.js";
import { addUser, raw, refusalOf, seededIdentity, signal, trashIndex, WORKSPACE_ID } from "./helpers.js";

async function createDeps() {
  const { services, ownerId } = await seededIdentity();
  const trash = trashIndex();
  return { deps: { workspaceId: WORKSPACE_ID, createUser, normalizeUsername, identityServices: () => services, isInTrash: trash.isInTrash }, services, ownerId, trash };
}
const input = (overrides: Partial<{ username: string; email: string | undefined; password: string }> = {}) =>
  ({ username: "carol", email: undefined, password: "carol-p4ssw0rd!", ...overrides });

describe("userCreateRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect(userCreateRoute.method).toBe("post");
    expect(userCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users");
    expect(userCreateRoute.successStatus).toBe(201);
    expect(userCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses username, email and password off the untyped body with the host's fallbacks", () => {
    expect(userCreateRoute.parse(raw({}, { username: "a", email: 5, password: "p" }))).toEqual({ ok: true, value: { username: "a", email: "5", password: "p" } });
    expect(userCreateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { username: "", email: undefined, password: "" } });
  });

  it("creates the user through the real createUser and answers it with empty grants", async () => {
    const { deps, ownerId } = await createDeps();
    const result = await userCreateRoute.handle({ input: input({ email: "c@example.test" }), deps, context: { id: ownerId } }, { signal });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.user).toMatchObject({ username: "carol", email: "c@example.test", status: "active", roleIds: [], policyIds: [] });
  });

  it("maps an unauthorized caller to 403 FORBIDDEN with details", async () => {
    const { deps, services, ownerId } = await createDeps();
    const alice = await addUser({ services, ownerId, username: "alice" });
    const refusal = await refusalOf(() => userCreateRoute.handle({ input: input(), deps, context: { id: alice } }));
    expect(refusal.status).toBe(403);
    expect(refusal.body).toMatchObject({ code: "FORBIDDEN", details: { permission: "user.manage" } });
  });

  it("maps a duplicate username to 409 RESOURCE_CONFLICT, or USERNAME_IN_TRASH when its holder is trashed", async () => {
    const { deps, services, ownerId, trash } = await createDeps();
    const alice = await addUser({ services, ownerId, username: "alice" });
    const duplicate = await refusalOf(() => userCreateRoute.handle({ input: input({ username: "Alice" }), deps, context: { id: ownerId } }));
    expect(duplicate.status).toBe(409);
    expect(Object.keys(duplicate.body as object)).toEqual(["error", "code", "details"]);
    expect(duplicate.body).toMatchObject({ code: "RESOURCE_CONFLICT", details: { field: "username" } });
    trash.trashed.add(alice);
    expect(await refusalOf(() => userCreateRoute.handle({ input: input({ username: "alice" }), deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "a user with this username is in the Trash; restore or delete them permanently first", code: "USERNAME_IN_TRASH" },
    });
  });

  it("parses a request with no body at all as empty credentials", () => {
    expect(userCreateRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { username: "", email: undefined, password: "" } });
  });

  it("claims USERNAME_IN_TRASH only when the host normalizer finds the trashed holder itself", async () => {
    const { deps, services, ownerId, trash } = await createDeps();
    trash.trashed.add(await addUser({ services, ownerId, username: "alice" }));
    const conflictWith = async (normalize: typeof normalizeUsername) =>
      refusalOf(() => userCreateRoute.handle({ input: input({ username: "alice" }), deps: { ...deps, normalizeUsername: normalize }, context: { id: ownerId } }));
    for (const normalize of [() => "", () => "someone-else"]) {
      const refusal = await conflictWith(normalize);
      expect(refusal.status).toBe(409);
      expect(refusal.body).toMatchObject({ code: "RESOURCE_CONFLICT", details: { field: "username" } });
    }
  });

  it("maps a validation failure to 400 VALIDATION_ERROR", async () => {
    const { deps, ownerId } = await createDeps();
    const refusal = await refusalOf(() => userCreateRoute.handle({ input: input({ username: "" }), deps, context: { id: ownerId } }));
    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, services, ownerId } = await createDeps();
    const broken = { ...services, hasher: { hash: async () => { throw new Error("db down"); }, verify: async () => false } as never };
    await expect(userCreateRoute.handle({ input: input(), deps: { ...deps, identityServices: () => broken }, context: { id: ownerId } })).rejects.toThrow("db down");
    await expect(userCreateRoute.handle({ input: input(), deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
