import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { DefinitionInvalidError, SecretNotSupportedError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { validateDefinitionInput } from "../settings.js";
import { registerDefinitions } from "../write-service.js";

const clock = { nowIso: () => "2026-07-11T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });

test("validateDefinitionInput accepts a core definition with a null workspace (AC-02)", () => {
  const result = validateDefinitionInput({
    namespace: "core.presentation.activeThemeId",
    key: "activeThemeId",
    ownerKind: "core",
    workspaceId: null,
    schema: { type: "string" },
    defaultValue: "paper",
    scopes: 1,
    secret: false,
  });
  assert.equal(result.valid, true);
});

test("validateDefinitionInput rejects a site-owned definition registered under core.* (AC-03)", () => {
  const result = validateDefinitionInput({
    namespace: "core.foo",
    key: "bar",
    ownerKind: "site",
    workspaceId: "ws-1",
    schema: { type: "string" },
    defaultValue: "x",
    scopes: 2,
    secret: false,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.error instanceof DefinitionInvalidError);
});

test("validateDefinitionInput rejects secret:true (AC-15/INV-08)", () => {
  const result = validateDefinitionInput({
    namespace: "core.foo",
    key: "bar",
    ownerKind: "core",
    workspaceId: null,
    schema: { type: "string" },
    defaultValue: "x",
    scopes: 1,
    secret: true,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.error instanceof SecretNotSupportedError);
});

test("validateDefinitionInput rejects a site-owned definition declaring the global scope bit (INV-05/EC-04)", () => {
  const result = validateDefinitionInput({
    namespace: "site.foo",
    key: "bar",
    ownerKind: "site",
    workspaceId: "ws-1",
    schema: { type: "string" },
    defaultValue: "x",
    scopes: 1 | 2,
    secret: false,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.error instanceof DefinitionInvalidError);
});

test("validateDefinitionInput rejects an out-of-range scopes bitmask", () => {
  const result = validateDefinitionInput({
    namespace: "core.foo",
    key: "bar",
    ownerKind: "core",
    workspaceId: null,
    schema: { type: "string" },
    defaultValue: "x",
    scopes: 8,
    secret: false,
  });
  assert.equal(result.valid, false);
});

test("validateDefinitionInput rejects a null default for a non-secret definition (totality)", () => {
  const result = validateDefinitionInput({
    namespace: "core.foo",
    key: "bar",
    ownerKind: "core",
    workspaceId: null,
    schema: { type: "string", nullable: true },
    defaultValue: null,
    scopes: 1,
    secret: false,
  });
  assert.equal(result.valid, false);
});

test("registerDefinitions rejects secret:true without writing anything (EC-03)", async () => {
  const repo = new InMemorySettingsRepo();
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      registerDefinitions({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          definitions: [
            {
              namespace: "core.foo",
              key: "bar",
              ownerKind: "core",
              workspaceId: null,
              schema: { type: "string" },
              defaultValue: "x",
              scopes: 1,
              secret: true,
            },
          ],
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    SecretNotSupportedError
  );
  assert.equal((await repo.listActiveDefinitions({ workspaceId: null })).length, 0);
});

test("registerDefinitions is rejected FORBIDDEN when the caller lacks settings.definitions.manage", async () => {
  const repo = new InMemorySettingsRepo();
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(() =>
    registerDefinitions({
      deps: { repo, clock, ids, authorize: alwaysDeny, principals },
      input: {
        definitions: [
          {
            namespace: "core.foo",
            key: "bar",
            ownerKind: "core",
            workspaceId: null,
            schema: { type: "string" },
            defaultValue: "x",
            scopes: 1,
            secret: false,
          },
        ],
        callerPrincipalId: "actor-1",
        authWorkspaceId: "ws-1",
      },
    })
  );
  assert.equal((await repo.listActiveDefinitions({ workspaceId: null })).length, 0);
});

test("registerDefinitions writes a definition row + a same-revision 'register' entry", async () => {
  const repo = new InMemorySettingsRepo();
  const principals = new InMemoryPrincipalRepo([]);

  const { registered } = await registerDefinitions({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      definitions: [
        {
          namespace: "core.presentation.activeThemeId",
          key: "activeThemeId",
          ownerKind: "core",
          workspaceId: null,
          schema: { type: "string" },
          defaultValue: "paper",
          scopes: 1,
          secret: false,
        },
      ],
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  assert.equal(registered.length, 1);
  const defs = await repo.listActiveDefinitions({ workspaceId: null });
  assert.equal(defs.length, 1);
  const revisions = await repo.listRevisions({ settingId: registered[0]! });
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]!.op, "register");
});
