DONE 6201af3be

# K4-i18n-common.J — Jini half (ADMIN_COMMON_I18N)

- Branch: `codex/ex2-k4-i18n-common-jini`, based on `origin/integ/merge-13-2026-11-22` @ `7c4ee7881` (READY `e4e3bf175` is in its history).
- Spec read from Tovu `origin/plan/whats-left-1122` @ `ac96aeb6`: `plans/P9-steps/K4-i18n-common.md`, `plans/P9K-fix-B1-B3.md` §`K4-i18n-common.J` (the correction was applied over the sheet where they differ), `plans/P9K-fixcheck-B1-B3.md` (READY; I applied its `typesVersions` note), and `plans/P9-extraction.md` §1.
- Source copied from Tovu `41e948ee4a` (`integ/merge-12-2026-11-22`): `apps/admin/src/lib/i18n-common.ts`, 716 lines. The line numbers the spec cites (484, 496, 500–520, 710–716) match this file exactly.

## Commits (all pushed)

| SHA | What |
|---|---|
| `a8dd70c69` | Test written first, then `ADMIN_COMMON_I18N` at `./core/i18n-common`; `exports`, `jini.entries` and `typesVersions` entries added; changeset |
| `078cec9c8` | `BASE_COMMON_I18N` moved into its own module with the same text, so both files stay under the 500-line file gate (see "Decision" below) |
| `6201af3be` | `pnpm api:update` delta for `@jini-ai/admin` |
| (this report) | `cloud-results/ex2-k4-i18n-common-jini.md` |

## Files

- **Added** `packages/admin/src/core/i18n-common.ts` (281 lines). It holds the header why-comment, `COMMON_EXTRA_KEYS`/`VALUES` and their positional assembly, `CODE_WRAP_I18N`, `DRAFT_RECOVERY_I18N`, `BUILT_IN_I18N`, and the assembly as `export const ADMIN_COMMON_I18N`.
- **Added** `packages/admin/src/core/i18n-common-base.ts` (449 lines). It holds `BASE_COMMON_I18N`, copied verbatim. It is internal, has no subpath export, and has no import of its own.
- **Added** `packages/admin/src/core/__tests__/i18n-common.test.ts` (8 cases).
- **Modified** `packages/admin/package.json`:
  - `exports["./core/i18n-common"]` (dist triple: types/import/default → `./dist/core/i18n-common.{d.ts,js}`)
  - `jini.entries["./core/i18n-common"] = "universal"`
  - `typesVersions["*"]["core/i18n-common"]`
- **Modified** `api-baseline/jini-ai__admin.json`.
- **Added** `.changeset/p9-k4-i18n-common.md` (`@jini-ai/admin`: patch).

### What was moved, and what was changed

- **Moved verbatim:**
  - all of `BASE_COMMON_I18N`
  - `BUILT_IN_I18N` (`"Built-in"`)
  - `DRAFT_RECOVERY_I18N`
  - `CODE_WRAP_I18N`
  - every paired `COMMON_EXTRA_KEYS`/`COMMON_EXTRA_VALUES` entry except one
  - every why-comment in those blocks
  - the positional-index rationale comments and the missing-translation `throw`s
  - the assembly order per locale: base, `"Built-in"`, draft recovery, code wrap, generic extras
- **Not moved:** the branded key at source line 484 (`"is on an older <product> and can't overwrite these yet. …"`), which is **index 27** of the 33-entry key list. I dropped index 27 from the key list and from all 21 value rows. Each row was parsed and re-serialised, and the script asserted that the unmodified row round-trips byte-for-byte before it removed the slot. In its place in the key list there is a 3-line comment saying the host keeps that entry and why the slot is dropped.
- **Equivalence proof:** a script imported the original Tovu `COMMON_I18N` and the new `ADMIN_COMMON_I18N`. With that one key removed from each locale, they are **deep-equal**, and locale order and per-locale key order are identical. That gives 21 locales and 58 keys each (Tovu has 59).
- **Header comment:** the only edits are neutrality fixes:
  - "this app" → "the host's admin"
  - "Tovu-specific" → "host-specific"
  - `Jini/packages/ui/...` → `packages/ui/...`
  - "this app depends on" removed

  I added two sentences: one says feature dictionaries pass `ADMIN_COMMON_I18N` as `commonDictionary`, the other describes the host composition rule. `/tovu/i`, `apps/(website|admin|desktop)` and `#src/` match 0 times in all three new files.

### Decision: split rather than a new size exclusion

- The verbatim single file came to 668 counted lines, a new `max-lines` violation against the 500-line limit.
- Tovu carries this exact file as a size `pathExclusion` ("Shared locale dictionary…"). But Jini's `scripts/size-exceptions.json` says "Add entries only with an owner-approved reason", and that approval exists only for Tovu.
- So the base block sits in its own module with its text unchanged, and the gate stays green without touching the exceptions list.
- If the owner would rather have one file, the alternative is adding the Tovu exclusion (`^packages/admin/src/core/i18n-common\.ts$`) to Jini's `size-exceptions.json` and inlining the base block back.

## Exports and API baseline delta

```diff
+ "./core/i18n-common": {
+  "types": "./dist/core/i18n-common.d.ts",
+  "symbols": {
+   "ADMIN_COMMON_I18N": "variable:ce86ecd827"
+  }
+ },
```

That is the only delta. `pnpm api:check` reports 40 packages, 691 entries and 17230 symbols, all OK.

## Tests

- **New test** `packages/admin/src/core/__tests__/i18n-common.test.ts`, 8 cases:
  1. the original 21 locales
  2. every locale has the same key set as `es`
  3. `Save`/`Cancel`/`Delete` are non-empty in every locale
  4. `es.Save === "Guardar"`
  5. `"Built-in"` and `"Wrap: on"` survive assembly in every locale, with `es` values pinned
  6. the version-conflict key from source line 496 survives, with the `es` value pinned
  7. the extras on either side of the removed slot are still aligned (`es` values pinned)
  8. the branded older-version key is absent from every locale. It is matched by its generic tail, so the test file never names the product.
- **Red first:** with the module absent, the run failed (`Failed to load url ../i18n-common.js`, 1 file failed). With the module in place, 8/8 pass.
- **Admin full suite** (`npm --prefix packages/admin run test`): **252 files, 3082 tests, all passed**, exit 0.

## Named mutation (deleting Spanish `Save` in `i18n-common-base.ts`)

```
   ✓ ships exactly the original 21 locales
   × gives every locale the same generic key set
   × pins three generic keys per locale to non-empty translations
   × keeps the Spanish Save translation verbatim
   ✓ keeps "Built-in" and "Wrap: on" through assembly
   ✓ keeps the version-conflict entry after the branded extra is split out
   ✓ keeps the positional extras aligned around the removed branded entry
   ✓ leaves the product-branded older-version entry with the host
      Tests  3 failed | 5 passed (8)
```

The pinned value and key parity cases go red, as the spec requires. After `git checkout` restored the file the run was 8/8 and the tree was clean.

## Gates (base = unmodified merge-13 tip; final = branch)

| Gate | Base | Final |
|---|---|---|
| `pnpm install --frozen-lockfile` | ok | ok (no lockfile change) |
| `pnpm -r build` / admin + dependents rebuild | ok (exit 0) | ok (exit 0) |
| `pnpm typecheck` (whole repo) | — | exit 0 |
| `pnpm guard` | not comparable (see note) | **ok, 0 violations** |
| `pnpm check:size` | exit 1, already red: 3 stale-debt notices plus `cms/src/redirects/redirects.ts` max-lines 513 | exit 1, **identical output** (no new red) |
| `pnpm check:complexity` | exit 1, already red: `session-results.ts` handleRpcError 12, `event-projection.ts` 11, `reporter.ts` refusalError 11, `ErrorNotice.tsx` 11 | exit 1, **identical output** |
| `pnpm check:hooks` | ok | ok |
| `pnpm check:errors` | WARN, 25 new/worse | WARN, **identical** |
| `check:why-comments --base origin/integ/merge-13-2026-11-22` | n/a | ok, 0 comment blocks lost |
| `pnpm api:check` | — | ok |
| `pnpm check:cross-package` | cannot run here | cannot run here |

Notes on the gates:

- **Base guard:** it was run in an unbuilt git worktree, which has no `dist`, so it failed only on resolution errors. Final guard passes on the built tree with zero violations.
- **`check:why-comments`:** its default base ref is `origin/refactor/terra`, which does not exist in this clone, so I ran it against merge-13 instead.
- **`check:cross-package`:** it needs the `JINI_DECLARATION_BASELINE_DIR` environment variable on both base and final, so I did a manual check instead. The new files import only `./i18n-common-base.js`, and the test imports `vitest` plus the relative module: there is no `@jini-ai/*` import at all.
- **Hooks, injection and `_optional` pads:** none apply. This step is data only, with no functions or hooks beyond the original assembly callbacks, which stay under the complexity and size limits.

## For the Tovu half (`K4-i18n-common.T`)

- Exact import: `import { ADMIN_COMMON_I18N } from "@jini-ai/admin/core/i18n-common";`. It resolves via `exports` and via `typesVersions`.
- Value type: `Record<string, Record<string, string>>`. It has the same 21 locales in the same order as Tovu's `BASE_COMMON_I18N`: es, de, it, zh-CN, zh-TW, ar, fa, ru, ja, id, pt-BR, ko, pl, hu, fr, uk, tr, th, hi, ur, bn.
- It contains every current `COMMON_I18N` entry except the one branded key. Tovu keeps that key (`COMMON_EXTRA_KEYS` index 27, source line 484) and its value in each of the 21 rows (lines 500–520). When the extras are reduced to that one entry, index 27 becomes index 0, or Tovu can switch to a plain per-locale map if that is the smaller edit.
- Compose with the Jini locale dictionary first and the host entry last: `{ ...ADMIN_COMMON_I18N[locale], ...hostEntries[locale] }`. The only behaviour difference is that the branded key moves to the end of each locale's key order, which lookups ignore.
- Tovu's size `pathExclusion` for `apps/admin/src/lib/i18n-common.ts` can stay or go. The file shrinks to roughly 40 lines.
- Tovu's mutation gate: `apps/admin/src/lib/__tests__/i18n-common.unit.test.ts` must fail cross-locale key parity when Jini's `es.Save` is deleted. The line to delete is in `packages/admin/src/core/i18n-common-base.ts`, not in `i18n-common.ts`.

## Minor findings (listed, not fixed)

1. `packages/admin/src/widgets/react/__tests__/fixtures/common-i18n.ts` is a full 682-line copy of the host's `COMMON_I18N`, branded entry included, used by `widgets-i18n.ts`. It could now import `ADMIN_COMMON_I18N` instead.
2. Size gate: I split the file instead of adding an exclusion, because the exceptions list requires an owner-approved reason (see "Decision" above). Owner's call whether to merge it back into one file.
3. The moved comments still name host files as context: `admin-nav-i18n.ts`, `lib/version-conflict.ts`, `plugins-i18n`, and the plan doc `plan-publish-repoint-menus-2026-09-24.md`. They are kept verbatim as why-comments, have no `apps/` or `#src` text and no product word.
4. `check:why-comments` defaults to `origin/refactor/terra`, which does not exist on the remote any more. `check:cross-package` needs `JINI_DECLARATION_BASELINE_DIR` and cannot run in a cloud clone as configured.
5. Already red on base: `check:size` (stale debt entries, `cms/src/redirects/redirects.ts`) and `check:complexity` (4 functions listed above).
