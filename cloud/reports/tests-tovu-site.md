# tests-tovu-site

Status: in progress. Started 2026-11-06 19:48 UTC; hard stop 21:48 UTC.

Branch `cloud/tests-tovu-site`; Jini base `3a41ec5b6`, Tovu base `b34b9cb7a` from `origin/cloud/combine`.

Jini rebuilt and linked into Tovu before assigned full root/website validation. Logs under `/workspace/work/tests-tovu-site/`.

The consumer's complete tool-contract test exposed a missing public resolution catalog. Existing `commerceResolutionToolCatalog` is now exported through the existing `@jini-ai/commerce/payments/tools` subpath, allowing all four commerce tool declarations to be independently compared with assembled registrations. No tool schema, approval, authorization, handler behavior or commerce feature changed.

Focused public catalog regression: RED10 pass/1 fail, GREEN11 pass/0 fail. Commerce build, typecheck and targeted lint passed. Tovu relinked after build. Full commands/results and final SHAs will be recorded on completion.

## Bugs found

- Missing public resolution catalog prevented complete consumer contract audits without duplicating private declarations; fixed by exposing the existing catalog.
- Tovu findings and full-suite progress are maintained in its matching `cloud/reports/tests-tovu-site.md`.

## Verified progress

Jini source commit `e89bf38d4` is pushed to `cloud/tests-tovu-site`. Commands (after sourcing `/workspace/.tovu-build/env.sh`, cwd Jini):

```sh
pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts --maxWorkers=2 --minWorkers=1 src/payments/tools/__tests__/resolve-unknown.vitest.test.ts
pnpm --filter @jini-ai/commerce build
pnpm --filter @jini-ai/commerce typecheck
```

Results:11 pass/0 fail; build/typecheck exit0. Targeted commerce ESLint exit0. Tovu relinked after build; complete commerce consumer contract test36/36, catalog/audit/site-title group36/36. Tovu root production and test typechecks both passed. Full root/website suite remains running; fixes and remaining findings are recorded in Tovu's matching report. No additional Jini code change is currently needed.

The consumer full run continues beyond the earlier truncated run's test position. Tovu has fixed a separate plain-copy policy gap for four owner authentication tables, with27/27 focused transfer tests. Package/access/renderer, private-redaction, live span and cold-daemon fixtures were aligned to existing owner contracts without changing Jini behavior. Tovu production/test typechecks have passed; aggregate refresh follows remaining fixture fixes. Three existing architectural/lint guards remain explicit, with no allowance or rule changes. This job's only Jini source change remains the existing resolution-catalog export.

A second Jini source fix addresses model discovery preflight: required empty/whitespace keys now use only synchronous URL checks, so DNS cannot hide the local missing-key refusal. Requests that can proceed, including anonymous catalogs, still use resolved SSRF validation. Existing Azure/URL/Bedrock refusal priority is retained; an unused private options parameter was removed to stay at complexity10. Targeted model/catalog/pagination/DNS tests121/121, package typecheck, strict complexity10 lint and package build all passed. Tovu was relinked; all three affected route files66/66 passed, with the original missing-key consumer regression unchanged.
