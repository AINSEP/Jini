# Jini decision records

These records state an invariant, why it exists, its consequences and the defect it prevents. They describe reusable engine contracts for any consumer. External archive identifiers and extraction paths are kept outside this repository.

## Shared decisions

- [Verified origins are a shared trust boundary](DR-001-verified-origin-trust.md).
- [One authorization evaluator at the execution boundary](DR-002-single-authorization-boundary.md).
- [UI effects have one lifecycle owner](DR-003-single-owner-ui-effects.md).
- [Human UI resources stay outside model-visible tool results](DR-004-human-surfaces-model-results.md).

- [Portable contracts and host composition](DR-005-portable-package-boundaries.md).

## Existing detailed records

- [change set outbox transaction boundary](change-set-outbox-transaction-boundary.md).
- [permission catalog migration](permission-catalog-migration.md).
- [settings json schema variant](settings-json-schema-variant.md).
- [taxonomy content type allow list](taxonomy-content-type-allow-list.md).

## Package decisions

- [agent-runtime](../../packages/agent-runtime/README.md#design-decisions).
- [chat](../../packages/chat/README.md#design-decisions).
- [cli](../../packages/cli/README.md#design-decisions).
- [cms](../../packages/cms/README.md#design-decisions).
- [cms/forms](../../packages/cms/forms/README.md#design-decisions).
- [core](../../packages/core/README.md#design-decisions).
- [db](../../packages/db/README.md#design-decisions).
- [diagnostics](../../packages/diagnostics/README.md#design-decisions).
- [http-kit](../../packages/http-kit/README.md#design-decisions).
- [integrations](../../packages/integrations/README.md#design-decisions).
- [mcp](../../packages/mcp/README.md#design-decisions).
- [platform](../../packages/platform/README.md#design-decisions).
- [plugins](../../packages/plugins/README.md#design-decisions).
- [server](../../packages/server/README.md#design-decisions).
- [ui](../../packages/ui/README.md#design-decisions).
- [user-management](../../packages/user-management/README.md#design-decisions).
- [vibecoding](../../packages/vibecoding/README.md#design-decisions).

- [daemon](../../packages/daemon/README.md#design-decisions).

- [infra](../../packages/infra/README.md#design-decisions).

## Adding a record

Number records per owning package as `DR-NNN-<slug>.md`; put cross-package rules here. Include context, decision, consequences, defect prevented and local source evidence. Link from the package README and add a rationale line to an existing behavior draft when it supports a stated guarantee. Keep inline comments concise and explain the local reason. Record missing provenance honestly; a local rationale is not proof of a recovered external decision.
