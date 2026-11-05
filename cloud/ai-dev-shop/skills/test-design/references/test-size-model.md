<!-- Source: Addy Osmani / agent-skills / test-driven-development -->

# Test Size Model

Test size describes the resources a test uses, not where it sits in the unit/integration/E2E pyramid.

This model catches distinctions the pyramid misses. A "unit" test that touches disk or starts a database is not small. An end-to-end test running entirely against localhost may be medium. Size is about execution constraints: process boundaries, I/O, network access, and dependency scope.

| Size | Resource profile | Examples | When to use |
|---|---|---|---|
| Small | Single process, no I/O, no network, no sleeps, deterministic runtime | Pure function tests, reducer tests, parser tests, validation logic | Fast feedback, high-volume regression coverage, TDD inner loop |
| Medium | May use multiple processes, filesystem, local database, or localhost network only; no external services | API tests against local server, tests with local Postgres, browser tests against localhost | Verify component integration while staying reproducible and CI-friendly |
| Large | Multi-machine, real external services, production-like infrastructure, third-party APIs, deployed environments | Staging smoke tests, cross-service workflow tests, payment sandbox tests, canary verification | Validate real-world behavior, deployment readiness, and external dependency contracts |

## Why This Matters

The pyramid answers "what kind of behavior are we testing?" The size model answers "how expensive and fragile is this test to run?"

A balanced suite usually has many small tests, a focused set of medium tests, and a carefully curated set of large tests. Large tests are valuable, but they should prove things smaller tests cannot prove.
