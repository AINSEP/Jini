import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryChangeSetRepo } from "./change-set.fixture.js";
import { executeCommand, ForbiddenError as CommandForbiddenError } from "@jini-ai/cms/core";
import {
  FormFieldValidationError,
  FormSlugConflictError,
  FormDefinitionNotFoundError,
} from "../errors.js";
import { InMemoryFormDefinitionRepo } from "./repo.fixture.js";
import type { NotifyConfig } from "../types.js";
import {
  createFormDefinition as createFormDefinitionCore,
  setFormDefinitionStatus as setFormDefinitionStatusCore,
  updateFormDefinition as updateFormDefinitionCore,
} from "../write-service.js";

const NOW = "2026-07-13T00:00:00.000Z";
const WORKSPACE_ID = "ws-1";
const ACTOR = { id: "principal-1", kind: "user" as const };

function makeDeps() {
  const repo = new InMemoryFormDefinitionRepo();
  const clock = { nowMs: () => Date.parse(NOW)};
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  const changeSets = new InMemoryChangeSetRepo();
  const authorize = async () => ({ allowed: true, reason: "ok" });
  return { repo, clock, idGen, changeSets, executeCommand, authorize, permission: "admin.forms.manage", reservedSlugs: new Set(["new"]) };
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
  assert.equal(list[0]!.name, "Contact");
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
  assert.equal(updated.fields[0]!.label, "Full Name");
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

// Preserve the source tests' call shape while exercising the new optional-object API.
import type { CreateFormDefinitionRequired, UpdateFormDefinitionRequired, SetFormDefinitionStatusRequired } from "../write-service.js";
type LegacyCreate = Omit<CreateFormDefinitionRequired, "input"> & { input: CreateFormDefinitionRequired["input"] & { notify?: NotifyConfig; idempotencyKey?: string } };
type LegacyUpdate = Omit<UpdateFormDefinitionRequired, "input"> & { input: UpdateFormDefinitionRequired["input"] & { idempotencyKey?: string } };
type LegacyStatus = Omit<SetFormDefinitionStatusRequired, "input"> & { input: SetFormDefinitionStatusRequired["input"] & { idempotencyKey?: string } };
function createFormDefinition({ deps, input: { notify, idempotencyKey, ...input } }: LegacyCreate) {
  return createFormDefinitionCore({ deps, input }, { ...(notify === undefined ? {} : { notify }), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
}
function updateFormDefinition({ deps, input: { idempotencyKey, ...input } }: LegacyUpdate) {
  return updateFormDefinitionCore({ deps, input }, idempotencyKey === undefined ? {} : { idempotencyKey });
}
function setFormDefinitionStatus({ deps, input: { idempotencyKey, ...input } }: LegacyStatus) {
  return setFormDefinitionStatusCore({ deps, input }, idempotencyKey === undefined ? {} : { idempotencyKey });
}
