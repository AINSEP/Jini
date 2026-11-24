import assert from "node:assert/strict";
import { test } from "vitest";

import { credentialCreateTarget, credentialScopes, type CredentialProjectHalf } from "../project-scope.js";

const invalid = (message: string) => new RangeError(message);
const sealer = { seal: () => "sealed" } as never;
const keyring = { deriveSigningSecret: () => Buffer.alloc(0) } as never;

function depsWith(project?: CredentialProjectHalf<unknown>) {
  return { repo: { id: "site-repo", ...(project ? { project } : {}) }, sealer: "site-sealer", keyring: "site-keyring" };
}

test("credentialScopes returns only the site scope when no owner half is attached", () => {
  const deps = depsWith();
  assert.deepEqual(credentialScopes({ deps, workspaceId: "ws-site" }), [{ deps, workspaceId: "ws-site", scope: "site" }]);
});

test("credentialScopes lists the site first, then the owner half with its own repo, sealer, keyring and workspace", () => {
  const project = { workspaceId: "ws-project", repo: { id: "project-repo" }, sealer, keyring };
  const deps = depsWith(project);
  const scopes = credentialScopes({ deps, workspaceId: "ws-site" });
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes[0], { deps, workspaceId: "ws-site", scope: "site" });
  assert.equal(scopes[1]?.scope, "project");
  assert.equal(scopes[1]?.workspaceId, "ws-project");
  assert.equal(scopes[1]?.deps.repo, project.repo);
  assert.equal((scopes[1]?.deps as unknown as { sealer: unknown }).sealer, sealer);
  assert.equal((scopes[1]?.deps as unknown as { keyring: unknown }).keyring, keyring);
});

test("credentialCreateTarget rejects a scope other than omitted, site or project with the store's own error", () => {
  assert.throws(() => credentialCreateTarget({ deps: depsWith(), input: { workspaceId: "ws", scope: "elsewhere" }, invalid }), (error: unknown) =>
    error instanceof RangeError && error.message === 'scope must be "site" or "project"');
});

test("credentialCreateTarget writes to the site vault without an owner store or on an explicit site save", () => {
  const plain = depsWith();
  assert.deepEqual(credentialCreateTarget({ deps: plain, input: { workspaceId: "ws" }, invalid }), { deps: plain, workspaceId: "ws", scope: "site" });
  const owned = depsWith({ workspaceId: "ws-project", repo: { id: "project-repo" }, sealer, keyring });
  assert.deepEqual(credentialCreateTarget({ deps: owned, input: { workspaceId: "ws", scope: "site" }, invalid }), { deps: owned, workspaceId: "ws", scope: "site" });
});

test("credentialCreateTarget writes to the owner half, through its create-only repo when one is configured", () => {
  const readRepo = { id: "project-repo" };
  const viaRead = credentialCreateTarget({ deps: depsWith({ workspaceId: "ws-project", repo: readRepo, sealer, keyring }), input: { workspaceId: "ws" }, invalid });
  assert.equal(viaRead.scope, "project");
  assert.equal(viaRead.deps.repo, readRepo);
  const createRepo = { id: "create-repo" };
  const viaCreate = credentialCreateTarget({ deps: depsWith({ workspaceId: "ws-project", repo: readRepo, createRepo, sealer, keyring }), input: { workspaceId: "ws", scope: "project" }, invalid });
  assert.equal(viaCreate.scope, "project");
  assert.equal(viaCreate.workspaceId, "ws-project");
  assert.equal(viaCreate.deps.repo, createRepo);
});
