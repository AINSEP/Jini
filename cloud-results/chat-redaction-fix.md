# chat-redaction-fix (Jini, branch wave2/chat-deps)

Base: origin/wave2/chat-deps `cc1b8fd7`. Method: one differential harness (the old chat redaction + diagnostics rules from
origin/refactor/terra `4c189236` against core's engine on this branch, ~1,200 hand-written and test-derived inputs plus a
vendor-key length sweep) found each class; every class got a failing test first, then the smallest fix **in core**.
Chat keeps no rule of its own: the only chat source change is the deletion of its `(skipped)` workaround.

## Commits (all pushed to wave2/chat-deps, fast-forward)

Each class is ONE commit carrying its test and its fix, because the owner rule "every commit passes alone" forbids a
committed red test. "Red" below is the count of cases that fail with the fix stashed (parent state); "mutation" is the same
run after re-applying the fix and removing it again.

| class | commit | core cases red on parent | chat cases red on parent |
|---|---|---|---|
| pin (other callers, 48 answers, green before any change) | `ac280652` | n/a (green) | n/a |
| 8 `TokenBearer` takes the next word | `0c1a5567` | 5 of 9 | 3 of 4 |
| 5 `@` inside a connection-URL password | `0c7bc583` | 6 of 12 | 2 of 8 |
| 7 URL parameter ending in `code` | `2a7882e2` | 7 of 16 | 3 of 12 |
| 4 + 9 webhook secret (`whsec_`), 30-35 char GitHub tokens, temporary AWS key ids | `4ec2b457` | 15 of 39 | 3 of 17 |
| 2 + 3 custom auth header (`x-auth-token`, proxy header), schemes Token / ApiKey / Digest, bare Basic/Token credential | `78accc1a` | 23 of 37 | 8 of 27 |
| 1 label aliases (`passwd pwd id_token auth_token signing_secret webhook_secret`) and prefixed env-style names | `64525992` | 15 of 37 | 8 of 39 |
| 6 prose and `(skipped)` after a label and a colon | `9425d2aa` | 25 of 37 | 7 of 47 |
| size/complexity/why-comment gates (behaviour unchanged) | `609475ba` | n/a | n/a |
| follow-up from the A/B sweep (regressions my own class 7 and 2/3 rules caused) | `8d7d6bbf` | 6 + 4 | 3 |

Files: new core modules `redact-label-aliases.ts`, `redact-auth-schemes.ts`, `redact-vendor-shapes.ts`,
`redact-prose-values.ts`, `redact-text-scan.ts` (finders and literal search moved out of `redact.ts` with their
why-comments; `redact.ts` size baseline 601 -> 562). Chat pins: `user-text-redaction.chat-parity.test.ts`. Changesets: one per class.

## What each class now does

1. Aliases and prefixed names (`DB_PASSWORD`, `app_secret`): masked in `=`, quoted JSON/inspect and 12+ character colon form. A prose colon (`pwd: ok`) stays readable. Names the engine's own label rules own are left to them.
2. `x-auth-token` joins the header names; `Proxy-Authorization` with Token/ApiKey/Digest masked.
3. `Authorization: Token|ApiKey|Digest <value>` masks the value (the label rule used to take the scheme word and leave the credential); bare `Basic|Token <16+ chars with a digit>` masked. A scheme word alone (`Authorization: Bearer`) is kept.
4. `whsec_` + 24 or more alphanumerics masked (`stripe_key`).
5. URL userinfo runs to the last `@` of the authority.
6. After a colon, an unquoted value that is a placeholder (`(skipped)`, `none`, `n/a`, `******`), the start of a sentence (letters-only word followed by a word), or on the next line is kept. A single credential-shaped token (`API key: abc`, `password: hunter2`) is still masked. `=` stays strict.
7. `code` is no longer a URL secret word. Exact names that carry a credential stay masked: `code`, `code_verifier`, `device_code`, `session_code`, `verification_code`, `login_code`, `otp_code`. `zipcode`, `promo_code`, `error_code` and the public `code_challenge` keep their values.
8. `Bearer` must start a word.
9. Diagnostics rules E2 dropped that the engine lacked: `whsec_`, GitHub tokens of 30-35 characters, `ASIA` key ids, `x-auth-token`, the non-Bearer schemes, label aliases, last-`@` userinfo. Everything else the diagnostics engine had (PEM, JWT, cookies, Anthropic/OpenAI/Google/AWS AKIA keys, Stripe keys) was already covered; verified by a prefix x length sweep (40 prefixes x 10 lengths): no remaining case where the old rules masked and core does not, except a glued `xASIA...` (see below).

## Gates (exact command -> result)

- `cd packages/core && npx vitest run --maxWorkers=2 --minWorkers=1` -> 210 files, 3243 tests passed (baseline 202 / 2997; +8 files, +246 tests are the new ones)
- `cd packages/chat && npx vitest run ...` -> 304 passed | 1 skipped, 4490 tests (baseline 4439; +51 chat parity cases)
- other callers of the engine, same command per package, all green and equal to their baseline counts: diagnostics 997 (baseline 999; the 2 missing are my scratch harness files, removed before commit), agent-runtime 4479, agent-plugins 2165, analytics 224, cli 592, cms 4085, daemon 4729, http-kit 570, integrations 2053, mcp 1805, platform 3117, plugins 1011, ui 8585
- `pnpm run typecheck` in packages/core and packages/chat -> clean
- `node scripts/check-size.mjs` -> passed; `node scripts/check-complexity.mjs` -> passed (17 entries)
- `node scripts/check-why-comments.mjs --base origin/wave2/chat-deps` -> ok, 0 lost. Against the default base (origin/refactor/terra) it reports 19 lost blocks, all in chat test and store files from earlier commits on this branch, none in files I touched
- `pnpm guard` -> ok
- `npx eslint` on the touched files -> 0 errors, 3 warnings, all in `redact.ts` and present on the base (super-linear regex at the JWT rule, break/continue count, nested ternary)
- `pnpm api:check` -> core has no API change (new modules are not exported). It lists REMOVED exports for chat, agent-runtime, daemon, http-kit, sqlite: those come from earlier commits on this branch, marked "covered by changeset", not from this run.
- not clean and not from this run: `check:hooks` (packages/ui `AssetGridToolbar.tsx`), `check:log-safety` (packages/http-kit `node-bridge.ts`), `check:errors` (warn mode). I did not touch those files.
- Honest note: the intermediate commits `78accc1a`..`9425d2aa` pass all tests and typecheck but fail the size/complexity ratchets until `609475ba` (the split). Run the ratchets at the tip.

## Core callers whose answers I checked

Callers of the engine: agent-plugins, agent-runtime (provider errors), analytics, chat, cli, cms, daemon, diagnostics, http-kit, integrations, mcp, platform, plugins, ui (all suites above). Before any change I pinned 48 answers in
`packages/core/src/__tests__/redact.callers-pin.test.ts` (error text, paths, hashes, UUIDs, ordinary URLs, headers, vendor keys, shell prose); all 48 are unchanged
except the one I changed on purpose (`Authorization: Bearer` with no value is now kept; it is a documentation phrase). I also ran base engine against new engine on 11,446 string literals taken from every package's tests (404 diffs, 196 distinct inputs) and read every diff that unmasks something: all are the intended classes 6, 7, 8 and scheme-word-alone cases, or JavaScript source text such as `secret: true`.
Tovu: `redactUserText` (chat/core) in `credential-chat-intake.ts`, `redactSecrets` in about 20 files; the Tovu tests that call it use exact-secret redaction or markers verbatim, none of the changed shapes. I did not run Tovu's suite.

## Decisions and left

- Class 7 reading: I kept the exact name `code` masked (OAuth authorization code, one existing core test pins `?code`) and moved `?zipcode` out of the "masked" pin. If you meant that exact `code` should also be readable, delete the alternative in `URL_SECRET_PARAM_RE`; it is one line.
- One older core pin changed: `redaction-union.test.ts` vector `prefixbearer abc...` became `prefix bearer abc...` because class 8 requires a word boundary.
- A passphrase typed after a colon as plain lowercase words (`password: correct horse battery`) now reads as prose and is not masked; the old rules did not mask it either. A one-word value is still masked.
- Prefixed names widen masking for other callers too: `APP_ADMIN_PASSWORD=x`, `--db-password=x`, `my-token=x` and placeholders like `DEEPSEEK_API_KEY=<your-key>` are now masked everywhere (the old chat rules did the same).
- Not changed, already true on the base: `(key=[REDACTED:api_key_query])` loses its `)` and category, and `Bearer <value>):` swallows `):`. Pre-existing core quirks.
- A key glued to a word (`xASIA...`, `xBearer abc`) is not masked by the new rules, which require a word boundary.
- `Proxy-Authorization` with a bare value (no scheme) is not masked; Bearer, Basic, Token, ApiKey and Digest are.
- Redaction counts for a repeated pass keep using core's generated markers; chat's `[token removed]` is chat's own display and is protected before the engine runs, unchanged.
