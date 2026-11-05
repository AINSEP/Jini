# Setup Deploy

## When

Use to detect and document how a project deploys before using release, landing, or canary workflows.

## Workflow

1. Inspect repo configuration: Dockerfiles, CI workflows, platform config, package scripts, env examples, and deployment docs.
2. Identify platform candidates such as Vercel, Netlify, Render, Fly.io, Heroku, GitHub Actions, Expo/EAS, or custom scripts.
3. Record deploy commands, required environment variable names, staging/production URLs, health checks, and rollback path.
4. Identify missing access, unknown secrets, or unsafe manual steps.
5. Produce or update a deploy playbook only when the user asks for file changes.

## Output

- Platform detection summary
- Deploy command inventory
- Environment variable names only
- Health and rollback notes
- Open questions and access requirements

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that edit deploy configuration, change secrets handling, clean caches, or trigger external deployments. Do not proceed until the user says "yes" or "approved".
- Never write secret values.
- Do not assume a platform from one config file if conflicting evidence exists.
