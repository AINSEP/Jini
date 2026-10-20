# W3 core-agentic: coordinator progress

Branch: `cloud/w3-core-agentic` (based on origin/general-work). The brief lives at `origin/cloud/w3-briefs:.cloud-coord/W3-core-agentic-brief.md`.

## STEP 0
`Linux vm 6.18.44-fc-v139 x86_64 GNU/Linux | vm | /home/user/Jini | 2026-10-20T04:30:29Z | node v22.22.0 (system) → v24.22.0 via nvm`
Cloud-proof commit 396b8ed0.

## Persona loads
- Coordinator: software-architect, code-review (the vendored toolkit has no `code-inspection` agent, so `agents/code-review/skills.md` stands in), and security. All three were loaded from the **vendored** `/home/user/Jini/AI-Dev-Shop/agents/`. The `git clone` of github.com/leonaburime-ucla/AI-Dev-Shop was refused by this session's permission classifier ("Untrusted Code Integration"), so subagents load the same vendored files.

## Setup
- Node 24: `/opt/nvm` exists, and `nvm install 24` gave v24.22.0. Each shell sources `/tmp/w3env.sh`, which puts it on PATH.
- `pnpm install --frozen-lockfile`: 17 s. `pnpm --no-bail -r build`: 102 s (only `integrations` fails tsc on its own tests, and dist is still emitted).
- Baseline `pnpm guard` on the unmodified tree is NOT ok: 32 `[guard]` lines (26 violations), saved to `/tmp/w3-coord/guard-baseline.txt`. In-scope violation: `HW3-module-state packages/core/src/text/sanitize-untrusted-text.ts`. The merge gate is therefore **no new guard lines vs baseline**.
- Baseline complexity: `/tmp/w3-coord/baseline-eslint.txt`. The temp eslint config is at `/tmp/w3-coord/cx.config.mjs`.
- Worktrees take about 5 s each (offline install + dist copy).

## Lots
| Lot | Status | Branch tip | Before→after worst cyc/cog | Coverage | Verify |
|---|---|---|---|---|---|
| L043a | MERGED | 4c524dbe | tool-input-normalization 40/59→9/10; approval 14/13→8/7; registration-kit 13/14→7/6 | 100/100/100/100 all 3 (coord re-run, 26 files / 475 tests) | eslint 0, tsc ok, no Errors line, guard 31 (none new) |
| L043b | MERGED fdc8fd95 | 982eb8a6 | origin-validation 13/9→10/6; redact 14/14→7/6 | 100/100/100/100 both (coord re-run, 24 files / 482 tests) | eslint 0, tsc ok, no Errors line, guard 31 (none new) |
| L078a | MERGED | 80944035 | settings 12/12→10/8; agent-value-write-tools 20/15→9/7; tool-registrations 12/11→7/6 | 100/100/100/100 all 3 (coord re-run, 35 files / 325 tests) | eslint 0, tsc ok, no Errors line, guard 31 |
| L078b | MERGED | 1a46d33e | ensure-definitions 13/13→7/5; cms-adapter 15/22→6/8; http 14/11→9/6 (+ new http-request.ts 8/2); stream 19/0→9/8 | 100/100/100/100 all 5 (coord re-run, 35 files / 403 tests) | eslint 0, tsc ok, no Errors line, guard 31 |
| L177-L251-L270 | MERGED | d4ef02a4 | sanitize stripControlSequences 14/28→4/5 (file worst 8/5); paths 14/11→6/6; gateway execute 12/11→6/4 | 100/100/100/100 all 3 (coord re-run, 9 files / 148 tests) | eslint 0, tsc ok, no Errors line, guard 32→31 (fixed the sanitize HW3 line) |
| L038-L097 | dispatched | | 40/45 → | | |
| L101-L249 | MERGED | ff26a2a6 | json-pointer 17/27→6/6; resolve 20/20→6/6; tree 7/11→7/9; encoder 15/0→8/6 | 100/100/100/100 all 4 (coord re-run, 30 files / 468 tests) | eslint 0, tsc ok (tsconfig + tsconfig.dom), no Errors line, guard 31 |

## Merges / RED checks / removed checks / bugs / security
### L177-L251-L270 (subagent: ~140k tokens, 52 tool calls)
- Pins: f0fcbb28. Differential old-vs-new, temp tests deleted: about 3.25M exhaustive plus 200k random sanitizer strings, and about 1.16M plus 200k path combos. Output identical.
- RED: isOscTerminatorAt, csiEnd, oscEnd, escapeSequenceEnd, stripControlSequences, resolveSegments, normalizeAbsolutePath, windowsRoot (UNC pins added after the first RED run missed it), requireAuthorization, unredeemableTokenError, loadRedeemableToken, execute. Each break was caught.
- Removed: the 3x copied authorize/refuse block (now one helper), the 2x copied redeemed-vs-expired choice, the 3x separator test, and a redundant end-of-string check in the OSC end (charCodeAt past the end is NaN). Checks removed: none.
- Security (pinned, reported not fixed): (1) stripControlSequences lets bidi override/isolate characters (U+202E, U+2066-2069, U+200F) through: Trojan-Source reordering. (2) pathContains with the `\\` separator treats a `.. ` segment (trailing space) as a plain name, but Win32 trims trailing dot/space.
- Gateway test moved: src/__tests__/gated-mutations-gateway.test.ts → src/gated-mutations/__tests__/gateway.test.ts (imports only).
### L043b (subagent: ~123k tokens, 36 tool calls)
- Pins c613f73d, with a truth-table snapshot. Differential: 200k origin and 60k redact cases, temp tests deleted.
- RED: parseHttpUrl, parseDottedQuad, isPrivateIpv4Prefix, explicitLocalOrigins, effectivePort, isAllowedWithoutOrigin, credentialPatterns, applyPatterns, redactExactSecrets, redactUrlCredentials, redactKeyedCredentials, redactPii.
- Removed: duplicated URL+protocol parse, duplicated dotted-quad parse, the repeated loopback list, a host decision computed but unused on the Origin path, the single-use redactApiKeyHeaderValue, and the per-call PII filter (now once at load).
- Sub-conditions dropped with proof (commit afd025dc): `Number.isInteger(n) && n >= 0` in the dotted-quad parse. `/^\d+$/` already admits only non-negative ASCII-digit integers, and an overflow to Infinity still fails `n <= 255`. The truth table pins it. Coordinator agrees.
- Security (pinned): a malformed ORIGIN allow-list entry is echoed in full into the warn log and the boot error, so `user:pass@host` would leak its credential (origin-validation configuredAllowedOrigins / assertValidAllowedOrigins).

### L043a (subagent: ~181k tokens, 62 tool calls)
- Pin files: tool-input-normalization / approval / registration-kit.gates `.characterization.test.ts`. Differential old-vs-new, temp tests deleted: 30k normalization cases; 5,760 exhaustive approval scenarios, aborting at every port with the full port-call log compared; 12,096 registration builds.
- RED: done for every extracted function. One mutation survived: deleting askFresh's post-grant abort check. The run step's own abort check gives the same observable result, and the check was kept.
- Removed: seven positional walk params (now one context object), a dead string fall-through, the twice-written grant condition and confirmer, a local answer type duplicating HumanConfirmationAnswer, and the field-error block copied three times (now requiredFieldError). Checks removed: none.
- Not removed (out of scope): `applyApprovalPolicy` has no callers, and its `remembered` option can never fire. `registration-kit.characterization.test.ts` largely duplicates `registration-kit.test.ts`.
- Bugs pinned, reported not fixed: catalog ids naming Object.prototype members (e.g. `toString`) (a) skip the wired-or-declared tripwire (`id in spec.handlers`, fail-open) and (b) get `Object.prototype.toString` as their input normalizer (`spec.inputNormalizers?.[id]`).
- Security: that tripwire fail-open. Also normalizeToolInput rewraps ToolInputError without `cause`, losing the stack.
- Coordinator note: the moved readOnly comment still says assertToolIsWirable ran "two lines above". It is now about 10 lines above, in registrationFor. The comment was kept verbatim, and it is a cosmetic follow-up.

### L078a (subagent: ~179k tokens, 73 tool calls)
- Pins 366b20d6. **Process flaw:** that pin commit did not typecheck (a test-helper typing slip); the next commit, 8671e1f3, fixes it. History was not rewritten, because force-push is forbidden. Differential: 8,408 value-write scenarios, compared on results, revisions and authorize calls.
- RED: all extracted fns; four needed an extra pin before their mutation was caught.
- Removed: in resolveDefinitionRaw, the depth-0 visited check (always false at depth 0) and a dead post-loop return. The self-alias cycle check is kept explicitly in aliasTarget. The deny/confirm rule lists and toWriteDeps were built twice; both now live in agent-value-write-tools.ts, which exports them internally only (not via a barrel or package export) with the why-comment moved. The `serialized === undefined` JSON refusal is merged into the same try (JSON.parse(undefined) throws, giving the same message) and pinned.
- Added `cause` to the mapped ToolInputErrors. No message text changed.
- Bug pinned: an input key `""` bypasses parseTarget's unexpected-input check (`if (extra)`); it is ignored downstream, so impact is low.
- Coverage-recipe gap: tool-registrations.* suites import through `write-tool-fixture.js`, so the basename grep misses them. My first re-run read 16% until every settings/__tests__ suite was included.
### L078b (subagent: ~191k tokens, 75 tool calls)
- Pins 1216ffa1, 094f1efd, a1d1c236. Differential: 22,200 http requests, temp test deleted.
- Removed check (with proof, commit 534cb5f9): `if (close)` around stream tracking in http.ts. openSettingsChangeStream is typed `Promise<() => void>`, both returns return `close`, and its catch rethrows. Pinned by "disposing after a stream opened closes it". It is a null-guard, not a security check, so it is accepted.
- Removed: duplicated, unattached JSDoc blocks (merged), four repeated optional-field spreads (now a field list), `intervals[n]!` assertions, and the repeated 401 response and value-body parsing.
- Bugs pinned: a workspace reset of a CORE namespace clears nothing (cms-adapter reset looks only at workspace definitions). A site-namespace workspace reset with no body workspaceId throws not-found (direct callers only).
- Security: http.ts validates body fields before authorization on value writes and reset, so an unauthorized caller learns the validation message. The workspace-mismatch 404 has no `code`. Both are pinned as current behaviour.

### L101-L249 (subagent: ~149k tokens, 45 tool calls)
- Pins f7609541, a2b2c064, ddf21337, da71b85c. Differential: 20k generated documents/pointers covering reads, writes and joinPointer, temp test deleted.
- RED: all 21 extracted fns caught (list in the subagent report: tryParsePointerTokens … encodeToolResult).
- Removed: the array-index regex (3x) and try/parse (2x), each now one helper; joinPointer reuses isRootPointer; a redundant `!head ||` (the index regex already rejects ""); the resolve-internal round trip through the public resolveDynamicValue; an unused import; the duplicated stage_start/stage_end encoding; the child-push loop is extracted.
- Removed check (with proof): the `index < length` test before splice in the array delete. splice past the end removes nothing, and this is pinned by "deleting an out-of-range array index returns an unchanged copy". It is not a validation check.
- Security (pinned, reported not fixed): (1) resolve.ts resolveArgs: an agent arg named `__proto__` sets the prototype of the args object handed to the host impl (`resolvedArgs[key] =`), so the impl sees inherited properties like `isAdmin`. The global prototype is not polluted. (2) json-pointer setAtPointer has no upper bound on array indexes, so one message can set length to about 4e9 (memory/CPU DoS). (3) writes ignore an empty middle segment (`//x`) while reads honour it; this was already documented.

## Next
