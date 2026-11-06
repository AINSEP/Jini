# tests-tovu-site

Status: in progress. Started 2026-11-06 19:48 UTC; hard stop 21:48 UTC.

Branch `cloud/tests-tovu-site`; Jini base `3a41ec5b6`, Tovu base `b34b9cb7a` from `origin/cloud/combine`.

Jini rebuilt and linked into Tovu before assigned full root/website validation. Logs under `/workspace/work/tests-tovu-site/`.

The consumer's complete tool-contract test exposed a missing public resolution catalog. Existing `commerceResolutionToolCatalog` is now exported through the existing `@jini-ai/commerce/payments/tools` subpath, allowing all four commerce tool declarations to be independently compared with assembled registrations. No tool schema, approval, authorization, handler behavior or commerce feature changed.

Focused public catalog regression: RED10 pass/1 fail, GREEN11 pass/0 fail. Commerce build, typecheck and targeted lint passed. Tovu relinked after build. Full commands/results and final SHAs will be recorded on completion.

## Bugs found

- Missing public resolution catalog prevented complete consumer contract audits without duplicating private declarations; fixed by exposing the existing catalog.
- Tovu findings and full-suite progress are maintained in its matching `cloud/reports/tests-tovu-site.md`.
