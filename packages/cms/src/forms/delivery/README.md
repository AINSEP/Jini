# Form delivery (`@jini-ai/cms/forms`)

Sends each accepted form submission to zero or more configured destinations (a spreadsheet, a
table, a CRM, ...) through the outbox, and coordinates pulling submissions from a remote receiver.
Everything here is generic: hosts supply persistence, settings, credentials and the adapters.

## How it fits

```
form.submission.received ──► planFormDeliveries ──► one plan + N child jobs (one transaction)
                                                       │
                       outbox worker (claims, retries, terminal failure, restart recovery)
                                                       │
form.submission.delivery ──► deliverFormJob ──► host deliver(job) ──► adapter.deliver(...)
```

1. **Plan once.** `planFormDeliveries` selects the enabled bindings whose `formIds` include the
   form (absent = every form, `[]` = none), freezes the binding, the form fields and the answers
   (never the source IP), generates each child job id and an idempotency key
   (`[submissionId, bindingId]`), and stores it all through `FormDeliveryPlanPort.once`. A replay
   returns the stored plan even if settings changed. An empty selection is still recorded, so
   bindings added later do not backfill old submissions.
2. **Deliver independently.** Each child job is its own outbox row; one failing destination never
   blocks another. A retry re-delivers the same job with the same idempotency key.
3. **Errors are codes.** `FormDeliveryError` carries only an allowlisted `FormDeliveryErrorCode`
   as its message, because the outbox stores the message verbatim. Thrown errors and unknown codes
   become retryable `delivery-failed`; adapter text never reaches the ledger.
4. **Retry policy.** `formDeliveryRetryPolicy({ backoffMs, maxAttempts })` returns a policy for the
   outbox's per-event resolver: non-retryable errors go terminal at once, `retryAfterMs` (capped at
   `FORM_DELIVERY_MAX_RETRY_AFTER_MS`, one hour) can lengthen but never shorten the host backoff.
5. **Status.** `formDeliveryStatusFromOutbox` derives `pending | retrying | completed | failed`,
   attempts, next retry time and a safe error code from the job's outbox row. There is no second
   status ledger.

## Pulling from a receiver

`withFormPullLease` admits one pull per receiver at a time. Automatic triggers are refused with
`recent` when the last pull started less than `FORM_PULL_RECENT_MS` (60 s) ago; manual pulls skip
that check but still get `already-running` while another pull holds the lease. The host's
`leaseMs` must outlast its bounded pull; an expired lease is free again, which recovers a crash.
`createFormPullTrigger` runs pulls in the background for triggers such as startup or sign-in,
reports failures to `onError`, and lets shutdown wait for live pulls. There are no timers.

## Public API

`FORM_DELIVERY_EVENT`, `FormDeliveryBinding`, `FormDeliveryJob`, `FormDeliveryPlan`,
`FormDeliveryPlanPort`, `FormDeliveryResult`, `FormDeliveryErrorCode`, `FormDeliveryError`,
`FORM_DELIVERY_MAX_RETRY_AFTER_MS`, `planFormDeliveries`, `deliverFormJob`,
`createFormDeliverySubscriptions`, `formDeliveryRetryPolicy`, `formDeliveryStatusFromOutbox`,
`withFormPullLease`, `FormPullLeasePort`, `FORM_PULL_RECENT_MS`, `createFormPullTrigger`.

## Extension points

- **A new destination** is an adapter the host loads; it receives the frozen job plus a credential
  the host resolves fresh from `binding.connectionRef` on every attempt, and returns
  `FormDeliveryResult` (or nothing). Nothing in this folder changes per destination.
- **A new credential kind** (for example OAuth) is a new host credential resolver behind the same
  `connectionRef`; jobs never store credentials.
- **Deleting a submission locally** does not remove copies already delivered to a destination.
