# Plugin host tool provenance

`src/host/tools/{contract,management,install,source}.ts` transports the portable plugin-runtime tool closure from the original host after the L2 gate at the original host c23c8b73d. Original implementation pin: the original host 2c9c1a65c. Catalog/schema/copy, command/fingerprint/approval owners, cross-family canonical classes and lifecycle layout remain host inputs. The node entry does not re-export through universal `/host`; same-package owning leaves preserve class identity. No new dependency, migration or saved-byte format.

## w4-runtime moves (2026-11-24)

Original host source at the original host `3a93322474`: `apps/website/src/contracts/core/plugin-hook-failed-error.ts` → `src/host/hook-refusals.ts`; `apps/website/src/server/runtime/composition/plugin-activation-polling.ts` → `src/host/activation-polling.ts`. Tests moved with them (vitest).
