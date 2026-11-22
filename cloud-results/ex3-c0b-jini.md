DONE fd73c289b

# ex3 — C0b.J (Jini): pure core site-key DTOs

- Branch: `codex/ex3-c0b-jini` (base `origin/integ/merge-13-2026-11-22` = `7c4ee7881`)
- Commits: `648f96558` (contract, fixture, export, changeset), `fd73c289b` (api-baseline); this report is committed on top of them.
- Spec: Tovu `origin/plan/whats-left-1122` `plans/P9U-untangle-v2.md` row C0b.J and §1.2 Design; `plans/P9U-check-v2.md` READY item 1; `plans/P9-extraction.md` §1.
- Source: Tovu `origin/integ/merge-12-2026-11-22` (`41e948ee4a`) `apps/admin/src/features/sites/api/sites-api.types.ts:108–209`. The Tovu declarations stay in place for the staged cutover (C5.T, R6.T).

## Import specifier for the Tovu cutover

```ts
import type { AdminSiteKeyState, AdminSiteKeyStatus /* … */ } from "@jini-ai/core/contracts/site/site-key";
```

## Files

| file | what |
|---|---|
| `packages/core/src/contracts/site/site-key.ts` | types only (emits `export {}`), 10 exports |
| `packages/core/src/__tests__/site-key.unit.test.ts` | compile fixture plus 4 vitest cases. Exhaustive `Record<Union, …>` maps over every state, source, reason, runtime mode and generate outcome, so a dropped or added variant fails `tsc` |
| `packages/core/package.json` | `./contracts/site/site-key` dist export triple plus a `jini.entries` row (`universal`), placed in the `contracts/site/*` neighbourhood. Core has no `typesVersions` |
| `api-baseline/jini-ai__core.json` | +1 entry (see below) |
| `.changeset/p9u-c0b.md` | `@jini-ai/core: patch` (additive; §1 step 6 says patch) |

## Exports / api-baseline delta (added only, nothing removed or changed)

Entry `./contracts/site/site-key`:
`AdminGeneratedSiteKey` (interface), `AdminImportedSiteKey` (interface), `AdminRevealedSiteKey` (interface), `AdminSiteKeyAffectedWebhook` (interface), `AdminSiteKeyGenerateOutcome` (type), `AdminSiteKeyRuntimeMode` (type), `AdminSiteKeyStartFreshPreview` (interface), `AdminSiteKeyState` (type), `AdminSiteKeyStatus` (interface), `AdminStartedFreshSiteKey` (interface).
`pnpm api:update` reports 40 packages, 691 entries and 17239 symbols. The only diff is that block (+15 lines).

## Deviations from "verbatim" (each one is forced, and each why-comment is kept)

1. **`AdminSiteKeyState` is now a literal union.** In Tovu it is `(typeof ADMIN_SITE_KEY_STATES)[number]`, derived from a runtime `const`. XP4 allows no runtime in `contracts/`, so the const **stays in Tovu**. The type is spelled `"active" | "missing" | "missing-with-data" | "mismatch" | "invalid"`, the same five values in the same order. The why-comment still says it mirrors the server `SiteKeyState`, that the host keeps the runtime list and the parity test, and that all three are edited together. **Cutover note for C5.T/R6.T:** Tovu's `ADMIN_SITE_KEY_STATES` should become `[...] as const satisfies readonly AdminSiteKeyState[]`, or keep an equivalent check, so the parity test still binds the list to the core type.
2. **N2 / product-word rewrites in comments only:**
   - `apps/website/src/contracts/core/site-key-state.ts` → "the host's server-side `SiteKeyState`"
   - `contracts/core/runtime-mode.ts` → "the host's `resolveRuntimeMode()`"
   - the `@tovu/*` path-alias sentence → "the server union is not reachable from an admin client"
   - `api.revealSiteKey()` → the reveal call (`AdminRevealedSiteKey`)
   - `useSiteKey`'s `generate()` → "the admin's `generate()`"
   - "Site-key plan §A.6" → points at the `AdminSiteKeyState` doc
   - The "sol finding 3-2, 2026-09-16 fix" provenance is kept.
3. **Scope.** The design lists `AdminSiteKeyState`, `…Status`, `AdminGenerated/Imported/RevealedSiteKey`, `…StartFreshPreview`, `…AffectedWebhook` and the types they reference, which brings in `AdminSiteKeyRuntimeMode` and `AdminSiteKeyGenerateOutcome`. `AdminStartedFreshSiteKey` is added too: Security reads it at `security/hooks/site-key-port.hooks.ts:20` (`startFresh(): Promise<AdminStartedFreshSiteKey>`), and the design asks for the site-key DTOs that Dashboard and Security read.

## Setup and baseline

- `pnpm install --frozen-lockfile`: ok
- `pnpm -r build`: exit 0
- `pnpm --filter '@jini-ai/core...' -r build` after the change: exit 0
- `dist/contracts/site/site-key.js` is `export {};` (comment header only)

## Gates (the branch compared with base `7c4ee7881`, both run on this checkout)

| gate | branch | base | delta |
|---|---|---|---|
| `pnpm guard` | ok (0 violations) | — | — |
| `pnpm typecheck` (all packages + scripts) | rc 0 | — | — |
| `pnpm api:check` | rc 0 | — | — |
| `pnpm check:hooks` | ok | — | — |
| `pnpm check:size` | rc 1 | rc 1 | **identical output** (pre-existing: cms redirects, daemon launch, sidecar stale debt) |
| `pnpm check:complexity` | rc 1 | rc 1 | **identical** (pre-existing: agent-runtime, chat, core errors/reporter, ui ErrorNotice) |
| `pnpm check:why-comments` | rc 1 | rc 1 | **identical** (pre-existing, 10 unlisted blocks in other packages) |
| `pnpm check:cross-package` (`--base 35c4961af`) | rc 1 | rc 1 | **identical** (pre-existing XP4/XP5 elsewhere) |
| XP check with `--base 7c4ee7881` | no finding names `site-key.ts` or the fixture | — | new file passes XP4 (types only, no imports) |

No gate has a new red.

## Tests

- `npm --prefix packages/core run test`: **217 files, 2975 tests passed** (rc 0)
- `site-key.unit.test.ts`: 4/4 passed

## Named mutation: drop one `AdminSiteKeyStatus` variant

Mutation: `source: "env" | "file" | "none"` → `source: "env" | "none"`. Command: `npx tsc -p packages/core/tsconfig.json --noEmit`.

```
src/__tests__/site-key.unit.test.ts(24,36): error TS2322: Type '"file"' is not assignable to type '"none" | "env"'.
src/__tests__/site-key.unit.test.ts(33,3): error TS2353: Object literal may only specify known properties, and 'file' does not exist in type 'Record<"none" | "env", AdminSiteKeyStatus>'.
rc=2
```

Restored with `git checkout --`: `tsc` rc 0 and the tree is clean.

Extra mutation: drop `"invalid"` from `AdminSiteKeyState`.

```
src/__tests__/site-key.unit.test.ts(28,3): error TS2353: Object literal may only specify known properties, and 'invalid' does not exist in type 'Record<AdminSiteKeyState, AdminSiteKeyStatus>'.
… (3 more TS2339) rc=2
```

Restored: rc 0.

The mutation is caught by `tsc`, which is the core `typecheck` script and the package build. Vitest does not type-check, so the vitest run alone stays green under a type-only mutation. That is expected for a compile fixture.
