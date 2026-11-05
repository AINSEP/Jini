---
name: infrastructure-as-code
version: 1.0.0
last_updated: 2026-02-26
description: IaC declaration patterns for infrastructure required by pipeline-delivered features.
---

# Skill: Infrastructure as Code

Infrastructure that exists only as manual configuration is infrastructure that cannot be reproduced, reviewed, or rolled back. This skill covers how to declare infrastructure as code so that every environment is a deterministic function of its declaration files.

## What IaC Covers

- **Compute** (servers, containers, serverless functions)
- **Storage** (databases, object storage, queues, caches)
- **Networking** (load balancers, DNS, firewall rules, VPCs)
- **IAM** (roles, policies, service accounts)
- **Secrets** (references to secrets manager entries — never values)

## Tool Selection Guidance

- **Terraform**: most widely used, large provider ecosystem, HCL syntax, state management required.
- **Pulumi**: same as Terraform but in real programming languages (TypeScript, Python) — preferred when team is already in those languages.
- **AWS CDK**: TypeScript/Python, AWS-only, good for AWS-native teams.
- **Platform-native** (Vercel, Railway, Render): use platform's config files for simple deployments — do not over-engineer.

## Structure Conventions

- Separate modules by concern: `networking/`, `compute/`, `storage/`, `iam/`.
- Environments via workspaces or variable files — not separate module trees.
- State backend: remote state (S3 + DynamoDB lock for Terraform) — never local state in a team context.
- Pin provider versions: `~> 4.0` not `>= 4.0` — prevents unexpected major version upgrades.

## What to Declare vs What to Assume

- **Declare**: any resource the feature requires that does not already exist.
- **Assume**: shared infrastructure (VPC, base networking) — reference by output/data source, do not recreate.
- Never declare production databases in feature branch IaC — database schema changes go through Database Agent + migration pipeline.

## Secrets in IaC

- Never store secret values in IaC code or state.
- Reference secrets manager entries by path/ARN only.
- IAM policy grants the service role access to the specific secret path.
- Example: `aws_secretsmanager_secret_version` data source — read at runtime, not at plan time.

## Drift Detection

- IaC drift = infrastructure state differs from declared state.
- CI should run `terraform plan` (or equivalent) on every PR touching IaC files.
- A plan with unexpected changes blocks merge — investigate before applying.
