---
name: railway
description: Deploy existing Railway services, inspect status and logs, stage variables, and generate railway.json for the host's server.
---

# Railway server deployment

This plugin is **Untested**: the connection has not been tried end to end with live credentials.
Offline fake tests do not establish live compatibility. Deploying ships code, not site content.
Use the deployment tools in chat, never Bash or a Railway CLI.

## Railway token

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks. Saving a token deploys nothing.

First list saved credential labels and check for a saved token and reuse it.
Otherwise open **Connect Railway** with
open the secure connection card; it saves as `Railway API`.
The person creates the token under Account Settings → Tokens and selects the site's workspace.
A project token from a project's settings will not work here.
Never ask for a token in chat. Never offer to replace a working token unless asked.

Railway has no save-time probe. `verify the saved credential` cannot tell whether a Railway key
works: it sends a GET to the GraphQL URL, so the result is "unreachable". Use
`list deployment targets { platform: "railway", org: "<workspace UUID>" }` to check the key.
The existing `org` input carries the workspace ID, not its display name. Omitting it lists the
personal projects accessible to an account token; supply it for a workspace token.

## Select and deploy an existing service

List targets first. Each target is `projectUUID:environmentUUID:serviceUUID`; copy the returned
ID exactly. Discovery lists actual service instances, bounded to 10 projects, 10 environments
per project, 50 instances per environment and 500 targets overall. If discovery is incomplete,
it refuses the result. Obtain the exact IDs from Railway's console rather than guessing a target.
No service, disk, region, volume or billing resource is created by this adapter.

Call `start a deployment` with `platform: "railway"` and the selected `target`.
`ref` accepts a full 40-character commit SHA only. Omitting it deploys the service's currently
associated commit; it does not promise the latest branch head. Branches and tags are refused.
The service must already have a source configured in Railway.

A returned `started: true` means Railway accepted the request. Keep its `runId` and pass it
with the same target to `wait for deployment completion` until finished, then check the live URL with
`fetch_live_url`. Status without a run ID inspects the latest deployment. Unknown vendor states
remain unknown. Read bounded runtime logs with `read deployment logs`; logs are snapshots,
not a stream. If a write loses its connection, check status before deciding whether to retry.
Never automatically retry a deployment or variable write.

## Variables

Use `list deployment secret names` to list names only. Use the host's masked entry/site-key flow
and overwrite confirmation with `save a deployment secret securely`. Values never belong in chat.
Writes use `skipDeploys: true`: stage all variables, then deploy once. Running instances keep
their current values until that deploy. Secret readback/copy is unavailable.
Removal must be done in the provider console: Railway's list has no digest or update time,
so the host cannot perform its required revision check for `remove a deployment secret with confirmation`.

## Generate the settings file

Writing `railway.json` needs **no token**. Do not open a key card for that task.
Follow the host guidance first: it names how this host generates `railway.json`. The
generator uses the host's server descriptor for the Dockerfile, port and health check. Follow
its notes to create the volume and set required variables before the first deploy. Secret
values never appear in the generated file. Keep one instance when state lives on the volume
(SQLite).
