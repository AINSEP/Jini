Spec ID: SPEC-JINI-CMS-FORMS-API
Version: 2.2.0
Last Edited: 2026-10-26
Hash: sha256:5c3621ad6e1d5972ced0deb392ac4ab7a25bd81b44afbc192d7767f32e64e380
spec_mode: reverse_spec
Hash basis: UTF-8 Markdown body from the first heading through EOF


# Forms API contract

## Entry point and argument convention

`@jini-ai/cms-forms` exports only `.` (`src/index.ts`); there are no public subpaths. It is currently a private workspace package. Imports are framework-free. The host supplies persistence, authorization, audited commands, events, throttling, mail and logging.

The target convention is `(required, optional = {})`. The signatures below describe source now: the three definition writers and the IP maintenance sweep accept a second object; the remaining forms functions take one object. Do not add a second argument to those calls yet.

## Public functions

| Function | Current signature | Return |
| --- | --- | --- |
| `validateFieldDescriptors` | `({ fields }: { fields: FieldDescriptor[] })` | `FieldValidationResult` |
| `validateSubmissionPayload` | `(input: ValidateSubmissionPayloadInput)`; `{ definition, body: Record<string, unknown> }` | `SubmissionValidationResult` |
| `isHoneypotTripped` | `({ hp }: { hp: unknown })` | `boolean` |
| `buildFormsRateLimitKey` | `({ sourceIp, formDefinitionId }: { sourceIp: string; formDefinitionId: string })` | `string` |
| `createFormDefinition` | `(required: CreateFormDefinitionRequired, optional: CreateFormDefinitionOptional = {})` | `Promise<{ definition: FormDefinitionRecord }>` |
| `updateFormDefinition` | `(required: UpdateFormDefinitionRequired, optional: FormWriteOptional = {})` | `Promise<{ definition: FormDefinitionRecord }>` |
| `setFormDefinitionStatus` | `(required: SetFormDefinitionStatusRequired, optional: FormWriteOptional = {})` | `Promise<{ definition: FormDefinitionRecord }>` |
| `submitForm` | `(required: SubmitFormRequired)` | `Promise<{ status: "accepted" }>` |
| `registerFormNotifySubscriber` | `(deps: RegisterFormNotifySubscriberDeps)` | `Promise<() => Promise<void>>` |
| `sweepExpiredSubmissionIps` | `({ now, repo }: { now: number; repo: SubmissionIpRetentionPort }, { batchSize?: number } = {})` | `Promise<number>` |

```ts
type FormWriteOptional = { idempotencyKey?: string; outbox?: OutboxPort };
type CreateFormDefinitionOptional = FormWriteOptional & { notify?: NotifyConfig };
// Required writer arguments always contain { deps, input }.
type CreateInput = {
  workspaceId: UUID; actor: CommandActor; name: string; slug: string;
  fields: FieldDescriptor[];
};
type UpdateInput = {
  workspaceId: UUID; actor: CommandActor; formId: UUID;
  patch: { name?: string; fields?: FieldDescriptor[]; notify?: NotifyConfig; slug?: string };
};
type StatusInput = {
  workspaceId: UUID; actor: CommandActor; formId: UUID;
  status: "active" | "disabled";
};
type SubmitFormInput = {
  workspaceId: UUID; slug: string; body: Record<string, unknown>; sourceIp: string;
};
```

## Data and exported constants

`FieldDescriptor` is `{ id, label, type: "text" | "email" | "textarea" | "checkbox", required, maxLength?: number | null, className?: string, attributes?: Record<string, string> }`. `NotifyConfig` is `{ enabled: boolean; recipients: string[] }`.

`FormDefinitionRecord` has `id`, `workspaceId`, `name`, `slug`, `fields`, `notify`, `status`, `createdAt`, `updatedAt`, `version`. `FormSubmissionRecord` has `id`, `workspaceId`, `formDefinitionId`, `data: Record<string, string | boolean>`, `sourceIp: string | null`, `submittedAt`. `FormSubmissionPage` is `{ items: FormSubmissionRecord[]; nextCursor: string | null }`. `SUBMISSION_IP_RETENTION_DAYS=90` is the submitter-IP policy, independent of submission-content retention.

`FieldError` is `{ field: string; reason: string }`. `FieldValidationResult` is `{ valid: true } | { valid: false; fieldErrors: FieldError[] }`; `SubmissionValidationResult` adds `data` only on success.

The barrel also exports `FieldType`, `FormDefinitionStatus`, all named required/dependency/optional interfaces above, the ports below and the six classes in `errors.spec.md`. Constants: `MAX_FIELDS=20`, `MAX_LABEL_LENGTH=200`, `MIN_MAX_LENGTH=1`, `MAX_MAX_LENGTH=5000`, `MAX_CLASS_NAME_LENGTH=300`, `MAX_ATTRIBUTES_PER_FIELD=12`, `MAX_ATTRIBUTE_VALUE_LENGTH=300`, `MAX_NOTIFY_RECIPIENTS=10`, `MAX_NAME_LENGTH=200`, `HONEYPOT_KEY="_hp"`. `FIELD_ID_PATTERN`, `FIELD_TYPES`, `ATTRIBUTE_NAME_PATTERN` and `SLUG_PATTERN` expose the validation vocabulary described in `behavior.spec.md`.

## Required host ports

| Consumer operation | Dependencies |
| --- | --- |
| Definition writers | `FormWriteServiceDeps`: `executeCommand: FormCommandExecutorPort`, `repo`, `clock`, `idGen`, `changeSets`, `permission: string`, `reservedSlugs: ReadonlySet<string>`, `authorize` |
| Anonymous submit | `SubmitFormDeps`: `definitionRepo`, `submissionRepo`, `outbox`, `dispatcher`, `logger`, `clock`, `idGen`, `rateLimiter` |
| Notification subscription | `RegisterFormNotifySubscriberDeps`: `bus`, `sender: EmailAddress`, `logger`, `mailer`, `formDefinitionRepo`, `formSubmissionRepo` |

`Clock.nowMs()` and `IdGenerator.newId()` come from `@jini-ai/core/primitives`; use `nowIso({ clock })` for ISO timestamps. `FormCommandExecutorPort` is `typeof executeCommand` from `@jini-ai/cms/core`; the host binds it explicitly. No runtime CMS gateway is imported by forms.

- `FormDefinitionRepoPort`: `findById({workspaceId,id})` / `findBySlug({workspaceId,slug})` return `Promise<FormDefinitionRecord | null>`; `list({workspaceId})` returns definitions; `create(record)` / `update(record)` return `Promise<void>`; `isSlugTaken({workspaceId,slug})` returns `Promise<boolean>`. Reads/updates expose live rows; trashed rows still reserve slugs. Creation must enforce slug uniqueness itself.
- `FormSubmissionRepoPort`: `findById({workspaceId,id})`, `create(record)`; `listByDefinition({workspaceId,formDefinitionId,limit}, {cursor?})` returns `Promise<FormSubmissionPage>`. Ordering and cursor encoding belong to the adapter.
- `SubmissionIpRetentionPort.clearExpiredIps({ submittedBeforeOrAt }, { limit? } = {})`: atomically clear only non-null source IPs for at most the requested limit of submissions at/before the ISO UTC cutoff, including all workspaces and Trash; return the actual affected count. The sweep always supplies its explicit batch limit. An omitted adapter limit defaults to 500.
- `RateLimiterPort.check({key})` returns, synchronously or asynchronously, `{allowed:true}` or `{allowed:false,retryAfterSeconds:number}`. The host chooses quotas/windows.
- `FormOutboxPort.enqueue(event)` returns `Promise<void>`; `OutboxDispatcherPort.dispatch({})` returns `Promise<void>`; `Pick<Logger, "warn">` from `@jini-ai/core/primitives`; `warn({ message }, { error? })` returns `void`.
- `MailerPort.send({message,options})` returns `Promise<MailerSendResult>`. `OutboundEmail` contains `{workspaceId,to,from,subject,text}`; `EmailAddress` is `{email,name?}`. `MailerSendOptions` requires `{idempotencyKey,workspaceId,sourceContext:{module,ref},purpose:"transactional",lane:"notification"}`. Result is `{ok:true,providerMessageId,acceptedAt}` or `{ok:false,retryable,errorCode,message}`.

Notification registration calls `bus.subscribe({eventName: "form.submission.received", handler})` and returns the host bus unsubscriber.

## Minimal wiring

```ts
import { createFormDefinition, submitForm } from "@jini-ai/cms-forms";
import { executeCommand } from "@jini-ai/cms/core";

// host provides all adapters and policies named here
const { definition } = await createFormDefinition({
  deps: { executeCommand, repo: definitionRepo, clock, idGen, changeSets,
    permission: formWritePermission, reservedSlugs, authorize },
  input: { workspaceId, actor, name: "Contact", slug: "contact",
    fields: [{ id: "message", label: "Message", type: "textarea", required: true }] },
}, { idempotencyKey: commandKey });
await submitForm({
  deps: { definitionRepo, submissionRepo, outbox, dispatcher, logger, clock, idGen, rateLimiter },
  input: { workspaceId, slug: definition.slug, sourceIp,
    body: { message: "Hello", _hp: "" } },
});
```

No routes, UI renderers, concrete repositories, mail transports or pagination endpoints are exported. Source evidence: `src/index.ts`, `src/types.ts`, `src/ports.ts` and the named service files.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `FormDefinitionNotFoundError`, `FormFieldValidationError`, `FormRateLimitExceededError`, `FormSlugConflictError`, `FormSubmissionNotFoundError`, `FormSubmissionValidationError` | class; [errors.ts](../../src/errors.ts) |

## Current manifest boundary

The current `package.json` exposes `.`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.

## Phase 1 live API addendum (2026-10-26)

The active consumed entry is `@jini-ai/cms/forms` (`packages/cms/src/forms/index.ts`), with `forms/express` and `forms/submission-attempts` subpaths; the earlier private `cms-forms` snapshot above is historical. See [DR-004](../decisions/DR-004-basic-live-submission-timing.md).

- `createSubmissionAttempts({hash}, {windowMs?, maxEntries?} = {})` retains its existing claim API and adds `issue({workspaceId, slug, attemptToken, issuedAtMs}, {})` and `ageMs({workspaceId, slug, attemptToken, nowMs}, {})`. The latter returns a nonnegative age or `undefined` when timing evidence is unavailable. `FORM_ATTEMPT_MAX_AGE_MS` is two hours; `MIN_FORM_SUBMISSION_AGE_MS` is 1000.
- `submitForm({deps,input}, {attempts?, definitionView?, validateEmails?, dispatch?} = {})` applies the timing rule only when the shared attempts owner has usable issuance evidence. The success contract remains `{status:"accepted"}` for persisted submissions, duplicates and honeypot discards.
- `FormSubmissionTooFastError({}, {})` has fixed copy and stable code `FORMS_SUBMISSION_TOO_FAST`. The Express adapter maps it to JSON 422 or a safe native 303 with `{kind:"too-fast",slug}` and the existing eligible-text flash cookie. Neither token nor answers enter the redirect query.
