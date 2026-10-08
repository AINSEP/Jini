Deprecated: use `@jini-ai/cms/forms` (same API; adapters at `/html`, `/sql`, `/express`).

Deprecated package: use `@jini-ai/cms/forms` for new consumers. This package is marked for npm deprecation in the owner's publish. Keep `packages/cms/forms` until the consumer forms switch is complete: existing workspace links still resolve to this folder. No npm deprecation has been issued by this metadata change.

Configurable forms in the CMS family. The root export includes field and submission validation, honeypot handling, domain errors and records, audited definition writes, anonymous submissions, rate-limit key construction, and notification subscribers. The package uses Apache-2.0 licensing.

Runtime code has no framework, Node, database, mail-provider, or CMS implementation imports. CMS contracts are type-only dependencies from `@jini-ai/cms/core`. The successor lives in the CMS package at `@jini-ai/cms/forms`, with separate `/html`, `/sql` and `/express` adapters.

Every public function accepts a required object and, where applicable, a second optional object. Consumers bind repositories, clock, IDs, authorization, reserved slugs, permission names, rate limits, outbox, background dispatcher, logger, mailer, sender and audited command execution.

```ts
import { executeCommand } from "@jini-ai/cms/core";
import { createFormDefinition } from "@jini-ai/cms-forms";

const { definition } = await createFormDefinition(
  {
    deps: {
      repo, clock, idGen, changeSets, authorize, executeCommand,
      permission: formWritePermission,
      reservedSlugs,
    },
    input: { workspaceId, actor, name, slug, fields },
  },
  { notify, idempotencyKey, outbox },
);
```

The command executor port preserves the CMS gateway's generic result and audit contract; hosts may bind their own compatible gateway. Optional notification configuration, idempotency keys and definition-write outbox wiring belong in the second argument. Anonymous submission dependencies and input are passed as `submitForm({ deps, input })`. Subscriber dependencies are passed as `registerFormNotifySubscriber({ bus, sender, logger, mailer, formDefinitionRepo, formSubmissionRepo })`.

Repositories, HTTP routes, tool registration, concrete rate-limit profiles, pagination adapters, mail transports and composition remain consumer responsibilities. Source validation, event names, error messages, notification deduplication and effect ordering are preserved by the moved tests. Submission persistence and outbox enqueue remain separate awaited effects; background dispatch does not delay acceptance. Atomicity depends on the injected host adapters.

See [API.md](./API.md) for the source mapping, caller inventory, changed files and exact verification commands. Tests, typechecks, builds and packing were not run under the owner's directive; dependencies and generated output must be prepared later by the coordinator.

## Design decisions

- [Anonymous submissions isolate spam and notification failures](docs/decisions/DR-001-anonymous-submission-containment.md).

Runtime contracts use `Clock`, `IdGenerator` and JSON/ID/time types from
`@jini-ai/core/primitives`. The logger dependency is `Pick<Logger, 'warn'>`: call
`warn({ message }, { error })`. Notification subscriptions use
`bus.subscribe({ eventName, handler })`; change-set repositories use
`insert({ record, items }, { event })`.

The in-memory event-bus test fixture implements the CMS `EventBusPort`, including
`publishBatch({ events })` and `subscribeAll({ handler })`. A command gateway that
always rejects returns `Promise<never>`, preserving the executor's generic result contract.
