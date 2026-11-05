---
name: e2e-test-architecture
version: 1.0.0
last_updated: 2026-02-26
description: Stable E2E test patterns using Playwright, anti-flake rules, fixture strategy, selector discipline, and CI integration.
---

# Skill: E2E Test Architecture

E2E tests validate what the user experiences, not what the code does internally. They are the most expensive tests to write and maintain, so they must be reserved for user journeys and critical paths — never for logic that unit or integration tests already cover. This skill defines the patterns that keep E2E tests stable, fast, and worth the maintenance cost.

## When to Write E2E Tests vs Unit/Integration Tests

- **E2E tests**: user journeys, multi-step workflows, full auth flows, critical happy paths.
- **Integration tests (TDD layer)**: service boundaries, API contracts, database interactions.
- **Unit tests (TDD layer)**: pure logic, transformations, validators.
- **Rule**: E2E tests are expensive to run and maintain — write them for journeys, not for logic.

## Playwright Patterns

### Page Object Model
- One class per page or major UI component.
- Class exposes user actions (methods), not DOM selectors.
- Example: `invoicePage.fillLineItem({ description, quantity, price })` not `page.fill('#desc', 'x')`.
- Selectors live only in the page object — never in the test body.

### Selector Hierarchy (most to least preferred)
1. ARIA role + accessible name: `getByRole('button', { name: 'Save Invoice' })`
2. Label: `getByLabel('Invoice Number')`
3. Test ID: `getByTestId('invoice-submit')` (requires `data-testid` attribute in component)
4. Text: `getByText('Submit')` (fragile for i18n — use sparingly)
5. CSS class or XPath: never use in E2E tests

## Anti-Flake Rules

- Never use `waitForTimeout` or `page.waitForTimeout` — always wait for a specific condition.
- Use `waitForResponse` when an action triggers an API call.
- Use `waitForSelector` or role-based locator assertions when waiting for UI state.
- Use `page.waitForLoadState('networkidle')` only when truly needed — prefer explicit waits.
- Isolate test data: each test creates its own fixtures and cleans up after itself.
- Never share mutable state between tests.
- Tests must pass in any order and in parallel.

## Fixture Strategy

- Seed fixtures via API calls (not by manipulating DB directly) — this tests the API too.
- Clean up fixtures in `afterEach` — do not rely on test order for cleanup.
- Use factory functions for fixture creation — makes test setup readable.
- Synthetic data only — follow `<AI_DEV_SHOP_ROOT>/framework/governance/data-classification.md` PII patterns.

## Auth in E2E Tests

- Never re-test the auth flow in every test — log in once via API and store session state.
- Playwright `storageState` for session persistence across tests in a file.
- One auth fixture per role (admin, regular user, guest) — reused across all tests needing that role.

## CI Integration

- E2E tests run in headless mode on CI.
- Browser must be installed in CI image (`npx playwright install --with-deps`).
- Parallel workers: use `--workers=4` or match CI machine core count.
- Retry on failure: `--retries=1` in CI only (never locally — masks flaky tests).
- Test artifacts: screenshots and traces on failure (`--trace=on-first-retry`).
