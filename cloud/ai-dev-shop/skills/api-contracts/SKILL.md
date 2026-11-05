---
name: api-contracts
version: 1.0.1
last_updated: 2026-03-19
description: Governs concrete API contract completeness, OpenAPI generation readiness, and compatibility verification after the API style has already been chosen.
---

# Skill: API Contracts

An API contract is a promise to consumers. Breaking that promise — changing a field type, removing an endpoint, altering error shapes — has the same downstream impact as a production outage. This skill governs how concrete contracts are validated, rendered into OpenAPI, and checked for compatibility after the API style and lifecycle policy have already been chosen.

Use `skills/api-design/SKILL.md` first when the work involves style selection, versioning strategy, deprecation policy, rate-limit policy, or other design-level contract choices. This skill assumes those decisions already exist and focuses on endpoint-by-endpoint completeness.

## What a Complete API Contract Requires (per endpoint)

- HTTP method and path
- Path parameters, query parameters, request headers (name, type, required/optional, constraints)
- Request body schema (all fields, types, required/optional, validation rules, examples)
- Response schemas for each status code: 200/201, 400, 401, 403, 404, 409, 422, 429, 500 minimum
- Auth requirement (none / API key / Bearer JWT / session)
- Rate limit (requests per window, per what scope: IP / user / API key)
- Idempotency behavior (is POST idempotent? Is it safe to retry? What is the idempotency key?)

## OpenAPI 3.x Generation Rules

- Every endpoint in api.spec.md maps to one OpenAPI path + operation object.
- Request/response schemas use JSON Schema — no `$ref` to undefined schemas.
- Examples are required for all request and response bodies.
- `operationId` must be unique, snake_case, verb-first (e.g. `create_invoice`, `list_invoices`).

## Lifecycle Boundary

- Do not choose versioning strategy here. Load `skills/api-design/references/versioning-and-lifecycle.md` for lifecycle policy.
- Do not design rollout or migration here. Load `skills/change-management/SKILL.md` for expand-contract execution.
- If a proposed change removes or renames a field, changes a field type, tightens requiredness, changes auth behavior, or changes error structure, flag it as a compatibility event and route to `api-design` plus `change-management`.

## Consumer-Driven Contract Testing (Pact)

- Consumer defines expectations (request shape + response shape it needs).
- Provider verifies it can satisfy those expectations.
- Pact broker stores contracts between teams.
- Use when: multiple teams consume your API, or you have a public API with versioned consumers.
