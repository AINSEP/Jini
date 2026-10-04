Spec ID: SPEC-JINI-CMS-FORMS-STATE
Version: 2.1.0
Last Edited: 2026-10-04
Hash: sha256:a18cf66a8b2d44d175a5d3bd0ac7a4849d098db3c34c2e1935af6f8a01be1f9a
spec_mode: reverse_spec
Hash basis: UTF-8 Markdown body from the first heading through EOF


# Forms state and persistence contract

## Definition lifecycle

Creation persists an `active` definition with `version:1`. Status changes permit `active ↔ disabled`; there is no deletion method. Updates preserve ID, workspace, slug, creation time, current status and version while replacing selected fields and `updatedAt`. Slugs remain reserved by trashed adapter rows. There is no optimistic version guard, package cache or background lifecycle worker.

`FormDefinitionRepoPort` stores definitions. Its workspace-scoped reads/updates expose live records only; the adapter owns uniqueness and durable storage. The command executor and `ChangeSetRepoPort` own audit records and command-key rejection. Writer mutations have null inverse payloads and no rollback callback, so state restoration after audit failure requires host-level transaction handling.

## Submission and event lifecycle

A valid non-honeypot submission creates one submission record. Its answers, timestamp and identity are immutable. `sweepExpiredSubmissionIps` clears only `sourceIp` after 90 days through a dedicated maintenance port; the persisted field may be null. The package exports no submission deletion operation. Definition schema changes do not migrate historical `data`; the notification handler reads the original submission data against the current notification config.

Persistence order is submission → outbox enqueue → background dispatch. There is no atomic boundary between the first two effects. The outbox, dispatcher and host event bus own delivery durability, recovery and replay. Retrying submission is not deduplicated.

## Notification lifecycle

`registerFormNotifySubscriber` resolves to an async unsubscriber supplied by the host bus. Call it during host shutdown or before replacing that registration. Repeated registration is not locally deduplicated. The subscriber owns no cache, queue, persisted delivery status or retry timer. Recipient idempotency keys are delegated to the mail adapter; their lifetime is not defined here.

The subscriber uses the object-shaped CMS EventBusPort contract. Lifecycle behavior is described in `behavior.spec.md`.

## Host responsibilities

The host owns retention for submission contents, trash visibility, concurrent-write constraints, limiter state, event replay, mail deduplication and shutdown ordering. The package owns the 90-day submitter-IP policy; hosts supply the atomic maintenance adapter, boot/daily scheduling and shutdown. A sweep includes Trash rows and all workspaces, keeping the submission itself. See [DR-002](../decisions/DR-002-submission-ip-retention.md).

Evidence: `src/types.ts`, `src/ports.ts`, `src/write-service.ts`, `src/submit-service.ts`, `src/notify-subscriber.ts`.
