---
name: devops-delivery
version: 1.0.0
last_updated: 2026-02-26
description: CI/CD pipeline patterns, Docker build standards, deployment strategies, and environment management for the pipeline's delivery output.
---

# Skill: DevOps Delivery

The pipeline produces tested, reviewed, secure code. This skill covers the last mile: getting that code into production safely and repeatably. Every deployment must be automated, every rollback must be pre-planned, and no environment should differ from another in ways that are not explicitly declared.

## Dockerfile Standards

- **Multi-stage builds**: separate build stage from runtime stage.
- **Non-root user**: Run the application as a non-root user in runtime stage.
- **No secrets in Dockerfile**: use build args for build-time values, environment variables for runtime.
- **Layer caching strategy**: copy dependency manifests before source code.
- **Health check instruction**: Include HEALTHCHECK instruction in Dockerfile.

## CI/CD Pipeline Stages (GitHub Actions reference pattern)

- **lint and type-check**: fast, blocks everything.
- **unit and integration tests**: run in parallel where possible.
- **build and push image**: only on success.
- **security scan**: image scan + SAST — reference `<AI_DEV_SHOP_ROOT>/skills/security-review/SKILL.md` for what to scan.
- **deploy to staging**: automatic on main merge.
- **smoke test**: run against staging.
- **deploy to production**: manual approval gate or automated with rollback trigger.

## Deployment Strategies

- **Rolling**: replace instances one at a time; zero downtime but mixed versions briefly active.
- **Blue/Green**: run two identical environments, switch traffic; instant rollback, higher infra cost.
- **Canary**: route small % of traffic to new version; catch issues before full rollout; requires feature flag or load balancer support.
- **Choose based on**: criticality of service, rollback speed requirement, infra cost tolerance.

## Delivery Principles

**Shift Left.** Move quality checks as early in the pipeline as possible — a failure caught in lint costs nothing; the same failure caught in production costs everything. Every gate that can run before the next one should.

Load `references/quality-gate-pipeline.md` for the full gate sequence diagram and CI optimization strategies.
Load `references/pre-launch-checklist.md` before any production deployment.
Load `references/rollout-decision-thresholds.md` during or after a rollout to decide advance/hold/rollback.

*Source: Addy Osmani / agent-skills / ci-cd-and-automation, shipping-and-launch*

## Environment Management

- Promote artifacts (not source) through environments: dev → staging → production.
- Environment-specific config via environment variables — never baked into the image.
- Secrets via secrets manager — never in environment variable plaintext in CI config.

## Health Checks and Readiness

- **Liveness probe**: is the process alive? (simple HTTP 200)
- **Readiness probe**: is the service ready to receive traffic? (checks DB connection, downstream dependencies)
- Never route traffic before readiness probe passes.

## Rollback Procedure Template

- Define rollback trigger (error rate threshold, latency threshold).
- Previous image tag must be available and pinned.
- Database migrations must be backward-compatible with previous version (never drop columns in same release as stop-writing).
