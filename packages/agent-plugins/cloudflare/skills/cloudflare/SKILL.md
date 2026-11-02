---
name: cloudflare
description: Publish a site's static exports to Cloudflare Workers or Pages and attach apex plus www domains after a human reviews the exact current infrastructure and changes. Explains token permissions, limits and partial results.
---

# Cloudflare

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open the plugin’s own card for the selected destination: `credential_save {kind:"plugin-provider",target:"cloudflare-workers"}` or `credential_save {kind:"plugin-provider",target:"cloudflare-pages"}`. Each card explains its permissions and collects the Account ID and optional Zone ID along with the masked token. Read `references/permissions.md` before requesting custom-domain access.

Use `deployment_get_static_publish_capabilities` → `deployment_preview_static_publish` →
`deployment_execute_static_publish`. Prefer **Workers** (`cloudflare-workers`) for a **new** destination.
Keep **Pages** (`cloudflare-pages`) for existing Pages history/bindings or an explicit Pages choice.
A plugin upgrade never moves an existing site between products. Use `lastPublish` and the exact
`resourceName` from its config. Never guess a workers.dev account subdomain.

This hosts **static exports only**, including exported HTML, CSS, JavaScript and media. It does not run
the host's server, database, admin, dynamic forms, authentication or server rendering.

Load [permissions](references/permissions.md) before requesting a connection, and
[domains](references/domains.md) before any domain change. Load [Workers](references/workers.md) or
[Pages](references/pages.md) for the selected target, and [troubleshooting](references/troubleshooting.md)
when a check fails.

A preview with authenticated inspection needs `projectName`, using the SAME label as execute, plus
`target`, optional `credentialId`, and the descriptor's config fields. It issues authenticated **GETs
only**. Secrets are resolved server-side, never returned. Domain input is `customDomain` (apex only,
e.g. the person's actual domain) and optional `zoneId`. Both apex and www are inspected and attached.
Never invent an account, domain or project name for the person.

The execute tool shows the exact current records/bindings/routes and changes in a human confirmation
card. Only the person's click authorizes domain cutover. A model-supplied `confirmed:true`, opaque
request flag or chat assertion is not approval. Unknown/incomplete inventory refuses domain changes.
If state or the credential changes, preview and confirm again. The current HTTP publish route cannot
approve domains; guide the person to the existing chat confirmation card until the domain UI lands.

Keep one saved vendor connection: kind `vendor`, vendor `cloudflare`, encrypted
`{token, accountId, zoneId?}`. Open `credential_save` with kind `plugin-provider` and the selected target;
people enter secrets in its secure form, never chat. Keep existing Pages-only `worksFor` compatibility.
To add Workers/DNS capabilities, the person must explicitly update permissions/compatibility on that
same credential. Token active status alone proves no capability's permissions.
If the person asks to replace a token, list the exact permissions needed for the requested
operation from the permissions table and limit it to the selected account/zones. For a
Workers-only static publish, request Workers Scripts: Edit; add D1: Edit only for active forms.
For Pages-only publishing, request Cloudflare Pages: Edit. Add domain permissions only when needed.
Offer to help enable workers.dev when the chosen deployment needs it. If the account has no
subdomain, guide the person through Workers & Pages setup; never invent one or enable it silently.

Hosting accepted plus unfinished requested domains is `ok:"partial"` (tools: `published:true`,
`reachable:false`). Report every hostname's state and next step. Never say the requested site is live
until both hostnames have active validation/certificates and serve the deployed content over HTTPS.
There is no automatic rollback or step journal. For a partial cutover, inspect the current state and
confirm a fresh preview before retrying; do not blindly restore old DNS.
