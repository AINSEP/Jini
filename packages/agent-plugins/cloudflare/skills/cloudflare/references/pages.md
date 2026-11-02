# Pages compatibility

The target ID remains `cloudflare-pages`, while its containing plugin is now `cloudflare`.
Existing site history, credential IDs/ciphertext/defaults, environment variables, URLs and
`jini-<project>` names retain their meanings. Use Pages again when history/bindings say Pages, or
when explicitly requested. A rename alone never migrates infrastructure or broadens `worksFor`.

The account credential needs `token` and `accountId`; optional `zoneId` is a default selection.
Environment fallback still reads `CLOUDFLARE_TOKEN` / `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` only in the existing allowed execution modes.

Pages retains project lookup/create, upload-token, check-missing, deduplicated upload batches,
upsert-hashes and deployments. Root `_headers` and `_redirects` are deployment form fields, never
manifest assets; a nested copy remains an ordinary file. Host headers replace the site's root
_headers because they are host policy. Limits: 25 MiB/file, 20,000 files including generated files,
at most 100 files and 75 MiB encoded JSON in each upload batch.

Official domain setup: https://developers.cloudflare.com/pages/configuration/custom-domains/
