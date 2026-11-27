# r62t-rev-bugs — Jini programmer handoff

Base: `codex/b-bugsj`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.

All five Jini SOL sheets are implemented in the working tree, in sheet order. No sheet stopped: the named source anchors matched. Tests were authored before each sheet's implementation. RED, GREEN, mutation runs, builds, installs, type-checks, linters, and API generation were not executed, as the dispatch prohibits them. No commits or other `.git` writes were made. The coordinator owns the commits below; verification remains pending.

## 1. B-HEADLESS.J — classify the canonical type-only contract edge

Files:
- `packages/user-management/src/core/__tests__/runtime-boundary.test.ts`

Added the two named fixture tests. Extracted only the named private helpers, applied the exact package regex to parsed specifiers, retained relative traversal, the nonliteral-runtime-reference rejection, both real-tree checks, and traversal into core primitives. The sole new graph exception requires the exact canonical specifier and whole-declaration type-only bit. Accepting it parses the actual target and checks its allowed top-level statements and absence of import declarations, import-equals declarations, dynamic imports, and require calls. Production `core/types.ts`, the target contract, and core package exports are unchanged.

Pending mutations:
- `restore-source-regex`: substitute the old raw-source regex assertion for the specifier assertion; the canonical export-type fixture must fail.
- `ignore-type-only-bit`: remove the type-only requirement from `isAllowedPasskeyTypeEdge`; the runtime-import fixture must fail.
- `skip-react-package-check`: remove the package regex assertion; the React fixture rejection must fail.

## 2. B-VENDOR-SCAN.J — guard both moved plugin surfaces

Files:
- `packages/admin/src/screens/plugins/__tests__/surface-vendor-neutrality.test.ts` (new)

Added all three named tests and the named private scanner, with a test-local file reader relative to `import.meta.url`. Coverage records both reads in order, provider fixtures require both file/line hits in order, and the real sources must have no hits. Missing and empty sources fail. No production edits.

Pending mutations:
- `drop-moved-hook-from-scan`: remove the hook from the scanner's iteration while retaining the two requested targets; the coverage and ordered-hit witnesses must fail.
- `put-provider-word-in-frame`: insert a listed vendor word into the real frame; its real-source assertion must fail.
- `ignore-missing-source`: silently skip a reader failure; the missing-source witness must fail.

## 3. B-MEDIA-DATE.J — accept the viewer time zone

Files:
- `packages/admin/src/media/__tests__/metadata-exports.test.ts`
- `packages/admin/src/screens/media/hooks/__tests__/use-media-card-metadata.hooks.unit.test.tsx`
- `packages/admin/src/media/react/__tests__/media-card-hooks.test.tsx`
- `packages/admin/src/media/rules.ts`
- `packages/admin/src/screens/media/hooks/use-media-card-metadata.hooks.ts`
- `packages/admin/src/media/react/hooks/MediaCard.hooks.ts`
- `.changeset/media-card-viewer-zone.md` (new; admin patch)

Added the three named viewer-date witnesses with `2026-11-25T07:30:00.000Z`, `en-US`, and `America/Los_Angeles`, expecting `Nov 24, 2026`. The legacy witness also pins the unchanged ISO timestamp. Existing UTC, invalid-date, and injected-formatter controls remain. Only date formatting receives the zone; absent legacy zones preserve the exact `{ locale }` call. Jini performs no ambient zone lookup.

Pending mutation: `force-utc-after-injection` sets the formatter's Intl time zone back to UTC; all three new witnesses must fail while the UTC control remains green.

OPUS-REVIEW: run verification and `pnpm api:update`; review only the formatter, `MediaMetadataFormatters`, `useMediaCardMetadata`, and affected MediaCard hook API entries. API baselines and export classifications were not edited.

## 4. B-MAIL-CLEAR-COPY.J — distinguish captures from Activity records

Files:
- `packages/admin/src/screens/email/__tests__/EmailActivityCaptureScope.unit.test.tsx` (new)
- `packages/admin/src/screens/email/EmailActivityTab.tsx`
- `packages/admin/src/screens/email/email-tabs-i18n.ts`
- `.changeset/email-capture-scope-copy.md` (new; admin patch)

Added the two named real-Activity-tab tests with an injected controller: an empty preview retains the console-only captured delivery row and shows the separate-Activity status; a nonempty preview opens the specifically named dialog without confirming deletion. Updated the five dictionary keys and their 21 existing locale slots in place, preserving one `{count}` per counted translation. Updated their call sites, the agent label, and capture documentation. The stale-revision and owner-permission copy and all controller behavior remain unchanged.

Pending mutation: `restore-unqualified-clear-copy` restores the five old keys/call sites; both new copy witnesses must fail. Keep revision-check mutation verification separate.

After the Jini bump, Tovu must repoint `apps/admin/src/features/email/__tests__/EmailCaptureClear.unit.test.tsx` button, dialog, body, empty, success, and Spanish expectations as specified, preserving all flow assertions. No API-baseline delta is expected.

## 5. B-VIDEO-NOTE.J — carry a safe conversion notice

Files:
- `packages/cms/src/admin-http/routes/media/__tests__/upload.test.ts`
- `packages/cms/src/admin-http/routes/media/__tests__/import-url.test.ts`
- `packages/core/src/contracts/site/cms-media.ts`
- `packages/cms/src/admin-http/routes/media/upload.ts`
- `packages/cms/src/admin-http/routes/media/import-url.ts`
- `packages/admin/src/screens/media/hooks/media-port.hooks.ts`
- `.changeset/media-conversion-notice.md` (new; core, cms, admin patches)

Added the two named positive route witnesses, the successful-video/non-video omission witness, and arbitrary-value omission witnesses in both suites. They pin the projected original media and exact success shapes; arbitrary values must be absent as properties. Existing authorization and normal-wire controls remain. Added only `MediaConversionNotice` and `MediaUploadResult<Media>`, widened the three named upload returns and two route result generics, and used the exact literal-checked spread in each route. Content-type writes, upload event ordering, awaited projections, authorizations, 201 statuses, mounts, and unrelated envelopes are retained.

Pending mutations:
- `drop-conversion-notice`: remove the safe notice spreads; both positive route witnesses must fail.
- `forward-arbitrary-notice-value`: replace each spread with `conversionNotice: result.conversionNotice`; the arbitrary-value witnesses must fail, including absence checks.

OPUS-REVIEW: run verification and `pnpm api:update`; review only the additive cms-media, route, and port shapes. Hash-based API baselines were not edited.

## Cross-repository handoff

No new subpaths or package export entries. Tovu consumes viewer-zone options through the existing `@jini-ai/admin/media`, `@jini-ai/admin/media/react`, and `@jini-ai/admin/screens/media/hooks/use-media-card-metadata.hooks` paths. New `MediaConversionNotice` and `MediaUploadResult` types are available at existing `@jini-ai/core/contracts/site/cms-media`; existing media route and port paths carry the widened results. Keep the Activity component's existing `./screens/email/EmailActivityTab` path.

Tovu SOL sheets left to the Tovu run: B-MEDIA-DATE.T and B-ERROR-LEDGER.T. OPUS sheets left untouched: B-DESKTOP-CACHE.T and B-VIDEO-NOTE.T. Non-build dispositions and all other lanes remain untouched.

## Diff review and evidence limits

- Added 15 test declarations across eight test files; retained every existing declaration, including parameterized cases. Executed test counts, pass/fail totals, and coverage are unavailable because execution was prohibited.
- Removed only the superseded raw-source boundary assertion and its inlined edge extraction, the five replaced dictionary rows/keys, the old copy call sites, and signatures/expressions superseded by the sheet changes. No files, tests, capabilities, coverage scopes, or thresholds were deleted. No additional cleanup deletions were needed after review.
- Documentation changes are confined to the sheet-requested rationale and capture wording. No runtime helper, wrapper, export shell, fallback, validation, option, or interface beyond the named design was introduced.
- Architecture audit by source/diff inspection: PASS within the supplied sheet boundaries. Types stay in core; CMS owns route projection and fixed-code filtering; admin owns formatting/copy; the host supplies zones and conversion outcomes. No export, dependency, baseline, migration, or host-file edits.
- Function-quality disposition: INCONCLUSIVE for execution-dependent checks; source inspection found no additional issue to fix within scope. Assessment units: AST edge extraction/exception, vendor scanner/reader, date formatter/two card adapters, capture presentation, and two upload projections. Test-only scans are linear in input/AST size; runtime changes add constant work to existing formatting/projections and no I/O. No external-service fan-out or retained state was added.
- Pre-completion review: requirements and all changed/new files reread; mutation-to-witness mapping recorded above; scope and existing-test integrity inspected. No verification or runtime success is claimed. Next routing: coordinator/cloud tests and mutations, then Opus verification/API generation for the two marked sheets.

This handoff file is an additional required root artifact; include it with the coordinator's final logical commit.
