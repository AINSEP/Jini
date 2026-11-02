# What failed and the next step

| Code/result | Plain explanation | Next step |
|---|---|---|
| `CLOUDFLARE_CREDENTIAL_REQUIRED` | The connection lacks a token or Account ID. | Update it in the secure connection form. |
| `CLOUDFLARE_API_ERROR` HTTP 401/403 | The named account/zone/project operation was denied. | Check that operation's checkboxes and account/zone scope; keep the same connection ID. |
| `CLOUDFLARE_API_ERROR` HTTP 429 | Cloudflare is limiting requests. | Wait and preview again. Do not replace a working token. |
| `CLOUDFLARE_UNREACHABLE` / `CLOUDFLARE_INVALID_RESPONSE` | The provider or network did not return usable data. | Check the connection and Cloudflare status, then retry. |
| `CLOUDFLARE_SUBDOMAIN_REQUIRED` | This account has no workers.dev address configured. | Finish Workers & Pages setup in the Cloudflare dashboard. |
| `CLOUDFLARE_ASSET_COUNT_LIMIT` / `CLOUDFLARE_ASSET_SIZE_LIMIT` | The named export exceeds a hosting limit. | Reduce the export/file; choose paid Workers only if the actual account has that plan. |
| `CLOUDFLARE_ASSET_PATH` | The export contains an invalid or duplicate path. | Fix the named path and export again. |
| `CLOUDFLARE_ASSET_BUCKET_INVALID` / `CLOUDFLARE_UPLOAD_INCOMPLETE` | The upload session could not complete safely. | Retry publishing; no new script was uploaded after this failure. |
| `CLOUDFLARE_ZONE_REQUIRED` / `CLOUDFLARE_ZONE_MISMATCH` | Zone, domain and account do not match. | Select the actual apex and Zone ID in the correct account. |
| `CLOUDFLARE_ZONE_INACTIVE` | The zone is not an active full Cloudflare zone. | Finish nameserver setup, then preview again. |
| `CLOUDFLARE_INVENTORY_UNKNOWN` / `DOMAIN_INVENTORY_UNKNOWN` | Some current records/bindings/routes could not be inspected. | Complete all inventory read permissions or narrow the account; no domain changes are safe yet. |
| `CLOUDFLARE_DOMAIN_CONFIRMATION_REQUIRED` / `DOMAIN_CONFIRMATION_REQUIRED` | This call has no authenticated human approval of the exact domain changes. | Run execute through chat and answer its review card. Request flags cannot confirm it. |
| `CLOUDFLARE_DOMAIN_PLAN_STALE` / `PLAN_STALE` / `CREDENTIAL_CHANGED` | Infrastructure or the selected connection changed after review. | Preview and confirm the new state. |
| `ok:"partial"`, `reachable:false`, pending hostname | Hosting was uploaded but one or both domains lack validation, certificate or expected content. | Report the hostnames separately, inspect Cloudflare DNS/TLS/CAA status and retry a fresh preview. Never claim live. |

Never include a token or raw upstream error body in an explanation.
