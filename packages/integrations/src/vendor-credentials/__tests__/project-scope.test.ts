import assert from "node:assert/strict";
import { test } from "vitest";

import { credentialCreateTarget, credentialScopes, type CredentialProjectHalf } from "../project-scope.js";

const sealer = { name: "project-sealer" } as never;
const keyring = { name: "project-keyring" } as never;
const siteRepo = { name: "site-repo" };
const siteDeps = { repo: siteRepo as { name: string; project?: CredentialProjectHalf<unknown> }, sealer: "site-sealer", keyring: "site-keyring" };
const invalid = (message: string): Error => new Error(`invalid: ${message}`);

function withProject(optional: { createRepo?: unknown } = {}) {
  const project: CredentialProjectHalf<unknown> = { workspaceId: "project-ws", repo: { name: "project-repo" }, sealer, keyring, ...optional };
  return { ...siteDeps, repo: { ...siteRepo, project } };
}

test("a site without an attached owner store reads only its own vault", () => {
  assert.deepEqual(credentialScopes(siteDeps, "site-ws"), [{ deps: siteDeps, workspaceId: "site-ws", scope: "site" }]);
});

test("an attached owner store is read second, with its own repo, sealer, keyring and workspace id", () => {
  const deps = withProject();
  const [site, project] = credentialScopes(deps, "site-ws");
  assert.deepEqual(site, { deps, workspaceId: "site-ws", scope: "site" });
  assert.equal(project?.scope, "project");
  assert.equal(project?.workspaceId, "project-ws");
  assert.deepEqual(project?.deps, { ...deps, repo: { name: "project-repo" }, sealer, keyring });
});

test("a new row goes to the owner store by default and to the site vault when saved explicitly there", () => {
  const deps = withProject();
  assert.equal(credentialCreateTarget(deps, { workspaceId: "site-ws" }, invalid).scope, "project");
  assert.equal(credentialCreateTarget(deps, { workspaceId: "site-ws", scope: "project" }, invalid).scope, "project");
  assert.deepEqual(credentialCreateTarget(deps, { workspaceId: "site-ws", scope: "site" }, invalid), { deps, workspaceId: "site-ws", scope: "site" });
});

test("without an owner store every new row lands in the site vault", () => {
  assert.deepEqual(credentialCreateTarget(siteDeps, { workspaceId: "site-ws", scope: "project" }, invalid), { deps: siteDeps, workspaceId: "site-ws", scope: "site" });
});

test("the owner's create-only repo replaces the repo for new project rows only", () => {
  const createRepo = { name: "create-only" };
  const target = credentialCreateTarget(withProject({ createRepo }), { workspaceId: "site-ws" }, invalid);
  assert.equal(target.workspaceId, "project-ws");
  assert.equal((target.deps as unknown as { repo: unknown }).repo, createRepo);
});

test("a scope other than site or project is refused through the store's own validation error", () => {
  for (const scope of ["owner", "", null, 1]) {
    assert.throws(() => credentialCreateTarget(withProject(), { workspaceId: "site-ws", scope }, invalid), /invalid: scope must be "site" or "project"/);
  }
});
