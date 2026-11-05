# Contract Testing

The ADR defines API and event contracts. Contract tests verify the implementation actually honors those contracts. These are distinct from acceptance tests (which test user-visible behavior) and unit tests (which test logic).

## When to Write Contract Tests

- Any interface defined in the ADR's API/Event Contract Summary section
- Any event published or consumed across a module boundary
- Any external service integration where you control the schema

## Testing Approach by Contract Type

| Contract Type | Recommended Approach | Tool Examples |
|---|---|---|
| HTTP/REST API | Schema validation against OpenAPI spec | Schemathesis, Dredd |
| Consumer-driven (provider must satisfy consumer) | Consumer-driven contract tests | Pact |
| Internal event contracts | Integration test: publish event, assert consumer behavior | Native test framework |
| GraphQL | Schema + query validation | graphql-inspector |

## Contract Test Requirements

- Each contract in the ADR must have at least one contract test.
- Contract tests verify the shape and behavior of the interface, not the implementation behind it.
- If the Software Architect flagged a contract as `consumer-driven`, generate a Pact contract file.
- If the Software Architect flagged `schema validation`, generate tests against the OpenAPI schema.
- For cross-domain boundaries, do not rely on freehand mocks as the primary signal; prefer contract fixtures or schemas derived from the ADR contract source.
- If a mock is used at a boundary, validate it against the contract shape so tests fail on contract drift.

## Certification Record Example

```md
Contract Tests:
- IInvoiceRepository: integration test (see tests/contracts/invoice-repository.test.ts)
- InvoiceCreated event: schema validation (see tests/contracts/invoice-created.schema.test.ts)
```

## Gap Rule

If a contract cannot be tested, such as a third-party API with no sandbox, document it as a High-risk gap in the certification record with justification.

## Cross-Domain Reliability Signal

If unit and integration suites are passing but QA/E2E repeatedly fails on cross-domain journeys, treat this as probable contract drift or over-mocking and escalate to Coordinator for contract/test redesign before continuing cycles.
