import { describe, expect, it } from "vitest";
import {
  fsCustomRootDeleteRoute, fsCustomRootGetRoute, fsCustomRootPutRoute,
  type FsCustomRootDeleteRouteDeps, type FsCustomRootGetRouteDeps, type FsCustomRootPutRouteDeps,
} from "../custom-root.js";
import {
  isFakeInvalidRootError, MANAGE_PERMISSION, makeRootStore, PRINCIPAL, raw, READ_PERMISSION, recordingAuthorize, refusalOf, signal, WORKSPACE_ID,
  FakeInvalidRootError,
} from "./helpers.js";

const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/fs-files/custom-root";

function getDeps(store = makeRootStore()): FsCustomRootGetRouteDeps {
  return { workspaceId: WORKSPACE_ID, readPermission: READ_PERMISSION, readCustomRoot: store.readCustomRoot };
}
function putDeps(store = makeRootStore()): FsCustomRootPutRouteDeps {
  return { workspaceId: WORKSPACE_ID, managePermission: MANAGE_PERMISSION, readCustomRoot: store.readCustomRoot, writeCustomRoot: store.writeCustomRoot, isInvalidRootError: isFakeInvalidRootError };
}
function deleteDeps(store = makeRootStore()): FsCustomRootDeleteRouteDeps {
  return { workspaceId: WORKSPACE_ID, managePermission: MANAGE_PERMISSION, writeCustomRoot: store.writeCustomRoot };
}

describe("fsCustomRootGetRoute", () => {
  it("keeps the method, path and default status, with no body cap of its own", () => {
    expect(fsCustomRootGetRoute.method).toBe("get");
    expect(fsCustomRootGetRoute.path).toBe(BASE_PATH);
    expect(fsCustomRootGetRoute.successStatus).toBeUndefined();
    expect(fsCustomRootGetRoute.maxBodyBytes).toBeUndefined();
    expect(fsCustomRootGetRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("authorizes the injected read permission on no entity, with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: READ_PERMISSION }]);
    // The hand-written route asked the host authorizer for the permission and workspace only — no
    // entity type — so a resource-scoped grant can never widen or narrow this decision.
    expect(Object.keys(calls[0]!)).toEqual(["permission"]);
    expect("entityId" in calls[0]!).toBe(false);
  });

  it("answers { path: null } before anything was set and the stored path afterwards", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore();
    expect(await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(store), context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { path: null } });
    store.writeCustomRoot({ workspaceId: WORKSPACE_ID, path: "/srv/files" });
    expect(await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(store), context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { path: "/srv/files" } });
  });

  it("reports a vanished folder honestly, with the extra keys only then", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore({ [WORKSPACE_ID]: "/srv/gone" });
    store.vanish(WORKSPACE_ID);
    expect(await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(store), context: PRINCIPAL, authorize })).toEqual({
      ok: true, value: { path: null, vanished: true, vanishedPath: "/srv/gone" },
    });
    const plain = await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(), context: PRINCIPAL, authorize });
    expect(plain.ok && Object.keys(plain.value)).toEqual(["path"]);
  });

  it("reads only the served workspace's root", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore({ "ws-other": "/srv/other" });
    expect(await fsCustomRootGetRoute.handle({ input: {}, deps: getDeps(store), context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { path: null } });
  });

  it("does not read the store when authorization refuses, and fails closed without an authorizer", async () => {
    let reads = 0;
    const deps = { ...getDeps(), readCustomRoot: () => { reads += 1; return { path: undefined, vanished: false }; } };
    await expect(fsCustomRootGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize([READ_PERMISSION]).authorize })).rejects.toThrow("denied");
    await expect(fsCustomRootGetRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });

  it("lets a store failure through unchanged for the host's redacted 500", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { ...getDeps(), readCustomRoot: () => { throw new Error("EACCES: site dir"); } };
    await expect(fsCustomRootGetRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize })).rejects.toThrow("EACCES: site dir");
  });
});

describe("fsCustomRootPutRoute", () => {
  it("keeps the method, path and default status, with no body cap of its own", () => {
    expect(fsCustomRootPutRoute.method).toBe("put");
    expect(fsCustomRootPutRoute.path).toBe(BASE_PATH);
    expect(fsCustomRootPutRoute.successStatus).toBeUndefined();
    expect(fsCustomRootPutRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the body's path as-is and never refuses (validation waits for authorization)", () => {
    expect(fsCustomRootPutRoute.parse(raw({ path: "/srv/files" }))).toEqual({ ok: true, value: { path: "/srv/files" } });
    expect(fsCustomRootPutRoute.parse(raw({ path: 42 }))).toEqual({ ok: true, value: { path: 42 } });
    for (const body of [undefined, null, "text", 7, [], {}]) {
      expect(fsCustomRootPutRoute.parse(raw(body))).toEqual({ ok: true, value: { path: undefined } });
    }
  });

  it("authorizes the injected manage permission on no entity, with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps: putDeps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: MANAGE_PERMISSION }]);
    // The hand-written route asked the host authorizer for the permission and workspace only — no
    // entity type — so a resource-scoped grant can never widen or narrow this decision.
    expect(Object.keys(calls[0]!)).toEqual(["permission"]);
    expect("entityId" in calls[0]!).toBe(false);
  });

  it("stores the path for the served workspace and answers the store's resulting path", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore();
    expect(await fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps: putDeps(store), context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { path: "/srv/files" } });
    expect(store.writes).toEqual([{ workspaceId: WORKSPACE_ID, path: "/srv/files" }]);
  });

  it("answers the path the store resolved, not the one the caller sent", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore();
    const deps = { ...putDeps(store), writeCustomRoot: ({ workspaceId }: { workspaceId: string }) => store.writeCustomRoot({ workspaceId, path: "/canonical/files" }) };
    expect(await fsCustomRootPutRoute.handle({ input: { path: "/link/files" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { path: "/canonical/files" } });
  });

  for (const path of [undefined, "", 42, null, ["/a"], { path: "/a" }]) {
    it(`refuses ${JSON.stringify(path)} with the exact VALIDATION_ERROR body and writes nothing`, async () => {
      const { authorize } = recordingAuthorize();
      const store = makeRootStore();
      expect(await refusalOf(() => fsCustomRootPutRoute.handle({ input: { path }, deps: putDeps(store), context: PRINCIPAL, authorize }))).toEqual({
        status: 400, body: { error: "'path' is required and must be a non-empty string", code: "VALIDATION_ERROR" },
      });
      expect(store.writes).toEqual([]);
    });
  }

  it("asks permission before validating, so a caller without the grant sees the denial whatever it sent", async () => {
    const store = makeRootStore();
    const { authorize } = recordingAuthorize([MANAGE_PERMISSION]);
    await expect(fsCustomRootPutRoute.handle({ input: { path: undefined }, deps: putDeps(store), context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    await expect(fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps: putDeps(store), context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(store.writes).toEqual([]);
  });

  it("maps the host's invalid-path error to a 400 INVALID_PATH carrying its own message", async () => {
    const { authorize } = recordingAuthorize();
    const store = makeRootStore();
    expect(await refusalOf(() => fsCustomRootPutRoute.handle({ input: { path: "relative/dir" }, deps: putDeps(store), context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'relative/dir' must be an absolute path", code: "INVALID_PATH" },
    });
  });

  it("uses the injected classifier, not a built-in one", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { ...putDeps(), isInvalidRootError: () => false };
    await expect(fsCustomRootPutRoute.handle({ input: { path: "relative/dir" }, deps, context: PRINCIPAL, authorize })).rejects.toBeInstanceOf(FakeInvalidRootError);
  });

  it("rethrows an unclassified failure unchanged for the host's redacted 500", async () => {
    const { authorize } = recordingAuthorize();
    const failure = new Error("EACCES: cannot write site dir");
    const deps = { ...putDeps(), writeCustomRoot: () => { throw failure; } };
    await expect(fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps, context: PRINCIPAL, authorize })).rejects.toBe(failure);
  });

  it("also rethrows a failure of the read-back after a successful write", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { ...putDeps(), readCustomRoot: () => { throw new Error("read-back failed"); } };
    await expect(fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("read-back failed");
  });

  it("fails closed without an authorizer", async () => {
    await expect(fsCustomRootPutRoute.handle({ input: { path: "/srv/files" }, deps: putDeps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});

describe("fsCustomRootDeleteRoute", () => {
  it("keeps the method, path and default status, with no body cap of its own", () => {
    expect(fsCustomRootDeleteRoute.method).toBe("delete");
    expect(fsCustomRootDeleteRoute.path).toBe(BASE_PATH);
    expect(fsCustomRootDeleteRoute.successStatus).toBeUndefined();
    expect(fsCustomRootDeleteRoute.maxBodyBytes).toBeUndefined();
    expect(fsCustomRootDeleteRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("authorizes the injected manage permission on no entity, clears the served workspace's root and answers { path: null }", async () => {
    const { authorize, calls } = recordingAuthorize();
    const store = makeRootStore({ [WORKSPACE_ID]: "/srv/files", "ws-other": "/srv/other" });
    expect(await fsCustomRootDeleteRoute.handle({ input: {}, deps: deleteDeps(store), context: PRINCIPAL, authorize }, { signal })).toEqual({ ok: true, value: { path: null } });
    expect(calls).toEqual([{ permission: MANAGE_PERMISSION }]);
    // The hand-written route asked the host authorizer for the permission and workspace only — no
    // entity type — so a resource-scoped grant can never widen or narrow this decision.
    expect(Object.keys(calls[0]!)).toEqual(["permission"]);
    expect(store.writes).toEqual([{ workspaceId: WORKSPACE_ID, path: null }]);
    expect(store.readCustomRoot({ workspaceId: WORKSPACE_ID }).path).toBeUndefined();
    expect(store.readCustomRoot({ workspaceId: "ws-other" }).path).toBe("/srv/other");
  });

  it("clears nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const store = makeRootStore({ [WORKSPACE_ID]: "/srv/files" });
    await expect(fsCustomRootDeleteRoute.handle({ input: {}, deps: deleteDeps(store), context: PRINCIPAL, authorize: recordingAuthorize([MANAGE_PERMISSION]).authorize })).rejects.toThrow("denied");
    await expect(fsCustomRootDeleteRoute.handle({ input: {}, deps: deleteDeps(store), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(store.writes).toEqual([]);
  });

  it("lets a store failure through unchanged for the host's redacted 500", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { ...deleteDeps(), writeCustomRoot: () => { throw new Error("EACCES: site dir"); } };
    await expect(fsCustomRootDeleteRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize })).rejects.toThrow("EACCES: site dir");
  });
});
