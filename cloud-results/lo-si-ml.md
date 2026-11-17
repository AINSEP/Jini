# lo-si-ml (Jini side)

Full report: Tovu `cloud-results/lo-si-ml.md` on branch `wave2/lo-si-ml`. Jini commits on `wave2/lo-si-ml` (base 65d73b0d5), additive, each with a minor changeset:

- `8569ff4075e4fb5a8c71084fbb8e70d9e7d97bfb` SI-1b M3: `@jini-ai/diagnostics/web-evidence` gains `resolveSameOriginPath` (injected `checkPathname`), `SameOriginPathError`, `MAX_PATH_LENGTH`, `assertRawPathShape`, `assertNoTraversalSegment`, `resolveWithinOrigin`, `readBoundedBody`, `toCookieShapes`.
- `893858294ba29013d8ae8cff9a195fbd5bf04467` ML-1b M3: `@jini-ai/platform/mail` gains the activity and suppression operations (`src/mail/activity/*`).
- `600b9006a45dd65a2c074a1c5d7bc8448e0a4d8c` platform api baseline narrowed to `./mail`.

Gates at the final HEAD: `pnpm guard` exit 0; `pnpm api:check` exit 0; `pnpm check:size` and `pnpm check:complexity` exit 0; diagnostics 1001 tests pass; platform 3161 pass, 6 skipped; new files at 100% coverage.
Not done: SI-2 (`parse5` for diagnostics) and ML-2p (`kysely` for platform): `pnpm install` fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` (undici 7.30.2 vs `minimumReleaseAge`); nothing overridden, no lockfile edit.
