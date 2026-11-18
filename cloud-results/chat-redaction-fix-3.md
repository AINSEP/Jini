# chat-redaction-fix-3 (Jini, branch wave2/chat-deps)

Base: origin/wave2/chat-deps `6d692b92` (the round-2 tip). Setup: Node 24.22.3, `pnpm install --frozen-lockfile`
(exit 0), `pnpm --no-bail -r build` (exit 0). Baseline on the unmodified tree, `npx vitest run --maxWorkers=2 --minWorkers=1`:
core 219 files / 3441 tests, chat 305 | 1 skipped / 4507 | 1 skipped, cms 338 / 4085, diagnostics 61 / 998,
analytics 15 / 225, all exit 0.

## DESIGN-NOTE

**Why two rounds did not converge.** Each round fixed the examples a reviewer handed in. Nothing in the tree said what
"no regression against old chat" meant, so each patch was checked against its own examples and the reviewer's next
probe found a sibling in the same class (another separator, another label, another context).

**Design: parity corpus as the oracle, fixes stay in core.**

1. *Corpus.* The old chat redactor is recoverable byte for byte: base `4c189236` chat `user-text-redaction.ts` on top of
   the diagnostics `secrets-only` rules and core's `SECRET_SHAPE_PATTERNS` at that commit. A scratch harness ran it on
   (a) every string literal of the old and current redaction tests of chat, diagnostics, core, cms and analytics plus the
   review probes (2,186 inputs), and (b) a generated sweep: 25 credential labels x 10 separators (`=`, `:`, tabs,
   line breaks, blank lines, CRLF) x 11 value shapes x 8 contexts (line start, mid-sentence, list item, numbered form,
   JSON key, `export`, CLI flag, quoted curl header) = 22,000 inputs. Each input the old redactor changed is recorded with
   the tokens it hid. The test (`packages/chat/src/core/__tests__/user-text-redaction.parity-corpus.test.ts`) runs chat's
   `redactUserText` on all of them: **every token the old redactor hid must stay hidden, and every prose line it kept
   must stay kept.** A future finding becomes a corpus entry, so the class is closed by the oracle, not by the example.
2. *Fixes go into core, not a chat layer.* The findings are in core files that cms, diagnostics and analytics also use
   (finding 4 is cms's own leak), so a chat-only layer would have left them exposed, and a second rule set in chat is the
   duplication this branch removed. Core's other callers are protected by their existing pins (`redact.callers-pin.test.ts`,
   48 answers, unchanged) and their full suites (below).
3. *Accepted differences are named, not hidden.* 16 recorded inputs differ from old chat on purpose (decided in rounds
   1-2: a scheme word alone, release ids after `Token`, a URL host and contact address after masked credentials, label
   words beside a masked value, `name=` followed by another assignment). They are listed in the test with their class;
   none shows a credential value. The same "next line is another assignment" class is excused in the sweep by one
   narrow pattern.

**Parity corpus size (committed fixture, 172 KB):** 579 recorded inputs the old redactor masked (563 checked + 16
decided), 12,000 masked inputs of the 22,000-input sweep, 366 prose lines it kept. Vendor-key shaped inputs (AWS,
GitHub, Slack, OpenAI/Anthropic, Stripe, Google, JWT, PEM; 42 recorded inputs and 17 prose lines) were left out of the
fixture: GitHub push protection rejected the first push because the copied test literals look like real AWS keys, and
core's vendor-shape tests (which build such strings with `join`) already own that class. I did not use the unblock link.

**Red/green of the corpus:** on `6d692b92` it fails on 99 of 563 recorded inputs, 1,422 of 12,000 generated inputs and
50 of 366 prose lines; on the tip, 0 / 0 / 0.

## Findings -> test -> fix commit (each commit carries its test and its fix; "red" = test run on the parent)

| # | finding | test file | red on parent | commit |
|---|---|---|---|---|
| 1 HIGH | auth values across line breaks; bare Basic/Token after >16 whitespace | core `redact.auth-line-breaks.test.ts` | 8 of 12 | `63b186dc6` |
| 2 HIGH | Digest params with whitespace around `=` | core `redact.digest-spacing.test.ts` | 5 of 7 (mutation: same 5) | `cb57e950b` |
| 3 HIGH | connection-URL password tail after `,`/`;` inside userinfo | core `redact.url-userinfo-tails.test.ts` | 4 of 7 | `7a23c0a28` |
| 4 HIGH | cms email sends partly masked multiword passwords | cms `email-fields-multiword-credentials.unit.test.ts` | 3 of 4 (mutation: same 3) | `025d16b51` |
| 5 MED | alias quoted values with backslashes, long multiword keys, next-line values (standalone aliases, `--token=` flags) | core `redact.label-alias-forms.test.ts` | 13 of 15 (mutation: same 13) | `58c92c322` |
| 6 MED | long letters-only password after mid-sentence label; field-start policy sentence hidden | core `redact.colon-prose-r3.test.ts` | 7 of 15, then 4 of 6 more | `16e8ef883`, `0d7470431` |
| 7 MED | backup/recovery/scratch/emergency code URL params | core `redact.url-backup-codes.test.ts` | 10 of 16 | `6625bb98e` |
| 8 MED | multi-pair `cookie=`; scheme word as literal password; Google AQ terminal hyphen | core `redact.assignment-shapes-r3.test.ts` | 12 of 18 (mutation: same 12) | `d35083f7f` |
| 9 MED | chat URL scheme matcher quadratic | chat `user-text-locations.scheme-scan.test.ts` (timing bound 1 s on 200 KB) | 3 of 9 (13.8-18.7 s) | `d494a4090` |
| 10 LOW | sort-key 11-character limit hides readable identifiers | core `redact.qualified-key-identifiers.test.ts`, chat `user-text-redaction.core-engine.test.ts` | core 3 of 8, chat 2 of 4 | `410e4fbc8` |
| corpus | next-line credential-shaped values (blank lines, trailing text) for engine labels and aliases; value glued after a quoted `"password: "` hint; `Authorization:` next line | core `redact.next-line-values-r3.test.ts` | 12 of 20 (mutation: same 12) | `cf00734c3` |
| corpus | parity corpus test + fixture | chat `user-text-redaction.parity-corpus.test.ts` | see above | `c8c73c3cb` |
| gates | size, complexity and why-comment gates (behaviour unchanged) | - | - | `317c0b56a` |

Corrections to commit messages: `d35083f7f` says "13 of 18"; the parent fails 12 of 18 (I relaxed one assertion before
the fix). `16e8ef883` was amended locally before its push.

What each fix does: (1) header name, scheme word and value may be separated by any whitespace; the bare Basic/Token
lookbehind reads any whitespace run, still linear (200,000-char run test). (2) `[ \t]*=[ \t]*` inside a Digest parameter.
(3) the stop at `, ; ( ) < > " '` between two `@` applies only when the text before it is host-shaped (dotted name,
`localhost`, bracketed IPv6, optional port). (4) cms mails an answer in which core finds any credential as one
`[REDACTED:credential]` marker; each multi-select option is judged alone. (5) quoted values read backslash escapes as one
unit; multiword quoted keys up to 160 chars; a quoted value may sit on a later line; next-line values for standalone
aliases and exact names after `-`. (6) a 12+ character first word after a colon label is never read as a sentence start;
a field-start sentence beginning with the label word or a plural credential noun stays prose. (7) `backup|scratch|emergency`
code names, plural `codes`, one leading qualifier word. (8) `cookie=` value runs over `; name=value` pairs; the
"scheme word is not the credential" exception applies only after `authorization`/`api-key` header labels; AQ/AIza rules
end without `\b`. (9) URL spans are found from each `://` and walked back once over the scheme run, then merged with
path matches in one left-to-right scan; a 30,000-string fuzz compared every `(start, end)` query of old and new finder:
0 differences. (10) after a qualified key, a readable identifier (letter words joined by `_`/`-`/camel case, at most a
4-digit tail) is kept at any length.

Decisions that reverse round-2 choices (owner rule: no regression vs old chat wins): a single-token or credential-shaped
value after a blank line under a colon label is masked again (two round-2 pins moved to the masked side); cms no longer
mails an answer partly masked (two round-2 cms pins now expect the whole-answer marker).

## Left (honest list)

- A password fragment that itself looks like a dotted host directly before `,`/`;` (`p@ss.word,tail@host`) still ends the
  userinfo early; telling it from `host.example.com,bob@example.com` needs more than the text.
- A mid-sentence passphrase of plain short words (`..., password: purple monkey dishwasher`) is read as prose and kept; the
  old redactor kept it too, and cms then mails it as written.
- `name=` followed by a line that is its own `key=value` keeps that line (decided class, round 2).
- Over-masking that matches old chat: the first token after `Authorization:` and a line break, and a single-token line
  after `pwd:` (e.g. a path).

## Gates on the tip (exact command -> exit code)

All run at `317c0b56a` (the last code commit), Node 24.22.3.

| command | exit | notes |
|---|---|---|
| `pnpm --no-bail -r build` | 0 | |
| `pnpm guard` | 0 | |
| `node scripts/check-size.mjs` | 0 | `redact.ts` under its 554 debt after the split |
| `node scripts/check-complexity.mjs` | 0 | 17 entries |
| `node scripts/check-why-comments.mjs --base 6d692b92` (this run's base) | 0 | 0 lost |
| `node scripts/check-why-comments.mjs --base origin/refactor/terra --merge-base` (branch base `4c189236`) | 1 | 19 lost blocks, same count as round 1, in 12 files none of which this run touched |
| `node scripts/check-hook-injection.mjs` | 1 | same rows on `6d692b92` (ui files, not touched) |
| `node scripts/check-error-gate.mjs --strict` | 1 | 20 new/worse rows, identical list on `6d692b92`; none in a file this run touched |
| `pnpm api:check` | 0 | no export of core, cms or chat changed by this run; listed diffs are earlier branch commits |
| core `npx vitest run --maxWorkers=2 --minWorkers=1` | 0 | 228 files / 3563 tests (baseline 219 / 3441) |
| chat, same | 0 | 307 + 1 skipped files / 4524 + 1 skipped tests (baseline 305 / 4507) |
| cms, same | 0 | 339 / 4089 (baseline 338 / 4085) |
| diagnostics, same | 0 | 61 / 998 (baseline 61 / 998) |
| analytics, same | 0 | 15 / 225 (baseline 15 / 225) |

No test was deleted or skipped: every package count went up or stayed equal. Four earlier pins changed on purpose and
are named above (two core blank-line pins, two cms whole-answer pins).

## Core callers

Callers of `redactSecrets`/`redactSecretsWithCounts`/`formatErrorForLog` checked here: chat, cms, diagnostics, analytics
(full suites above) and core's own 48 caller pins (unchanged). Other callers (agent-runtime, daemon, mcp, cli, platform,
http-kit, integrations, plugins, ui, agent-plugins) were not re-run this round. Tovu was not touched; no pin changed.
