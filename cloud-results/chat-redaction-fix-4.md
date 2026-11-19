# chat-redaction-fix-4 (Jini, branch wave2/chat-deps)

Base: `ff71281f0` (round-3 tip). Setup: Node 24.22.3, `pnpm install --frozen-lockfile` (exit 0), `pnpm --no-bail -r build`
(exit 0). Package suites on the unmodified tree (round-3 report numbers, re-confirmed for chat/cms/diagnostics here):
core 228 files / 3563 tests, chat 307 + 1 skipped / 4524 + 1 skipped, cms 339 / 4089, diagnostics 61 / 998.

## Design choice (round 4: one change per class, not per example)

The findings fell into six classes. Each got one rule change that every caller shares; per-example patches were not used.

1. **Header values read folded continuation lines.** Every header rule now reads a value the way HTTP folds it: the
   api-key header rules accept any whitespace (line break included) between a scheme word and its value, as the
   Authorization rules already did; a cookie header's value includes continuation lines that start with indentation.
   Inside an Authorization header the token after `Bearer` is the value whatever it says; and the token after an
   `authorization` label is never read as prose (on its line, mid-sentence, or on the next line).
2. **One shared next-line value reader.** `LINE_STARTS_ASSIGNMENT` (core `redact-prose-values.ts`) is the single
   definition of "this next line is its own `name=value`"; trailing `=` padding is part of a value. The engine's labels
   and the alias labels both use it.
3. **Field names decoded before matching.** A URL/form parameter name with percent escapes and a quoted JSON key with
   `\u` escapes are decoded, then judged with the URL parameter vocabulary (`redact-encoded-names.ts`, bounded, linear).
4. **Values read to their real end.** A YAML block scalar's value is its indented body; a Markdown label closes its
   emphasis around the colon before the value; a signature parameter ends at `#` (a password may hold `#`, a URL-safe
   signature never does); a hex digest after a qualified key and a readable path after a bare `key:` stay readable.
5. **Mask the request once, before it is serialized.** The durable run store masks the user text inside the accepted
   request (user message and prompt) before `accepted_json` is written; a request with nothing to mask is stored byte
   for byte. Other surfaces: cms judges a field's label as well as its id; diagnostics bundles mask URL userinfo.
6. **Linear-time scans.** The whitespace after a label separator is read once (`(?=(\s*))\3`), so a rejected bare scheme
   word no longer re-runs the header lookbehind per position; chat reads a URL tail only where a scheme starts a URL.

**Oracle.** The old chat redactor (base `4c189236`) was rebuilt in a scratch directory (not committed) and reproduced
the committed corpus (572 of 579 recorded hidden lists identical; the 7 others differ only in marker words; 366/366
prose lines). It was then used to re-record the corpus with a stronger check (below) and to confirm each R input.

## Findings -> test -> RED (on ff71281f0) / GREEN

| finding | test (file > name) | RED | GREEN |
|---|---|---|---|
| R1 | core `redact.header-continuation.test.ts` > "masks a credential after a scheme word on the next line" (2 cases) | 2 fail | pass |
| R2 | same file > "masks every cookie pair, including pairs on a folded continuation line" | fail | pass |
| R3 | core `redact.next-line-padding.test.ts` > "masks a padded value on the line after %s:" (4) + double padding | 5 fail | pass |
| R4 | core `redact.header-continuation.test.ts` > "masks a description word used as the value of an Authorization header" (3) | 3 fail | pass |
| L1 | chat `durable-run-store.accepted-request.test.ts` > "masks a credential in the accepted user message and prompt before storing the request" | fail | pass |
| L2 | core `redact.block-and-emphasis-values.test.ts` > block scalar body (3), emphasised label (2) | 5 fail | pass |
| L3 | core `redact.encoded-field-names.test.ts` > decoded parameter name (3), decoded JSON key (3) | 6 fail | pass |
| L4 | cms `email-fields-credential-labels.unit.test.ts` > "a field labelled %j is not mailed, whatever its id" (3) | 3 fail | pass |
| L5 | diagnostics `redaction.url-userinfo.test.ts` > "masks %j" (3) | 3 fail | pass |
| O1 | core `redact.key-and-signature-readability.test.ts` > "keeps %j" (4) | 4 fail | pass |
| O2 | same file > "keeps the fragment" (2) | 2 fail | pass |
| T1 | chat `user-text-redaction.parity-corpus.test.ts` (re-recorded corpus) + `user-text-redaction.vendor-families.test.ts` | see below | pass |
| P1 | chat `user-text-locations.schemeless-delimiters.test.ts` > "stays linear when a whitespace-free run of delimiters doubles" | fail (3.6 s vs bound 2.5 s) | pass (52 ms) |
| P2 | core `redact.header-continuation.test.ts` > "stays linear when the padding doubles" | fail (~1 s) | pass |

RED runs: core/cms/diagnostics/chat tests were run with the fix files reverted (`git stash` of the source, new tests
kept): core round-1 files 12 of 16 failed, round-2 files 17 of 27 failed; the others as listed.

**T1 (test gap).** The parity corpus is re-recorded from the old redactor with a token-level tokenizer: pieces of any
length (markers removed first), minus the parts the old output itself showed beside a marker. A piece counts as shown
when it is an output token, when a split piece reappears inside an output token, or when a marker leaves a fragment of
it (partial disclosure). The wholesale skip of next-line cases (374 sweep cases) is gone: one named class (`name=`, a
line break, then the sweep value that is itself `key=value`) excuses only that line's own tokens, and scheme words
are excused only in front of a marker. Eight round-4 inputs joined the recorded corpus (587 recorded, 13,664 generated
hidden entries, up from 12,000 because short values now count). The stronger check found one more regression, fixed
in core: the token after a mid-sentence `authorization:` label (new tests in `redact.header-continuation.test.ts`, 3 RED
then GREEN). A vendor-family sweep (eight families plus PEM, keys built at runtime, eight contexts, 72 tests) asserts no
whole key and no 6-character piece of a key body stays visible in chat text.

## Pins changed on purpose (owner rule: no regression vs the old chat redactor)

- core `redact.user-text.test.ts` and chat `user-text-redaction.core-engine.test.ts`: `Authorization: Bearer token` is
  now masked (was kept); the old redactor masked it.
- core `redact.test.ts`: three signature parameters (`?X-Amz-Signature`, `;signature`, `#sig`) left the "masks through
  the fragment" list; their fragment now stays readable, as the old redactor kept it.

## Commits (all pushed to origin/wave2/chat-deps)

`c1409f886`, `8340e6ff9`, `5a0d7a37d`, `e9f553472`, `661a099ba`, `f7c9d17e5`, `bbd5e3451`, `6c8b5767d`, `839905388`,
`74c91d834` (plus this report).

## Gates on the last code commit `74c91d834`

| command | exit | notes |
|---|---|---|
| core `npx vitest run --maxWorkers=2 --minWorkers=1` | 0 | 233 files / 3606 tests (base 228 / 3563) |
| chat, same | 0 | 310 + 1 skipped / 4600 + 1 skipped (base 307 / 4524) |
| cms, same | 0 | 340 / 4093 (base 339 / 4089) |
| diagnostics, same | 0 | 62 / 1005 (base 61 / 998) |
| `tsc --noEmit` in core, chat, cms, diagnostics | 0 | |
| `pnpm guard` | 0 | |
| `pnpm check:size` | 0 | `redact.ts` debt lowered 554 -> 551 |
| `pnpm check:complexity` | 0 | 17 entries, unchanged |
| `pnpm api:check` | 0 | no export changed by this run |
| `node scripts/check-why-comments.mjs --base ff71281f0` | 0 | 0 lost |
| `node scripts/check-error-gate.mjs --strict` | 1 | 20 new/worse rows, same count as round 3's base; none in a file this run touched |
| `node scripts/check-hook-injection.mjs` | 1 | pre-existing ui rows; none in a file this run touched |

No test was skipped. Four earlier cases moved from "kept" lists to the masked/readable side (listed above); every
package count went up.

## SHIPPABLE: yes

All fourteen findings have a failing-first test that is now green, the parity corpus is stronger and green, and every
gate this task names passes (error-gate and hook-injection failures are pre-existing and outside the touched files).

## Left (honest list)

- The parity check's containment rule ignores split pieces shorter than 4 characters inside longer output tokens (a
  one-letter piece is found inside every word); whole short tokens and fragments next to a marker are checked.
- The accepted run request's prompt is masked with chat's user-text policy as a whole; assistant text inside a
  transcript prompt goes through the same policy (model input was already guarded that way).
- The cms label check uses the same credential word list as the id check, so a field label such as "Forgot password?"
  is also left out of mail (the safer side).
- Carried from round 3: `name=` followed by a line that is its own `key=value` keeps that line (decided class).
