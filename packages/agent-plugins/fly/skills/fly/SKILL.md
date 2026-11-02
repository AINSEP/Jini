---
name: fly
description: Deploy the host's server to fly.io with no CLI installed (flyctl runs on GitHub's runner) - one machine only for volume-backed state, secrets never in fly.toml, and deploying ships code, not content. Publishing a static export to a host is not this plugin's job - each host is its own plugin.
---

# Deploy the server to fly.io

Follow the host guidance first: it names the server's own rules (secrets, mount path, port,
production switch, first-boot steps) and its full procedure. This skill holds what is true for
any server on Fly.

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open **Connect Fly.io** with `credential_save {kind:"plugin-provider",target:"fly"}` for a new key. The card explains app-scoped deploy tokens and saves the `fly.io` credential with both API origins. In the Fly dashboard select the real app or organization, then **Tokens**; there is no universal app token-creation URL to guess. Only if the person explicitly asks to replace the saved key, rotate the existing row through `credential_save {kind:"api",target:"fly.io"}`.

## Scope

This plugin deploys **the server itself** (app, admin, database), not a static export. Static hosts
are their own plugins.

## Deploying to fly.io

The server goes on one fly.io machine through a GitHub Actions workflow, so nobody installs flyctl
or Docker. Say first: deploying ships code, not content. Rules that generic fly.io advice gets wrong:

- **One machine only** when state lives on a Fly volume (SQLite): a volume attaches to one machine,
  so a second machine gets its own divergent database. Never scale above 1 or autoscale.
- **The volume hides the image's files at its mount path.** Nothing the server reads at boot may
  live there in the image.
- **Secrets go through `flyctl secrets set`**, never `fly.toml`, which is committed and public.
- **The volume exists before the first deploy.** The workflow mounts it; it does not create it.

The two templates the procedure writes are `references/fly.template.toml` and
`references/fly-deploy.template.yml` (read them with this plugin's own tool,
`file: "references/<name>"`). Every `<<PLACEHOLDER: ...>>` must be replaced; re-read the written
files and confirm none survives. Every GitHub step belongs to the host's GitHub plugin.

## When it fails

Explain the cause in one plain sentence and the one next step.
