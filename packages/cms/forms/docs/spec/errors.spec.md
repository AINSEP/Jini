Spec ID: SPEC-JINI-CMS-FORMS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:0c069e0eca67f359946da65934752f735adf8f8488ac74d9c24a1645454dbaca
spec_mode: reverse_spec


# Forms error contract

## Domain rejections

All six classes extend `Error`. They have no stable `.code` and do not set a custom `.name`. Branch on the exported class and structured properties, not message parsing. Constructors currently take one required object.

| Class and constructor input | When surfaced | Caller response |
| --- | --- | --- |
| `FormFieldValidationError({message,fieldErrors})` | Invalid name, slug/reserved slug, fields, notify config or removal of an existing field ID | Show `{field,reason}` errors and correct the definition; do not retry unchanged input. |
| `FormSubmissionValidationError({message,fieldErrors})` | Submission has unknown keys, missing required values, incorrect value types or excessive text length | Correct the submission; field errors are in the documented order. |
| `FormSlugConflictError({message,slug})` | The definition adapter rejects a duplicate workspace slug; the writer does not construct this error itself | Choose another slug or read the existing definition. Adapter implementations must translate their uniqueness failure. |
| `FormDefinitionNotFoundError({message})` | Update/status cannot find a live ID; submit cannot find an active slug | Treat as unavailable; public callers must not distinguish missing from disabled forms. |
| `FormSubmissionNotFoundError({message})` | Exported for host adapters; no package service constructs it | Treat as unavailable if a host surfaces it. The notification handler silently skips absent submissions. |
| `FormRateLimitExceededError({message,retryAfterSeconds})` | Host limiter returns `{allowed:false}` after valid submission data | Wait for the supplied interval; transport adapters may expose a retry-after value. |

The pure validators return discriminated validation results; they do not throw these domain classes for well-typed inputs. Invalid outer JavaScript shapes can still produce ordinary runtime exceptions.

## Dependency failures

Definition writes propagate executor failures, including CMS `ForbiddenError` and `DuplicateCommandError`; those classes are not re-exported from forms. Handle authorization denial without revealing prior command results; on a duplicate command, read current state using the referenced change set rather than resubmitting the mutation.

Repository, clock, ID, limiter and enqueue exceptions propagate from `submitForm`. In particular, failed enqueue may follow a successful submission insert; investigate persistence before retrying. Background dispatcher failure is logged and cannot reject the accepted response.

Subscription registration errors reject `registerFormNotifySubscriber`. Once subscribed, handler repository/mail/logging failures are caught. `{ok:false,retryable,errorCode,message}` mail results are logged; the subscriber does not retry or return those codes to the submitter.

Notification registration calls `bus.subscribe({eventName: "form.submission.received", handler})` and returns the host bus unsubscriber.

The host owns transport status codes, public redaction, retry policies and monitoring. Evidence: `src/errors.ts`, `src/ports.ts` and service implementations.
