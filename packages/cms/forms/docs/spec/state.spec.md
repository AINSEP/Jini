Spec ID: SPEC-JINI-CMS-FORMS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5b0d85e61cd0e9129397ca47d91b42a04f0c8e7f839241244723ae9298eb36e1
spec_mode: reverse_spec


# Forms state and persistence contract

## Definition lifecycle

Creation persists an `active` definition with `version:1`. Status changes permit `active ↔ disabled`; there is no deletion method. Updates preserve ID, workspace, slug, creation time, current status and version while replacing selected fields and `updatedAt`. Slugs remain reserved by trashed adapter rows. There is no optimistic version guard, package cache or background lifecycle worker.

`FormDefinitionRepoPort` stores definitions. Its workspace-scoped reads/updates expose live records only; the adapter owns uniqueness and durable storage. The command executor and `ChangeSetRepoPort` own audit records and command-key rejection. Writer mutations have null inverse payloads and no rollback callback, so state restoration after audit failure requires host-level transaction handling.

## Submission and event lifecycle

A valid non-honeypot submission creates one immutable submission record. The package exports no submission update/delete operation. Definition schema changes do not migrate historical `data`; the notification handler reads the original submission data against the current notification config.

Persistence order is submission → outbox enqueue → background dispatch. There is no atomic boundary between the first two effects. The outbox, dispatcher and host event bus own delivery durability, recovery and replay. Retrying submission is not deduplicated.

## Notification lifecycle

`registerFormNotifySubscriber` resolves to an async unsubscriber supplied by the host bus. Call it during host shutdown or before replacing that registration. Repeated registration is not locally deduplicated. The subscriber owns no cache, queue, persisted delivery status or retry timer. Recipient idempotency keys are delegated to the mail adapter; their lifetime is not defined here.

The subscriber uses the object-shaped CMS EventBusPort contract. Lifecycle behavior is described in `behavior.spec.md`.

## Host responsibilities

The host owns retention for submission contents and source IPs, trash visibility, concurrent-write constraints, limiter state, event replay, mail deduplication and shutdown ordering. No package cleanup/disposal operation applies beyond the returned unsubscriber.

Evidence: `src/types.ts`, `src/ports.ts`, `src/write-service.ts`, `src/submit-service.ts`, `src/notify-subscriber.ts`.
