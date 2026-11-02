# Apex and www

Supply the apex hostname as `customDomain` and optional `zoneId`; the plugin never discovers a zone
by removing the first hostname label. It enumerates zones and verifies the exact active full zone,
account and apex match. The preview reads all DNS records, Worker Custom Domains, Worker routes
(including disabled/no-script and wildcard/path routes), and every accessible Pages project's domains.
Permissions denied, malformed responses or bounded inventory exhaustion mean **unknown** and refuse
all domain changes.

Review both hostnames' current records, bindings, routes and the exact change list. Existing address
records (A/AAAA/CNAME) and other product bindings may be replaced only through the human's card.
Identical bindings/CNAMEs are reused. Pages-created CNAMEs keep the historical `jini-deploy:` ownership
marker; an unmarked but identical CNAME may be reused. Existing MX/TXT/CAA are preserved. Relevant
wildcards and inherited CAA are displayed. Exact records override wildcard DNS, so wildcard DNS is
preserved. An overlapping Worker route is removed as a WHOLE only when its wider impact was displayed
and confirmed; automatic splitting is not supported.

Workers uses Custom Domains separately for apex and www; Cloudflare manages their DNS and
certificates. Pages first associates each project domain, then creates its CNAME to the project's
pages.dev address (Cloudflare flattens the apex). Apex zone and Pages project must be in the same
account.

Execution rechecks the credential and approved state before writes, and checks domain state again
immediately before cutover. It polls validation/certificate state with bounded delays, then probes a
content-addressed proof file over guarded HTTPS on BOTH hosts. HTTP 200 from an old site does not
count. A delayed certificate, validation error or content mismatch remains partial with per-host
states. Retry with a fresh preview; unrelated records are never cleanup targets.

Both names initially serve content; no canonical-host redirect is added automatically. DNS/binding
cutover is not atomic. The review warns of interruption and broader wildcard impact. There is no
automatic rollback: inspect current infrastructure before any manual recovery.
