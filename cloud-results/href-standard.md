# href-standard (Jini side): `isAllowedHref` is the single href check; `toAllowedHref` added

Branch `fix/href-standard` (from `origin/refactor/terra`; terra merged in later, no force). Tovu side: its own `cloud-results/href-standard.md`.

## Done (failing test first each time)
1. `isAllowedHref` refuses every protocol-relative href, including its own former placeholder host (`//safehref.invalid/x`, `/\safehref.invalid/x`, `//safehref.invalid:80/x`) and any off-origin host. It resolves a `/...` href against two placeholder origins and requires the base's own origin under both, so a protocol-relative href (which carries its own host) can never match both.
2. Non-string input (`undefined`, `null`, number, object, function) returns `false` instead of throwing (`rawHref: unknown`).
3. `toAllowedHref({ rawHref }: { rawHref: unknown })` returns the trimmed href when allowed, else `"#"`; same module, exported from `@jini-ai/cms/navigation`. Tests cover a 55-row table (the 52+ characterized inputs plus placeholder-host rows).
4. Moved `isAllowedHref` + `ALLOWED_HREF_SHAPES_DESCRIPTION` into `navigation/href.ts` first (menu-service.ts is over its size ceiling and would have grown); old path deleted, callers repointed, no re-export.
5. New leaf subpath `@jini-ai/cms/navigation/href` (package.json exports + `jini.entries`, knip entry, contract test red first), because the Tovu theme worker graph may not load the navigation barrel.
6. Changeset `.changeset/cms-href-standard.md` (minor), api-baseline delta for `jini-ai__cms.json` (only: `isAllowedHref` changed, `toAllowedHref` added on both entries, `./navigation/href` added; unrelated baseline drift left untouched), `api.spec.md` updated.
7. The quirk-pinning test `href resolution uses the neutral private sentinel` was rewritten: it asserted `//safehref.invalid/path` is allowed. Why-comments kept in past tense (the `check:why-comments` gate found 4 lost blocks until the host-copy history was restored).

## Gates
- `npx vitest run --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1` in `packages/cms` (`--maxWorkers=2` fails here with a tinypool min/max-thread error, so the equivalent fork limits were used): 339 files, 4092 tests pass (base 338 / 4085).
- `pnpm guard`: ok. `pnpm run check:size`: pass. `check:complexity`: pass. `check:why-comments`: ok, 0 lost. `pnpm api:check`: only the pre-existing unrelated `FormDeliveryRetryPolicy` note remains for cms. `check:hooks`, `check:errors`, `check:log-safety`: output identical to base (pre-existing failures elsewhere). `check-hardwiring`: 1 stale debt row, identical on base. eslint on `navigation/`: no new finding (base had one error in `repo.memory.ts`, unchanged).
- Full `pnpm -r build`: exit 0 after the terra merge.

## Left / next
Publish the new minor, then Tovu bumps `@jini-ai/cms` and refreshes its lockfile. `cloud-results/` of other branches untouched.
