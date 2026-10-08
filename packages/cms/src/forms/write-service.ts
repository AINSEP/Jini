/**
 * @file `write-service.ts` — the admin-CRUD write chokepoint (SPEC-010 REQ-01..04, ADR-PIPE-010).
 *
 * Purpose:
 * `createFormDefinition`/`updateFormDefinition`/`setFormDefinitionStatus`, each wrapping the
 * existing core/commands `executeCommand` gateway (mirrors `posts/create.ts`'s pattern — the
 * gateway captures the auditable change-set record, authorizes `admin.forms.manage`, and enqueues
 * `change-set.applied` onto the outbox). Never exposes a delete: a form definition is removed
 * permanently only by a Trash purge (owner ruling 2026-09-21, superseding the original INV-08
 * "never deleted" wording) — the repo port itself has no delete method for this file to call.
 *
 * Slug-uniqueness relies on the DB unique index (`db/schema.sqlite.ts`), not an app-level check
 * (behavior.spec.md §6.1) — `repo.memory.ts`/`repo.ts` both map a conflicting insert to
 * `FormSlugConflictError`, which this file lets propagate unchanged out of `mutation.execute()`.
 */
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
/** Audited definition writes through the CMS command gateway. Host permissions and reserved slugs are explicit policies; notify, idempotency and optional outbox wiring live in the second argument. */
import type { ChangeSetRepoPort } from "../core/index.js";
import type { Clock, IdGenerator, UUID } from "@jini-ai/core/primitives";
import type {
  AuthorizeFn,
  CommandActor,
} from "../core/index.js";
import { FormDefinitionNotFoundError, FormFieldValidationError } from "./errors.js";
import { validateFieldDescriptors } from "./forms.js";
import type { FormAuthoringPort, FormCommandExecutorPort, FormDefinitionRepoPort } from "./ports.js";
import type {
  FieldDescriptor,
  FormDefinitionRecord,
  FormDefinitionStatus,
  NotifyConfig,
} from "./types.js";

import type { FormAuthoring, HtmlFormDefinitionRecord } from "./fields-json.js";

export interface FormWriteServiceDeps {
  /** Host-bound audited command gateway; no runtime CMS implementation is imported. */
  executeCommand: FormCommandExecutorPort;
  repo: FormDefinitionRepoPort;
  clock: Clock;
  idGen: IdGenerator;
  changeSets: ChangeSetRepoPort;
  permission: string;
  reservedSlugs: ReadonlySet<string>;
  authorize: AuthorizeFn;
}

// Export validation bounds so host tool schemas can share them rather than drift from the service.
export const MAX_NOTIFY_RECIPIENTS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 200;

function defaultNotify(): NotifyConfig {
  return { enabled: false, recipients: [] };
}

function validateNotify(notify: NotifyConfig | undefined): NotifyConfig {
  const resolved = notify ?? defaultNotify();
  if (!Array.isArray(resolved.recipients)) {
    throw new FormFieldValidationError({ message: "notify.recipients must be an array", fieldErrors: [
      { field: "notify.recipients", reason: "must be an array" },
    ] });
  }
  if (typeof resolved.enabled !== "boolean") {
    throw new FormFieldValidationError({ message: "notify.enabled must be a boolean", fieldErrors: [
      { field: "notify.enabled", reason: "must be a boolean" },
    ] });
  }
  if (resolved.recipients.length > MAX_NOTIFY_RECIPIENTS) {
    throw new FormFieldValidationError({ message: `notify.recipients may not exceed ${MAX_NOTIFY_RECIPIENTS} addresses`, fieldErrors: [{ field: "notify.recipients", reason: `at most ${MAX_NOTIFY_RECIPIENTS} recipients are allowed` }] });
  }
  for (const recipient of resolved.recipients) {
    if (!EMAIL_PATTERN.test(recipient)) {
      throw new FormFieldValidationError({ message: `'${recipient}' is not a valid email address`, fieldErrors: [
        { field: "notify.recipients", reason: `'${recipient}' is not a valid email address` },
      ] });
    }
  }
  return resolved;
}

function validateNameAndSlug(name: string, slug: string, reservedSlugs: ReadonlySet<string>): void {
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new FormFieldValidationError({ message: `name must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters`, fieldErrors: [
      { field: "name", reason: `must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters` },
    ] });
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new FormFieldValidationError({ message: "slug must match ^[a-z0-9][a-z0-9-]{0,63}$", fieldErrors: [
      { field: "slug", reason: "must match ^[a-z0-9][a-z0-9-]{0,63}$" },
    ] });
  }
  if (reservedSlugs.has(slug)) {
    throw new FormFieldValidationError({ message: `slug '${slug}' is reserved`, fieldErrors: [
      { field: "slug", reason: `'${slug}' is reserved by the host` },
    ] });
  }
}

function assertValidFields(fields: FieldDescriptor[]): void {
  const validation = validateFieldDescriptors({ fields });
  if (!validation.valid) {
    throw new FormFieldValidationError({ message: "one or more field descriptors are invalid", fieldErrors: validation.fieldErrors });
  }
}

export interface CreateFormDefinitionRequired {
  deps: FormWriteServiceDeps;
  input: {
    workspaceId: UUID;
    actor: CommandActor;
    name: string;
    slug: string;
    fields: FieldDescriptor[];
  } & FormAuthoring;
}

/**
 * All definition writes pass through the injected command gateway for authorization, audit
 * capture and optional change-set event enqueue. There is no delete here: permanent removal
 * belongs to a separate trash purge, and the definition repository exposes no delete method.
 * Slug uniqueness is enforced by the repository's unique index, avoiding a racy pre-insert check;
 * repository slug-conflict errors propagate unchanged from the mutation.
 */
export async function createFormDefinition(
  required: CreateFormDefinitionRequired,
  optional: CreateFormDefinitionOptional = {}
): Promise<{ definition: FormDefinitionRecord }> {
  let { deps, input } = required;
  if (optional.authoring) {
    const authored = await optional.authoring.prepare({ deps, input });
    if (authored) {
      deps = { ...deps, repo: optional.authoring.with({ repo: deps.repo, authoring: authored }) };
      input = { ...input, ...(authored.fields ? { fields: authored.fields } : {}) };
    }
  }
  validateNameAndSlug(input.name, input.slug, deps.reservedSlugs);
  assertValidFields(input.fields);
  const notify = validateNotify(optional.notify);

  const definitionId = deps.idGen.newId();

  const { result } = await deps.executeCommand({
    deps: {
      clock: deps.clock,
      idGen: deps.idGen,
      changeSets: deps.changeSets,
      outbox: optional.outbox,
      authorize: deps.authorize,
    },
    command: {
      workspaceId: input.workspaceId,
      actor: input.actor,
      summary: `Create form definition '${input.slug}'`,
      idempotencyKey: optional.idempotencyKey,
      permission: deps.permission,
    },
    mutation: {
      entityType: "form_definition",
      entityId: definitionId,
      operation: "create",
      captureInverse: async () => null,
      execute: async () => {
        const now = kernelNowIso({ clock: deps.clock });
        const definition: FormDefinitionRecord = {
          id: definitionId,
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          fields: input.fields,
          notify,
          status: "active",
          createdAt: now,
          updatedAt: now,
          // Start the optimistic-concurrency version at 1 for the trash compare-and-set lifecycle.
          version: 1,
        };
        await deps.repo.create(definition);
        return { definition };
      },
    },
  });

  return result;
}

export interface UpdateFormDefinitionRequired {
  deps: FormWriteServiceDeps;
  input: {
    workspaceId: UUID;
    actor: CommandActor;
    formId: UUID;

    // Accept a supplied slug for compatibility but ignore it: updates never rename stored slugs.
    patch: {
      name?: string;
      fields?: FieldDescriptor[];
      notify?: NotifyConfig;
      slug?: string;
    } & FormAuthoring;
  };
}

export async function updateFormDefinition(
  required: UpdateFormDefinitionRequired,
  optional: UpdateFormDefinitionOptional = {}
): Promise<{ definition: FormDefinitionRecord }> {
  if (optional.authoring) return updateAuthoredFormDefinition(required, optional);
  const { deps, input } = required;

  const { result } = await deps.executeCommand({
    deps: {
      clock: deps.clock,
      idGen: deps.idGen,
      changeSets: deps.changeSets,
      outbox: optional.outbox,
      authorize: deps.authorize,
    },
    command: {
      workspaceId: input.workspaceId,
      actor: input.actor,
      summary: `Update form definition '${input.formId}'`,
      idempotencyKey: optional.idempotencyKey,
      permission: deps.permission,
    },
    mutation: {
      entityType: "form_definition",
      entityId: input.formId,
      operation: "update",
      captureInverse: async () => null,
      execute: async () => {
        const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.formId });
        if (!existing) {
          throw new FormDefinitionNotFoundError({ message: `form definition '${input.formId}' was not found` });
        }

        const name = input.patch.name !== undefined ? input.patch.name : existing.name;
        if (input.patch.name !== undefined) {
          validateNameAndSlug(name, existing.slug, deps.reservedSlugs);
        }

        let fields = existing.fields;
        if (input.patch.fields !== undefined) {
          assertValidFields(input.patch.fields);
          const existingIds = new Set(existing.fields.map((f) => f.id));
          const newIds = new Set(input.patch.fields.map((f) => f.id));
          const missing = [...existingIds].filter((id) => !newIds.has(id));
          if (missing.length > 0) {
            throw new FormFieldValidationError({ message: `patch omits existing field id(s): ${missing.join(", ")} (behavior.spec.md §1.2)`, fieldErrors: missing.map((id) => ({ field: id, reason: "existing field ids cannot be removed" })) });
          }
          fields = input.patch.fields;
        }

        const notify = input.patch.notify !== undefined ? validateNotify(input.patch.notify) : existing.notify;

        const definition: FormDefinitionRecord = {
          ...existing,
          name,
          fields,
          notify,
          slug: existing.slug,
          updatedAt: kernelNowIso({ clock: deps.clock }),
        };
        await deps.repo.update(definition);
        return { definition };
      },
    },
  });

  return result;
}

export interface SetFormDefinitionStatusRequired {
  deps: FormWriteServiceDeps;
  input: {
    workspaceId: UUID;
    actor: CommandActor;
    formId: UUID;
    status: FormDefinitionStatus;
  };
}

/** Status changes preserve the row; deletion requires the separate trash lifecycle. */
export async function setFormDefinitionStatus(
  required: SetFormDefinitionStatusRequired,
  optional: FormWriteOptional = {}
): Promise<{ definition: FormDefinitionRecord }> {
  const { deps, input } = required;

  const { result } = await deps.executeCommand({
    deps: {
      clock: deps.clock,
      idGen: deps.idGen,
      changeSets: deps.changeSets,
      outbox: optional.outbox,
      authorize: deps.authorize,
    },
    command: {
      workspaceId: input.workspaceId,
      actor: input.actor,
      summary: `Set form definition '${input.formId}' status to '${input.status}'`,
      idempotencyKey: optional.idempotencyKey,
      permission: deps.permission,
    },
    mutation: {
      entityType: "form_definition",
      entityId: input.formId,
      operation: "update",
      captureInverse: async () => null,
      execute: async () => {
        const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.formId });
        if (!existing) {
          throw new FormDefinitionNotFoundError({ message: `form definition '${input.formId}' was not found` });
        }
        const definition: FormDefinitionRecord = {
          ...existing,
          status: input.status,
          updatedAt: kernelNowIso({ clock: deps.clock }),
        };
        await deps.repo.update(definition);
        return { definition };
      },
    },
  });

  return result;
}

export interface FormWriteOptional {
  idempotencyKey?: string;
  outbox?: import("../core/index.js").OutboxPort;
}
export interface CreateFormDefinitionOptional extends FormWriteOptional { notify?: NotifyConfig; authoring?: FormAuthoringPort; }
export interface UpdateFormDefinitionOptional extends FormWriteOptional { authoring?: FormAuthoringPort; }

/** Authoring pre-reads are authorized once; the audited gateway replays that decision.
 * @complexity O(f + h) authoring/validation, with fixed-count repository and command calls. */
async function updateAuthoredFormDefinition(
  { deps, input }: UpdateFormDefinitionRequired,
  optional: UpdateFormDefinitionOptional,
): Promise<{ definition: FormDefinitionRecord }> {
  // Authorize BEFORE the authoring pre-read below, so a denied caller is refused before any
  // lookup and the refusal never discloses whether the form exists (5e9f338f6 put the read
  // first). The gateway then replays this one decision instead of evaluating a second time —
  // ADR-021 §2 "one evaluator". Its only authorize() caller is executeCommand's single gate,
  // pinned to FORMS_PERMISSION by packageDeps; prepareFormAuthoring keeps the real authorize.
  const decision = await deps.authorize({
    principalId: input.actor.id,
    permission: deps.permission,
    workspaceId: input.workspaceId,
    entityType: "form_definition",
    entityId: input.formId,
  });
  const gatewayDeps = { ...deps, authorize: async () => decision };
  const { mode, html, ...builderPatch } = input.patch;
  const { authoring, ...writeOptions } = optional;
  // Denied: skip the pre-read entirely; the gateway throws its own ForbiddenError.
  if (!decision.allowed) {
    return updateFormDefinition({ deps: gatewayDeps, input: { ...input, patch: builderPatch } }, writeOptions);
  }
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.formId }) as HtmlFormDefinitionRecord | null;
  const authored = await authoring!.prepare({
    deps, input: { workspaceId: input.workspaceId, actor: input.actor, ...input.patch }, ...(existing ? { existing } : {}),
  });
  const boundDeps = authored ? {
    ...gatewayDeps,
    repo: authoring!.with({ repo: deps.repo, authoring: authored }, { replaceFields: authored.mode === "html" || (existing?.mode === "html" && input.patch.fields !== undefined) }),
  } : gatewayDeps;
  return updateFormDefinition({
    deps: boundDeps, input: { ...input, patch: { ...builderPatch, ...(authored?.fields ? { fields: authored.fields } : {}) } },
  }, writeOptions);
}
