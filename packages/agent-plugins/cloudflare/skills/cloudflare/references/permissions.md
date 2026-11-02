# Token permissions to tick

Create a custom API token at Cloudflare → My Profile → API Tokens. Scope Account permissions to the
chosen account and Zone permissions to the selected zones. Request only the chosen capabilities:

| Capability | Cloudflare permission checkboxes |
|---|---|
| Workers publish | **Account → Workers Scripts → Edit** |
| Pages publish | **Account → Cloudflare Pages → Edit** |
| Form submissions (Workers sites with active forms) | **Account → D1 → Edit** in addition to Workers publish |
| Preview custom domains, either target | **Zone → Zone → Read**, **Zone → DNS → Read**, **Zone → Workers Routes → Read**, **Account → Workers Scripts → Read**, **Account → Cloudflare Pages → Read** |
| Workers Custom Domain attachment | **Account → Workers Scripts → Edit**; **Zone → SSL and Certificates → Read** for certificate polling |
| Pages domain attachment | **Account → Cloudflare Pages → Edit**, **Zone → DNS → Edit** |
| Approved removal of conflicting DNS | **Zone → DNS → Edit** |
| Approved removal of another Worker's binding | **Account → Workers Scripts → Edit** |
| Approved removal of another Pages project's binding | **Account → Cloudflare Pages → Edit** |
| Approved removal of an overlapping route | **Zone → Workers Routes → Edit** |

Edit includes the corresponding reads. Cross-product inspection needs both Workers and Pages reads
even when only one product is the destination. A 403 on either inventory means **unknown**, not clear.
If the person cannot grant full inspection, publishing without a custom domain remains available.

`GET /accounts/{account_id}/tokens/verify` checks account-owned tokens; user-owned tokens use
`GET /user/tokens/verify`. The save check tries the account endpoint first and, on a possible scope
mismatch, the user endpoint. Both check active token status only. A green token check is not proof that
Workers upload, Pages upload, zone discovery, DNS changes, route transfer or certificate reads work.
The authenticated preview names the first denied operation and its account/zone resource.

Compatibility must explicitly include `cloudflare-workers` for Workers. Historical `worksFor:["cloudflare"]` and `worksFor:["cloudflare-pages"]` stay Pages-only. After granting the required permissions, explicitly update the same connection to include both target IDs if it should serve both products. No background rewrite expands a saved grant.
