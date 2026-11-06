# Job older-fixes (owner-approved 11-06): the older bugs still open or unsettled
Base in both repos: origin/cloud/combine (Tovu c11d491f3, Jini f4e3b18a5). Create cloud/older-fixes from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. General wording in commits and reports: these repos are public. Commerce and vibe coding are on hold. A job named fix-round is running from the same base; stay out of its list (cloud/jobs/fix-round.md). List every bug you notice under "Bugs found". Failing test first for real bugs. Never weaken a test. Smallest change. Paths: W = Tovu apps/website/src, A = Tovu apps/admin/src, P = Jini packages.

## Part 1: confirmed open. Fix these first, in order, and give any look-related change a note for the Chrome check afterwards.
- O01 — Static-export choices display allocated folder names instead of theme display names — A/features/sites/StaticExportPicker.tsx:61, W/features/site-backup/share-backend.ts:83 (size S)
- O02 — Export history does not distinguish backup exports from static exports — A/features/sites/SiteExportTab.tsx:95 (size S)
- O03 — Reads of the same file at different offsets have indistinguishable collapsed targets — P/chat/src/react/components/ToolCard.rules.ts:91 (size S)
- O04 — Site llms.txt uses the platform’s heading and product description — W/server/inbound/public-http/routes/site/llms.ts:45 (size S)
- O05 — The public content DTO omits the HTML body of HTML pages — W/server/inbound/public-http/http/shared/post.ts:67 (size M)
- O06 — Document reads have no deadline; stalled extraction can retain both admission slots — P/cms/src/media/document-read.ts:113 (size M)
- O07 — Each document text page reloads the complete source blob, potentially 50 MiB — P/cms/src/media/document-read.ts:124 (size M)
- O08 — A media access-evidence cache miss scans the complete post list; distinct assets repeat that work — W/server/inbound/public-http/routes/site/media-rendition.ts:276 (size M)

For O06 and O07, state cost as frequency times size before and after. For O08, avoid the whole-list scan on a miss.

## Part 2: unsettled. For each, write a small focused fixture or trace that settles it. If it is a real bug and small, fix it. If not, list it with what it would take. Do not spend more than 10 minutes on one.
- C11 — In-memory rendition failures: exercise the adapter contract, including conditional rendition writes.
- C12 — The broad forms audit’s notification, export, receiver, file-storage and cleanup findings: check its individual fixtures against current orchestration.
- C13 — Direct form-marker safe-delete coverage: a supported-marker fixture must demonstrate the complete reference chain.
- C14 — Just-published media classified as changed: replay an isolated two-database publish and compare baseline hashes.
- C15 — Remaining path-redaction false positives and rare misses: run the current scanner against the recorded boundary cases.
- C16 — Theme revision retention, overwrite coverage and empty restore directories: inspect the common file-storage implementation and its lifecycle fixtures.
- C17 — Providers disappearing after a failed initial application: inject a failed application followed by recovery.
- C18 — Static exports containing forms changing between runs: compare two exports with time and identifiers controlled.
- C19 — Dependency upgrades leaving stale Vite prebundles: reproduce an upgrade without manually clearing caches.
- C20 — Catalog digests, provider bundles and unchanged plugin versions: compare two packed release sets and the update-selection rules.
- C21 — Remaining staged-closure and caller-root placement claims: inspect the actual staged dependency graph.
- C22 — Remaining recovery/manual-publish/logging disclosures: targeted fault injection would establish which boundaries still expose raw errors.
- C23 — Secret-setting writability metadata and delegated confirmer identity: inspect the complete catalog-to-executor authorization path.
- C24 — Older consent reload-loop, embed, publish-completion and disk-read claims: map their previous paths onto the replacement consent implementation.
- C25 — Plugin-move vendor discovery, build ordering and content-test dependencies: exercise a freshly composed bundle and isolated package build.
- C26 — File-lock timeout flakes: deterministic liveness/clock fixtures would separate implementation defects from timing failures.
- C27 — Remaining teardown-hook skipping: an isolated throwing-hook fixture would settle the residual cleanup behavior.
- C28 — Post-editor external-change banners, version labels and draft routing: trace the current controller state through the recorded transitions.
- C29 — Shared-key adoption and copy edge cases: exercise an isolated two-site grant/copy fixture.
- C30 — Every media producer supplying previews, including batches: compare generated, imported, uploaded and replaced result envelopes.

C01 to C10 are test-suite claims that the final full test run will settle; skip them.

Report at cloud/reports/older-fixes.md and in your final message: shas, each item fixed, not a bug, or stopped and why, tests with exact commands.
