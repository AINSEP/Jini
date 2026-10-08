import assert from "node:assert/strict";
import { test } from "./support/node-test.fixture.js";

import { executeCommand, InMemoryChangeSetRepo } from "./support/switch-bindings.fixture.js";
import { ForbiddenError as CommandForbiddenError } from "../../core/index.js";
import type { AuthorizeFn } from "../../core/index.js";
import {
  FormFieldValidationError,
  FormSlugConflictError,
  FormDefinitionNotFoundError,
} from "../index.js";
import { InMemoryFormDefinitionRepo } from "../repo.memory.js";
import type { FormDefinitionRepoPort, NotifyConfig } from "../index.js";
import {
  createFormDefinition,
  setFormDefinitionStatus,
  updateFormDefinition,
} from "./support/switch-bindings.fixture.js";

/**
 * @file Unit tests for `write-service.ts` (C-005/C-006/C-007, REQ-01/03/04, AC-01/02/04/05/06,
 * EC-04, behavior.spec.md §1.1/§1.2, INV-08). Slug immutability, field-id-removal restriction,
 * never-delete lifecycle, concurrent-create slug race -> FORMS_SLUG_CONFLICT.
 */

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";
const ACTOR = { id: "principal-1", kind: "user" as const };

function makeDeps() {
  const repo = new InMemoryFormDefinitionRepo();
  const clock = { nowMs: () => Date.parse(NOW) };
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const changeSets = new InMemoryChangeSetRepo();
  const authorize: AuthorizeFn = async () => ({ allowed: true, reason: "ok" });
  return { repo, clock, idGen, changeSets, authorize, executeCommand };
}

test("createFormDefinition: creates an active definition with default notify config (AC-01)", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
    },
  });
  assert.equal(definition.status, "active");
  assert.deepEqual(definition.notify, { enabled: false, recipients: [] });

  const found = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: definition.id });
  assert.equal(found?.slug, "contact");
});

test("createFormDefinition: AC-02 — persists notify config when supplied", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
      notify: { enabled: true, recipients: ["ops@example.com"] },
    },
  });
  assert.deepEqual(definition.notify, { enabled: true, recipients: ["ops@example.com"] });
});

test("createFormDefinition: AC-03 — rejects an out-of-vocabulary field type, nothing persisted", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact",
          slug: "contact",
          fields: [{ id: "when", label: "When", type: "date" as never, required: false }],
        },
      }),
    FormFieldValidationError
  );
  const list = await deps.repo.list({ workspaceId: WORKSPACE_ID });
  assert.equal(list.length, 0);
});

test("createFormDefinition: AC-04/EC-04 — a duplicate slug maps to FormSlugConflictError, existing definition unchanged", async () => {
  const deps = makeDeps();
  await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
    },
  });

  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact 2",
          slug: "contact",
          fields: [{ id: "name", label: "Name", type: "text", required: true }],
        },
      }),
    FormSlugConflictError
  );

  const list = await deps.repo.list({ workspaceId: WORKSPACE_ID });
  assert.equal(list.length, 1);
  assert.ok(list[0]);
  assert.equal(list[0].name, "Contact");
});

test("createFormDefinition: rejects a name outside 1-200 characters", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "", slug: "contact", fields: [] },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "name must be 1-200 characters");
      return true;
    }
  );
  const fields = [{ id: "name", label: "Name", type: "text" as const, required: true }];
  const { definition } = await createFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "x".repeat(200), slug: "boundary", fields } });
  assert.equal((await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: definition.id }))?.name, "x".repeat(200));
  await assert.rejects(
    () => createFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "x".repeat(201), slug: "too-long", fields } }),
    (error: unknown) => {
      assert.ok(error instanceof FormFieldValidationError);
      assert.equal(error.message, "name must be 1-200 characters");
      return true;
    },
  );
  assert.equal(await deps.repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "too-long" }), null);
});

test("createFormDefinition: the admin editor's reserved slug is rejected without persisting a definition", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () => createFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "New", slug: "new", fields: [{ id: "name", label: "Name", type: "text", required: true }] } }),
    (error: unknown) => {
      assert.ok(error instanceof FormFieldValidationError);
      assert.equal(error.message, "slug 'new' is reserved");
      assert.deepEqual(error.fieldErrors, [{ field: "slug", reason: "'new' is reserved for the admin editor's own URL" }]);
      return true;
    },
  );
  assert.deepEqual(await deps.repo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("create, update and status changes require exactly admin.forms.manage and each persist an audit item", async () => {
  const deps = makeDeps();
  let granted = true;
  const permissions: string[] = [];
  deps.authorize = async ({ permission }) => {
    permissions.push(permission);
    return { allowed: permission === "admin.forms.manage" ? granted : true, reason: "test-grant" };
  };
  const input = { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text" as const, required: true }] };
  const { definition } = await createFormDefinition({ deps, input });
  const auditOperations = async () => {
    const records = await deps.changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID });
    const operations: string[] = [];
    for (const record of records) {
      const audit = await deps.changeSets.findById({ workspaceId: WORKSPACE_ID, id: record.id });
      assert.ok(audit);
      assert.deepEqual(audit.items.map(({ entityType, entityId }) => ({ entityType, entityId })), [{ entityType: "form_definition", entityId: definition.id }]);
      assert.ok(audit.items[0]);
      operations.push(audit.items[0].operation);
    }
    return operations.sort();
  };
  assert.deepEqual(await auditOperations(), ["create"]);
  await updateFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { name: "Renamed" } } });
  assert.deepEqual(await auditOperations(), ["create", "update"]);
  await setFormDefinitionStatus({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, status: "disabled" } });
  assert.deepEqual(await auditOperations(), ["create", "update", "update"]);
  const before = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: definition.id });
  granted = false;
  await assert.rejects(() => createFormDefinition({ deps, input: { ...input, slug: "denied" } }), CommandForbiddenError);
  await assert.rejects(() => updateFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { name: "Denied" } } }), CommandForbiddenError);
  await assert.rejects(() => setFormDefinitionStatus({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, status: "active" } }), CommandForbiddenError);
  assert.deepEqual(permissions, Array(6).fill("admin.forms.manage"));
  assert.deepEqual(await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: definition.id }), before);
  assert.equal(await deps.repo.findBySlug({ workspaceId: WORKSPACE_ID, slug: "denied" }), null);
  assert.deepEqual(await auditOperations(), ["create", "update", "update"]);
});

test("createFormDefinition: rejects a slug that doesn't match SLUG_PATTERN", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "Not Valid!", fields: [] },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "slug must match ^[a-z0-9][a-z0-9-]{0,63}$");
      return true;
    }
  );
});

test("createFormDefinition: rejects more than MAX_NOTIFY_RECIPIENTS addresses", async () => {
  const deps = makeDeps();
  const tooMany = Array.from({ length: 11 }, (_, i) => `r${i}@example.com`);
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }], notify: { enabled: true, recipients: tooMany } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "notify.recipients may not exceed 10 addresses");
      return true;
    }
  );
});

test("createFormDefinition: rejects a malformed notify recipient email", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }], notify: { enabled: true, recipients: ["not-an-email"] } },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "'not-an-email' is not a valid email address");
      return true;
    }
  );
});

test("createFormDefinition: rejects a notify.recipients that isn't an array", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact",
          slug: "contact",
          fields: [{ id: "name", label: "Name", type: "text", required: true }],
          notify: { enabled: true } as unknown as NotifyConfig,
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "notify.recipients must be an array");
      return true;
    }
  );
});

test("createFormDefinition: rejects a non-boolean notify.enabled", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact",
          slug: "contact",
          fields: [{ id: "name", label: "Name", type: "text", required: true }],
          notify: { enabled: "false", recipients: [] } as unknown as NotifyConfig,
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof FormFieldValidationError);
      assert.equal(err.message, "notify.enabled must be a boolean");
      return true;
    }
  );
});

test("createFormDefinition: throws the gateway's ForbiddenError when authorize denies", async () => {
  const deps = makeDeps();
  deps.authorize = async () => ({ allowed: false, reason: "missing_permission" });
  await assert.rejects(
    () =>
      createFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          name: "Contact",
          slug: "contact",
          fields: [{ id: "name", label: "Name", type: "text", required: true }],
        },
      }),
    CommandForbiddenError
  );
});

test("updateFormDefinition: behavior.spec.md §1.1 — a patch containing slug never changes the stored slug", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
    },
  });

  const { definition: updated } = await updateFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      formId: definition.id,
      patch: { slug: "renamed" } as Record<string, unknown>,
    },
  });
  assert.equal(updated.slug, "contact");
});

test("updateFormDefinition: behavior.spec.md §1.2 — rejects a fields patch that omits an existing field id", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [
        { id: "name", label: "Name", type: "text", required: true },
        { id: "email", label: "Email", type: "email", required: true },
      ],
    },
  });

  await assert.rejects(
    () =>
      updateFormDefinition({
        deps,
        input: {
          workspaceId: WORKSPACE_ID,
          actor: ACTOR,
          formId: definition.id,
          patch: { fields: [{ id: "name", label: "Name", type: "text", required: true }] },
        },
      }),
    FormFieldValidationError
  );
});

test("updateFormDefinition: allows adding a new field while keeping existing ids", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
    },
  });

  const { definition: updated } = await updateFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      formId: definition.id,
      patch: {
        fields: [
          { id: "name", label: "Full Name", type: "text", required: true },
          { id: "email", label: "Email", type: "email", required: false },
        ],
      },
    },
  });
  assert.equal(updated.fields.length, 2);
  assert.ok(updated.fields[0]);
  assert.equal(updated.fields[0].label, "Full Name");
});

test("updateFormDefinition: a name-only patch is validated and applied, other fields untouched", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }] },
  });

  const { definition: updated } = await updateFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { name: "Contact Us" } },
  });
  assert.equal(updated.name, "Contact Us");
  assert.equal(updated.fields.length, 1);
});

test("updateFormDefinition: an invalid name in the patch is rejected via the same validateNameAndSlug path createFormDefinition uses", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }] },
  });
  await assert.rejects(
    () => updateFormDefinition({ deps, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { name: "" } } }),
    FormFieldValidationError
  );
});

test("updateFormDefinition: a notify-only patch is validated and applied", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }] },
  });

  const { definition: updated } = await updateFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { notify: { enabled: true, recipients: ["ops@example.com"] } } },
  });
  assert.deepEqual(updated.notify, { enabled: true, recipients: ["ops@example.com"] });

  await assert.rejects(
    () =>
      updateFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { notify: { enabled: true, recipients: ["bad"] } } },
      }),
    FormFieldValidationError
  );
});

test("updateFormDefinition: FormDefinitionNotFoundError for an unknown formId", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      updateFormDefinition({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: "nope", patch: { name: "X" } },
      }),
    FormDefinitionNotFoundError
  );
});

test("updateFormDefinition: authorizes once, before any repo read — a denied caller learns nothing about the form's existence", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, name: "Contact", slug: "contact", fields: [{ id: "name", label: "Name", type: "text", required: true }] },
  });
  const order: string[] = [];
  const memoryRepo = deps.repo;
  const repo: FormDefinitionRepoPort = {
    findById: (target) => { order.push("repo.findById"); return memoryRepo.findById(target); },
    findBySlug: (target) => memoryRepo.findBySlug(target),
    list: (target) => memoryRepo.list(target),
    isSlugTaken: (target) => memoryRepo.isSlugTaken(target),
    create: (record) => memoryRepo.create(record),
    update: (record) => memoryRepo.update(record),
  };
  let allowed = true;
  const authorize: AuthorizeFn = async () => { order.push("authorize"); return { allowed, reason: "test-grant" }; };
  const recorded = { ...deps, repo, authorize };

  await updateFormDefinition({ deps: recorded, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, patch: { name: "Renamed" } } });
  assert.equal(order[0], "authorize", "the gate precedes the authoring pre-read");
  assert.equal(order.filter((effect) => effect === "authorize").length, 1, "the gateway replays the one decision (ADR-021 §2)");

  order.length = 0;
  allowed = false;
  // An unknown id must still be refused as Forbidden, never NotFound: that difference is the leak.
  await assert.rejects(
    () => updateFormDefinition({ deps: recorded, input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: "no-such-form", patch: { name: "X", mode: "html", html: "<input name=a>" } } }),
    CommandForbiddenError,
  );
  assert.deepEqual(order, ["authorize"], "a denied caller reaches no repo read and no second evaluation");
});

test("setFormDefinitionStatus: AC-05 — flips status to disabled without deleting the row (INV-08)", async () => {
  const deps = makeDeps();
  const { definition } = await createFormDefinition({
    deps,
    input: {
      workspaceId: WORKSPACE_ID,
      actor: ACTOR,
      name: "Contact",
      slug: "contact",
      fields: [{ id: "name", label: "Name", type: "text", required: true }],
    },
  });

  const { definition: disabled } = await setFormDefinitionStatus({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: definition.id, status: "disabled" },
  });
  assert.equal(disabled.status, "disabled");

  const stillThere = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: definition.id });
  assert.ok(stillThere);
  assert.equal(stillThere?.status, "disabled");
});

test("setFormDefinitionStatus: FormDefinitionNotFoundError for an unknown formId", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () =>
      setFormDefinitionStatus({
        deps,
        input: { workspaceId: WORKSPACE_ID, actor: ACTOR, formId: "nope", status: "disabled" },
      }),
    FormDefinitionNotFoundError
  );
});

test("AC-06: FormDefinitionRepoPort exposes no delete method — write-service.ts has nothing to call", () => {
  const repo = new InMemoryFormDefinitionRepo();
  assert.equal((repo as unknown as { delete?: unknown }).delete, undefined);
});
