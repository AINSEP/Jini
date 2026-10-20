# W2 admin — coordinator progress

Branch: `cloud/w2-admin` (from origin/general-work). Lot branches: `cloud/w2-admin-<LOT>`.
Personas loaded by coordinator: software-architect/skills.md, code-inspection/skills.md (from ../AI-Dev-Shop clone).
Setup: 140 s (pnpm install + build; integrations build fails as expected). Wave A dispatched ~01:35 UTC: L214 L216 L246 L247 L256 (5 parallel). L281/L282 worktrees pre-built, queued.

## Lots
| Lot | Files | Status | Before cyc/cog | After cyc/cog | Coverage | Commits | Verify |
|---|---|---|---|---|---|---|---|
| L214 | redirects conformance + import form hook | merged | 18/11 | 8/6 | 100/100/100 | 609feee2, 72ae6292 | PASS: 50 lot tests; conformance split into 6 ordered phases (same check order/names); bug pinned: status-filter check passes on empty list |
| L216 | browser/navigation.ts | merged | 18/11 | 9/4 | 100/100/100 | 06c86059 | PASS: eslint 0, tsc 0, 32 tests, comments moved, no as-any |
| L246 | media/controllers/library.controller.ts | merged | 12/13 | ≤10/≤10 (eslint 0) | 100/100/100 | d1985d3b | PASS: 26 new + 88 related tests; libraryView dedup (3 sites); write() single exit; verified store.set no-ops after dispose so dropped aborted-guard is equivalent |
| L247 | source-control conformance/controller/ProvidersTab hook | merged | 12/6 | 7/5 | 100/100/100 (with importer tests) | c300a265, af34f801, 69827f95 | PASS: 53 related tests; ERROR MSG CHANGED: "Source control conformance failed for provider \"<id>\": <check>"; bug pinned: wrongly-accepted create inside a rejection check is never cleaned up; c300a265 msg numbers wrong (real 11/6→4/2) |
| L256 | media/html-attributes.ts, media/rules.ts | merged | 13/≤10 | 9/7 | 100/100/100 (with all importer tests) | 1a086535, 1e1237fc | PASS: eslint 0, tsc 0, 60 lot tests; 2 bugs pinned (unsafe-url hint always says javascript:; "HTTP 5000" read as 500). 1a086535 msg says 11→7, real 11→8 |
| L281 | forms/adapters/memory.ts | merged | 12/9 | 9/6 | 100/100/100 | b81fa68b | PASS: 29 new tests + 395 related; six conditional spreads → suppliedPatch; ERROR MSG CHANGED: missing submission now "form submission 'X' was not found" (was "form definition") |
| L282 | media/adapters/memory.ts | merged | 12/≤10 | ≤10/≤10 (eslint 0) | 100/100/100 | bb980392 | PASS: 28 new + 486 related tests; pickMetadata shared by upload/update; ERROR MSGS CHANGED (4, now name the id); behaviour note: untyped null title/alt/caption/credit/slug on upload now stored as null (types forbid it; nullable fields unchanged) |

## Problems / notes
- Baseline whole-package suite on unmodified tree (01:30 UTC): 144 files / 1689 tests pass, 119 s.

## Next
