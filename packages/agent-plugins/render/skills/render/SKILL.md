---
name: render
description: Configure and deploy existing Render server services, inspect status and recent logs, and stage environment variables securely.
---

# Render server deployment

The in-app assistant uses tools, never Bash or a Render CLI. Reuse an existing,
already-configured server service. Do not create paid resources, change billing,
scale services or provision disks. Static sites and cron jobs are unsupported.
Deploying ships code, not site content. Keep one server instance when its state
lives on the persistent disk (SQLite), and configure that disk before deployment.
Follow the host guidance first: it names how this host generates `render.yaml`.

The `render.yaml` generator uses the host's server descriptor for the Dockerfile,
port, health check, persistent disk and secret names, plus the non-secret variables
the host passes. Secret values are never emitted; `sync: false` leaves them for
secure setup.
Writing `render.yaml` needs **no key**. Do not open a key card for that task.

## Render API key

Choose the card yourself from its `usedFor` list. Reuse a saved key or working
sign-in for that task. Never offer a replacement unless the person asks.
Check `content_read.custom_credential {}` for a saved key first.
Otherwise open **Connect Render** with
`credential_save { kind: "plugin-provider", target: "render" }`; it saves as `Render API`.
The person creates the key under Account Settings → API Keys. A deploy hook URL
is not a key.
Saving a key deploys nothing. Untested: this connection has not been tried end to end.
Never ask for a key in chat. Never offer to replace a working key unless asked.

## Deploy and observe

Use `deployment_ops_list_targets` with platform `render` to discover server
services. Optional `org` filters by workspace ID. Choose the existing `srv-…`
service; discovery refuses incomplete results at 500 services rather than hiding
choices. Then use `deployment_ops_deploy` with that target. Omit `ref` to use the
latest commit on the service's connected branch. Only a full 40-character commit
SHA is supported as an explicit `ref`; branch and tag names are refused.
The API must accept the request before the tool reports it started. A connection
failure may mean the request was accepted: inspect Render before retrying.

Keep the returned `dep-…` runId for `deployment_ops_status` and
`deployment_ops_wait`. A deploy queued behind a running one returns no runId; wait on
the service's latest deployment instead. Accepted does not mean live. Unknown states remain unknown.
`deployment_ops_logs` resolves the service's workspace and returns a bounded page
(at most 100 lines) of recent **service logs**, newest first, defaulting to Render's last-hour window.
These logs are not isolated to the selected deployment; a supplied runId is
checked through the service-scoped deployment endpoint. Branch filters are unsupported.
Check the live service after the deployment becomes healthy.

## Environment variables

Use the existing deployment secret tools and masked entry/site-key source; never
put values in chat. Listing returns names only, never values. Setting a key uses
an individual-key PUT and preserves unrelated variables. Changes are staged and
need a deployment to reach the running service. Set all needed keys, then deploy.
The listing is capped at 500 and reports truncation. No secret readback or copying
is provided. Render supplies no revision metadata for safe removal, so use the
provider console to remove variables when the host refuses the removal tool.

The Render API key card checks access with a read-only GET before saving the key.
