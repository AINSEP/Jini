# Deployment tool extraction provenance

EXTRACT-S9 C4 original host source: AINSEP/Tovu commit `67ae377e9200503d767aa7c3a0e65d9ea2e6ba78`, `apps/website/src/features/deployments/deploy-ops/{run-ops,secrets,typed-secret-card,tool-registrations,registry}.ts`.

The C4 seam keeps runtime in that host's `portable/ops-*.ts`, introduces consumer-only types in `src/deploy/ops-tool-contracts.ts`, and binds existing host policy. The subsequent mechanical move copies those exact runtime bodies into this package's `src/deploy/ops-*.ts`; source/provenance SHAs and the exact inventory are in the paired report. Core shapes are imported, host-specific implementations stay with the host, and source why-comments are preserved except any exact real guard rejections listed in the report.

Mechanical runtime source after the seam: AINSEP/Tovu `63a620faa9dd197c689daf3d81029e3edadb16cb`, `apps/website/src/features/deployments/deploy-ops/portable/ops-{runner,secrets,secret-card,tools,registry}.ts`. These five source files are removed from the host when public bindings switch.
