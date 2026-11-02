# Workers static assets

Stable script name: `jini-<project-name>`, unless `resourceName` supplies the exact existing name.
The plugin reads the account's workers.dev subdomain. If absent, open Workers & Pages in the
Cloudflare dashboard and finish workers.dev setup; do not invent or register a subdomain automatically.
Preview discloses script creation/update and enabling its workers.dev endpoint.

Publishing creates an asset upload session, uploads exactly the nonempty server buckets with the
session JWT, then uses the completion JWT in script metadata. Empty buckets need no upload.
A minimal module delegates to `env.ASSETS.fetch`; its `ASSETS` binding owns the static files.
Root `_headers`/`_redirects` go through assets config and are never public assets. Nested copies are
ordinary assets. Host security headers replace any root site-supplied `_headers` because they are
host policy.

Each file is at most 25 MiB. Default/free limit is 20,000 files, paid is 100,000; `assetPlan:"paid"`
must describe the real Workers account plan. Generated configuration/content-proof files count.
Uploads run sequentially to bound memory and concurrency. The compatibility date is pinned in code
and should advance only after release acceptance.

## Form submissions

When the site has at least one active form, the same Worker also receives `POST /forms/:slug/submit`
(the path the host's forms already post to, so exported HTML is unchanged and there is no CORS). Publishing
finds or creates D1 database `tovu-forms-<script name>`, applies the plugin's forward-only migrations
(`schema_migrations`), binds it as `TOVU_FORMS`, installs the per-site receiver key as secret
`TOVU_FORMS_SECRET`, and routes `/forms/*` and `/_tovu/*` to the Worker before static assets. The
database is never dropped or recreated. The receiver checks only the compact manifest the host supplies
(slugs, field names, required, max length), honours the host's `_hp` honeypot and rate-limits to 5 valid
submissions per IP per form per 60 seconds; the host re-validates on pull. No file uploads. The host pulls
pending rows through `GET /_tovu/forms/pending` and `POST /_tovu/forms/ack` with the receiver key.
After a submission the visitor returns to the page with `?form=<slug>&form_status=success`. Pages
that contain a form are also routed to the Worker first (exact paths only; assets and other pages stay
on the free static path), which hides the form and shows the host's own success message, or one plain
"Thanks, your submission was received." line when the page has none.
Needs **Account → D1 → Edit** on the saved token; preview names it when missing. Pages sites with
forms are not supported yet; preview says so.
The receiver is form destination `cloudflare-d1` (co-hosted on Workers); the site's `core.forms`
`receiver` setting keeps it on with `auto` (the default) and turns it off with `none`.

Official protocol: https://developers.cloudflare.com/workers/static-assets/direct-upload/

A self-hosted operator may explicitly configure `CLOUDFLARE_WORKERS_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`. Historical `CLOUDFLARE_TOKEN` / `CLOUDFLARE_API_TOKEN` environment credentials remain Pages-only; the new target never silently reuses them. A saved compatible connection still takes precedence under the existing resolver.
