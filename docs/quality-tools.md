# Quality tools: report first

These tools start as observations. Application scan steps use `continue-on-error: true`
and are absent from the final blocking-gate expression. Semgrep's custom-rule regression
tests are blocking because they test scanner rules, not application findings. Existing guard/typecheck policy
is unchanged. SonarJS runs locally without Docker or a server; SonarQube Cloud stays disabled.
The initial rollout prohibited execution; the 2026-10-20 Sonar triage and targeted
verification are recorded below. Other tools have separate execution evidence.

| Tool | What it checks | Run from the root | Read the output |
| --- | --- | --- | --- |
| Knip 5.61.3 | Unused files, exports, dependencies; unresolved references | `pnpm quality:knip` | Inspect each category and confirm public/consumer use before deleting anything. |
| dependency-cruiser 18.1.0 | Cycles, resolved package boundaries, production-to-test imports, orphans | `pnpm quality:depcruise` | Each warning names its rule and source/target edge; cycles include their path. |
| Gitleaks 8.28.0 | Default secret rules over every fetched git ref and merge history | `pnpm quality:secrets` | Redacted findings name the rule, file and commit. A skipped scan is not a clean result. |
| fast-check 4.3.0 | Generated parser/validator invariants via package-local Vitest | `pnpm quality:properties` | A failure includes a minimized counterexample and replay path; each suite prints its seed. |
| SonarJS 4.2.0 | Bug, security-hotspot, reliability and maintainability rules on production package source | `pnpm quality:sonar` | Compact totals and counts per rule; review parser/configuration errors separately. |
| Semgrep CE (CI: 1.175.0) | Five public registry packs plus six review-derived JS/TS rules | `pnpm quality:semgrep` | Counts per rule and analysis-error counts; `pnpm quality:semgrep:test` checks annotated positive/negative examples. |

The Coordinator must update `pnpm-lock.yaml` after these exact manifest versions land,
then install and build the workspace before first runs. CI uses a frozen lockfile;
the manifest-only change cannot be merged without that refresh. The version choices
reuse Tovu's dependency-cruiser release and published Knip/fast-check releases rather
than adding floating ranges. Runtime application dependencies are unchanged.

## Discovery and reuse

The Codebase Memory CLI/index and Graphify output were absent in this scratch clone.
The available understand-anything graph still names the old `chat-core` tree. Source
reads and manifests therefore supplied the current contracts. Tovu's dependency-cruiser
configuration, Sonar files and secret-pattern catalog were inspected read-only.
No scanner implementation or secret-pattern catalog was copied: Gitleaks owns scanning,
and Jini's platform owns IP classification. OAuth properties call that public owner.

Active CMS properties target `packages/cms/src/forms/forms.ts`, reached by the submission
service through `validateSubmissionPayload` and the shared field registry. The legacy
`packages/cms/forms` workspace remains in static analysis, but has no new property tests:
its deprecated contract differs (including authored checkbox behavior).

## SonarJS policy and reuse

`development/quality/sonarjs.config.mjs` exports `sonarjsConfig` (plugin, recommended
settings and chosen rules), `skippedSonarRules` (every exclusion with its reason), and
source/test globs. Tovu can import that object and apply its own file scope. This is
the single policy owner: both the root ESLint config and the isolated Sonar config
consume it. Existing Tovu rules were inspected as precedent, not copied as a second
policy. Codebase Memory/Graphify were unavailable here; the available knowledge graph
had no current Sonar tooling owner, so current manifests/configs supplied the evidence.

The installed 4.2.0 catalog has 279 rules: 217 recommended and 62 additional rules.
216 recommended rules and 45 additional rules are enabled for JavaScript (261 warn
rules); TypeScript disables the reference checker too (260 warn rules), since tsc
owns its references. `no-redundant-optional` conflicts with exactOptionalPropertyTypes.
All other problem rules, regex rules and security hotspots (including deprecated
implementations and `no-unsafe-unzip`) remain warnings.
The policy enables the entire catalog then applies 18 convention exclusions, rather
than relying on Sonar's recommended flag to imply security coverage. Review catalog
changes when upgrading the dependency. See [the rule catalog](sonarjs-rules.md) for
each installed rule, its disposition, type-information requirement, and skipped reason.

Thresholds are cognitive complexity 15, duplicate strings 5 occurrences, nested
functions 4 levels, and switch cases 30. Existing core complexity stays warn 15;
`complexity:strict` still overrides core/cognitive complexity to error 10. Expanded
rules apply only to `packages/*/src` and nested `packages/cms/forms/src`, including
JS/TS variants. Tests (`__tests__`, `tests`, `test`, `*.test.*`, `*.spec.*`, `*.typecheck.ts`) are excluded
from the expansion. The old complexity settings on tests and other TS files remain.

`quality:sonar` uses `eslint.sonar.config.mjs`, which contains only SonarJS rules:
no core complexity or product-boundary findings enter its totals. The formatter
prints file/warning/error totals and counts per rule without source snippets or
secret values. Warnings do not fail the command; parser/configuration errors still
do. CI alone makes the step non-blocking with `continue-on-error: true`.

This retains the existing **syntax-only** TypeScript parser setup. Rules requiring
type information can be inert or less precise; enabling a rule is not proof it ran
a semantic analysis. In particular many regex rules require type information.
A clean summary is not a security audit. A separately scoped, measured rollout of
type-aware linting is needed before claiming that coverage; it is not silently
introduced across packages with different tsconfig include boundaries here.
The initial rollout ran no scanners or tests; see the dated Sonar triage below for
subsequent measurements. Installs and builds remain outside that triage.

## Sonar triage — 2026-10-20

The initial report had 5,346 warnings across 2,889 files, including 85 entries labeled
`(parser/configuration)` and zero errors. Those 85 were **ignored inline directive
warnings**, not parse failures or files outside a tsconfig. No project-service or
tsconfig include expansion was needed. Counts below come from report-only ESLint
over the shared integration working tree; concurrent jobs also change that tree,
so the entire delta must not be attributed to this triage. `packages/agent-plugins`
was scanned but never edited by this work. Git was read-only.

Configuration changes and reasons:

| Change | Reason |
| --- | --- |
| Disable `no-reference-error` only for TS/TSX/MTS/CTS in both entry points | tsc owns TS name/type/global checking; the syntax-only Sonar checker misreads those bindings. JS retains the warn rule. |
| Declare runtime globals only for web-clone `.mjs` scripts | Their Node code and Playwright page callbacks legitimately use Node and DOM globals. No unrelated JS scope is exempted. |
| Disable `no-redundant-optional` in the shared policy | `?: T \| undefined` deliberately permits both omission and explicit undefined with exactOptionalPropertyTypes. |
| Add `*.typecheck.ts` to the existing test globs | These are compile-only negative proofs with `@ts-expect-error`, not executable production behavior. They remain checked by tsc. |
| Honor inline directives; register the already-installed TypeScript plugin's definitions | Needed for the requested targeted Sonar hotspot exceptions; TS rules are not added to this Sonar-only report. |
| Filter only comment metadata for standalone `react-hooks/exhaustive-deps` and `react/no-danger` legacy directives | Those plugins are absent here. Delegating parsing to the existing TS parser and filtering these two exact comment shapes avoids unknown-rule errors without changing executable source or Sonar directives. Future unknown directives still surface errors. |
| Disable unused-disable reporting in the Sonar report scope | Existing directives for core/TS rules that this report does not run are expected to be unused. Actual rule and parse diagnostics remain visible. |

All remaining selected Sonar rules stay at warn. Root complexity/boundary rules,
compiler strictness, test assertions and coverage scope/thresholds were not weakened.
The catalog above remains syntax-only: enabling a type-dependent rule is not evidence
that its semantic analysis ran.

Behavior fixes and verification:

| Location | Fix and regression |
| --- | --- |
| `packages/ui/src/features/version-manager/dependencies.ts:18` | Seed the fake port's content map through an optional `{ content }` map. Preserve the metadata-seed API and snapshot supplied content. The new dependencies test asserts actual content, empty content, scope/file isolation and detached seeds; old code always returned null. |
| `packages/agent-runtime/src/agent-protocol/pi-rpc/session.ts:217` | Report unreadable attachments with a fixed diagnostic, omit filesystem/provider error text, and continue with valid images. The new handler test asserts the exact diagnostic and surviving image payload; old code emitted nothing. |
| `packages/server/src/create-local-node-daemon.ts:377` | Disable Express's framework-identifying response header at app creation. A socket-free test sends a request through the actual daemon-created app and asserts a completed 200 response with no `X-Powered-By`; old Express defaults supplied it. The socket integration test also checks the header. |
| `packages/commerce/src/http/payments-webhook.ts` | Drop the unused catch binding. The catch already handles the failure by returning a fixed 500 response instructing provider retry; logging raw provider exceptions would leak credentials. This is a detector false positive, not a changed response contract. |

Reviewed bug candidates retained with their contracts:

| Rule / sites in the initial report | Verdict |
| --- | --- |
| `no-unthrown-error` (7), `no-extra-arguments` (1), all in core's `args-convention.typecheck.ts` | Intentional compile-time rejection proofs. Exclude from runtime analysis, preserve every assertion and `@ts-expect-error`. |
| `no-collection-size-mischeck` (2), agentic skill archive/GitHub metadata | `entry.size` and `row.size` are untrusted numeric metadata, not native collection lengths. Keep negative-size rejection. |
| `anchor-precedence` (1), devops `checks/hardwiring.ts:147` | Intentional directory-segment alternative plus an end-anchored `.adapter.ext` suffix alternative. Applying shared anchors would change the accepted file set. No behavior bug found. |
| `duplicates-in-character-class` (2), chat persistence `title.ts:117` | `\w` already includes `_`; both redundant underscores preserve the identifier boundary. |
| Same rule (3), chat `user-text-redaction.ts:30`, core `redact.ts:205`, diagnostics `redaction.ts:22` | Upper/lowercase ranges overlap under `/i`; token punctuation remains intentional. No token is missed because of the overlap. |
| Same rule (2), diagnostics `core/secrets-only.ts:77,82` | The leading header/cookie boundary classes use upper/lowercase letters under `/i`. Header/cookie value and idempotency contracts are unchanged. |
| Same rule (5), CMS `forms/field-registry.ts:62`, devops `source-control/repository-target.ts:5,8,22`, HTTP kit `verified-origin/origin.ts:19` | `\s` intentionally overlaps C0 control ranges to reject whitespace and other controls before normalization. Removing the whole class would weaken validation. |
| `generator-without-yield` (1), DB `kernel/pglite/dialect.ts:41` | Kysely requires a lazy async iterator; this driver explicitly rejects unsupported streaming on iteration. Extend the existing targeted `require-yield` exception to Sonar, with the same reason. |
| `no-invariant-returns` (7) | Json literal parser returns a data-dependent end/null/false and advances scan state; two pi handlers emit events under a null-returning dispatcher ABI; Codex file-change completion returns handled=true even when deduplicating; CMS moderation/trash transaction callbacks return data-dependent result records and commit side effects; fake Tauri kill reports accepted=true while its script controls exit delivery. No missing return/logic branch was found. |

The reviewed regex/size/invariant findings remain warnings, with no suppression-as-fix.
No supported validation, parser behavior or lifecycle branch was removed.

Security review followed the actual trust boundaries: author URLs enter validators
and are parsed locally; OOXML URI constants identify a format; native commands use
operator-owned environments and fixed executable names/argv; image paths are untrusted
and retain containment/budget checks; payment provider exceptions reach a fixed 500
response; the daemon-created Express app owns response headers.

| Hotspot | Verdict / targeted exception |
| --- | --- |
| Hardcoded passwords (4) | Three translated credential-safety sentences are prose. The fourth is an explicitly disposable-user conformance fixture on an isolated authenticated host. Targeted line exceptions explain each. |
| Clear-text protocols (8) | OOXML namespace/relationship URIs and reserved `.invalid` parsing/origin sentinels, never transport destinations. Changing the scheme of namespace identifiers breaks format validation. Targeted exceptions preserve those contracts. |
| PATH commands (6) | Fixed `psql`, `ps`, `powershell.exe` and `reg.exe` lookups intentionally use the trusted desktop/host operator's PATH. Request data cannot set the command, argv program text or PATH. Targeted exceptions document the host-environment trust requirement. These are not a claim that an attacker-controlled host PATH is safe. |
| `x-powered-by` (1) | Real low-severity information disclosure; fixed on the app that owns the setting, without a rule exception. |

Duplicate ownership changes:

* Core `records.ts` now owns strict field matching, array upsert and scope-checked map
  deletion. Identity adapters call it for all matching/scoped row operations, preserving
  user `principalId` identity versus other rows' `id`, row order and reference semantics.
  Selectors explicitly project contract fields so unrelated caller properties do not
  change lookup/delete behavior. CMS form purge and media/GC removal use the same owner.
* Core `primitives/tasks.ts` owns serial task chaining and error observation. All three
  daemon event-stream queues call it; later work and drain ordering survive task failure.
  The existing late/terminal-race rationale moved to one shared, fixed diagnostic sink.
* Daemon diagnostics use one stream-chunk decoder for stdout and stderr.
* Tooltip pointer/focus exit events share one handler, including internal-target checks
  and the same listener teardown. No look-alike group was exempted.

Targeted verification used package-local Vitest configs with temporary source aliases
for the new core exports, since builds were prohibited and dist may be stale. Core: 4,
UI: 53, agent-runtime: 30, CMS: 6, identity: 48, daemon: 34, socket-free server: 1 —
**176 passed**. Seven test cases were added, none removed or weakened. The real-socket
server case could not bind (`listen EPERM`); its header assertion remains for an
unrestricted host. Commerce's targeted invocation selected zero files because its
config includes only React suites; the legacy webhook file uses `node:test`, so it
was not rerun through another runner. No full suites, builds, installs or typecheck
were run. `nice -n 15` was attempted as requested; this sandbox rejected setpriority
while still executing the commands. All started test/lint processes were drained.

<!-- sonar-triage-counts:start -->
Final snapshot: **2,898 files, 1,676 warnings, 0 errors; 0 parser/configuration findings**.

All measured rule totals (zero is explicit for resolved/excluded categories):

| Rule | Initial | Final |
| --- | ---: | ---: |
| `(parser/configuration)` | 85 | 0 |
| `anchor-precedence` | 1 | 1 |
| `array-constructor` | 7 | 7 |
| `bitwise-operators` | 3 | 3 |
| `bool-param-default` | 6 | 6 |
| `class-name` | 1 | 1 |
| `cognitive-complexity` | 10 | 10 |
| `concise-regex` | 18 | 18 |
| `conditional-indentation` | 17 | 17 |
| `constructor-for-side-effects` | 8 | 0 |
| `destructuring-assignment-syntax` | 13 | 13 |
| `duplicates-in-character-class` | 12 | 12 |
| `elseif-without-else` | 111 | 111 |
| `expression-complexity` | 158 | 158 |
| `generator-without-yield` | 1 | 0 |
| `nested-control-flow` | 16 | 16 |
| `no-built-in-override` | 2 | 2 |
| `no-clear-text-protocols` | 8 | 0 |
| `no-collapsible-if` | 4 | 4 |
| `no-collection-size-mischeck` | 2 | 2 |
| `no-control-regex` | 5 | 5 |
| `no-dead-store` | 9 | 9 |
| `no-duplicate-string` | 44 | 45 |
| `no-empty-collection` | 1 | 0 |
| `no-extra-arguments` | 1 | 0 |
| `no-function-declaration-in-block` | 1 | 1 |
| `no-hardcoded-passwords` | 4 | 0 |
| `no-identical-functions` | 24 | 0 |
| `no-ignored-exceptions` | 2 | 0 |
| `no-inconsistent-returns` | 128 | 128 |
| `no-invariant-returns` | 7 | 7 |
| `no-labels` | 1 | 1 |
| `no-nested-assignment` | 5 | 5 |
| `no-nested-conditional` | 208 | 208 |
| `no-nested-functions` | 44 | 44 |
| `no-nested-incdec` | 162 | 162 |
| `no-nested-template-literals` | 71 | 71 |
| `no-os-command-from-path` | 6 | 0 |
| `no-parameter-reassignment` | 2 | 2 |
| `no-redundant-assignments` | 1 | 1 |
| `no-redundant-optional` | 1581 | 0 |
| `no-redundant-parentheses` | 2 | 2 |
| `no-reference-error` | 1933 | 0 |
| `no-require-or-define` | 2 | 2 |
| `no-same-line-conditional` | 1 | 1 |
| `no-unenclosed-multiline-block` | 108 | 108 |
| `no-unthrown-error` | 7 | 0 |
| `no-unused-collection` | 1 | 1 |
| `no-unused-vars` | 59 | 59 |
| `prefer-immediate-return` | 8 | 8 |
| `prefer-single-boolean-return` | 2 | 2 |
| `pseudo-random` | 9 | 9 |
| `publicly-writable-directories` | 4 | 0 |
| `redundant-type-aliases` | 27 | 27 |
| `regex-complexity` | 24 | 24 |
| `single-char-in-character-classes` | 2 | 2 |
| `single-character-alternation` | 4 | 4 |
| `super-linear-regex` | 152 | 152 |
| `todo-tag` | 19 | 19 |
| `too-many-break-or-continue-in-loop` | 110 | 110 |
| `unused-import` | 56 | 53 |
| `updated-loop-counter` | 6 | 6 |
| `use-type-alias` | 11 | 11 |
| `void-use` | 7 | 6 |
| `x-powered-by` | 1 | 0 |

Deferred style wave, counted by package (no style sweep was performed):

| Package | Nested ternaries | Expression complexity | Inconsistent returns | Unused vars | Unused imports | Dead stores |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `admin` | 27 | 13 | 16 | 11 | 7 | 5 |
| `agent-plugins` | 2 | 6 | 1 | 2 | 0 | 1 |
| `agent-runtime` | 23 | 10 | 3 | 21 | 0 | 1 |
| `agentic` | 9 | 10 | 0 | 1 | 0 | 0 |
| `artifacts` | 1 | 0 | 0 | 0 | 0 | 0 |
| `capability-providers` | 0 | 1 | 0 | 0 | 0 | 0 |
| `chat` | 18 | 13 | 29 | 1 | 9 | 0 |
| `cli` | 1 | 0 | 3 | 1 | 0 | 1 |
| `cms` | 6 | 10 | 3 | 10 | 14 | 0 |
| `commerce` | 0 | 0 | 1 | 0 | 0 | 0 |
| `core` | 3 | 6 | 2 | 2 | 2 | 0 |
| `daemon` | 9 | 8 | 8 | 1 | 5 | 1 |
| `db` | 9 | 0 | 1 | 0 | 0 | 0 |
| `desktop-host` | 1 | 4 | 1 | 0 | 0 | 0 |
| `devops` | 6 | 8 | 0 | 0 | 0 | 0 |
| `diagnostics` | 2 | 2 | 3 | 1 | 0 | 0 |
| `http-kit` | 0 | 1 | 0 | 0 | 0 | 0 |
| `integrations` | 1 | 3 | 0 | 0 | 0 | 0 |
| `mcp` | 2 | 2 | 1 | 0 | 4 | 0 |
| `oauth` | 7 | 4 | 0 | 0 | 0 | 0 |
| `platform` | 5 | 20 | 0 | 0 | 5 | 0 |
| `plugins` | 1 | 5 | 1 | 2 | 0 | 0 |
| `protocol` | 1 | 0 | 0 | 0 | 0 | 0 |
| `registry` | 0 | 2 | 0 | 0 | 0 | 0 |
| `sandbox` | 0 | 0 | 1 | 0 | 0 | 0 |
| `server` | 0 | 1 | 0 | 0 | 0 | 0 |
| `sidecar` | 0 | 1 | 0 | 0 | 1 | 0 |
| `ui` | 63 | 21 | 47 | 6 | 2 | 0 |
| `ui-kit` | 2 | 4 | 6 | 0 | 0 | 0 |
| `user-management` | 6 | 2 | 0 | 0 | 4 | 0 |
| `vibecoding` | 3 | 0 | 1 | 0 | 0 | 0 |
| **Total** | 208 | 158 | 128 | 59 | 53 | 9 |

Packages absent from this table have zero findings in these six style categories.
Other remaining maintainability rules retain their measured totals in the full table above.
<!-- sonar-triage-counts:end -->

## Semgrep: review findings become rules

Use the free [Community CLI](https://semgrep.dev/docs/semgrep-ce/overview), with no
Semgrep account, token, npm dependency, or server. Install it yourself with
`brew install semgrep` or `pipx install semgrep`; the launcher also needs Python 3.
Both commands print an explicit SKIPPED message and install hint, then exit 127 if
the binary is absent. Missing tooling is never reported as a passing scan/test.

```sh
pnpm quality:semgrep           # full working-tree scan, summary by rule
pnpm quality:semgrep:test      # local rules only; no registry downloads
semgrep --test .semgrep       # equivalent direct rule-test command
```

`.semgrep.yml` is a **launcher manifest**, written in the JSON subset of YAML so
Python's standard library can read it. Semgrep does not support native pack imports
inside rule YAML. `scripts/quality-semgrep.py` expands its `configs` list into repeated
`--config` arguments: `p/typescript`, `p/javascript`, `p/nodejs`, `p/secrets`,
`p/owasp-top-ten`, and `.semgrep`. Do not pass the manifest directly to
`semgrep --config`; individual YAML files under `.semgrep/tests` are native rule configs.
The [CLI reference](https://semgrep.dev/docs/cli-reference) documents multiple configs
and `--baseline-commit`. Registry packs are fetched at scan time and can change;
the container pin fixes the engine, not the registry contents. A registry/network
failure is an incomplete scan, not a clean result. The launcher requests only the
OSS engine, disables metrics/version checks, never logs in, and uploads no findings.

`.semgrepignore` explicitly excludes build output, dependencies, fixture directories,
generated code, ADS-memory, AI-Dev-Shop, knowledge indexes, and intentional rule targets.
Ordinary application tests remain included: the default Semgrep ignore policy can
exclude tests, so this project supplies its own policy. No blanket test exclusion
may bypass the credential-fixture rule. Full scans return zero for findings alone;
configuration, parse, timeout, or runtime errors remain nonzero (`--strict`). The
summary prints counts only; temporary JSON can contain source/secrets, is private,
is removed on exit, and is never uploaded as an artifact. For local finding locations
use `semgrep scan --config .semgrep --metrics=off --disable-version-check .` and
handle its source-bearing output accordingly.

| Custom rule | Severity | Finding and intended repair |
| --- | --- | --- |
| `react-component-options-param` | error | PascalCase function/assigned arrow/function expression with a second parameter and a direct JSX return. Move options into props; anonymous `forwardRef` callbacks keep their ref ABI. |
| `no-raw-fetch` | warn | Bare/global/window fetch and Undici/Node HTTP requests, including named import aliases and common require forms, bypass guarded egress. Call the guarded owner. |
| `no-provider-error-echo` | warn | Caught `.message`, body/bodyText/response body/data, or `String(error)` flows into thrown/returned/logged text. Prefer fixed messages plus safe status/code. |
| `no-as-any` | warn | TypeScript `as any` discards checking. Narrow unknown or use the actual boundary contract. |
| `no-secret-literals-in-tests` | error | Test string literals containing credential prefixes with suffixes, even short dummy values. Construct fixtures from a bare prefix plus a runtime-generated suffix. |
| `log-raw-error` | warn | Caught `.message`/`String(error)` reaches common logger methods without a known redaction helper. Redact or emit a fixed diagnostic. |

Discovery used the stale understand-anything graph followed by current source;
Codebase Memory CLI/index and Graphify were absent here. CAPABILITIES and
`packages/platform/docs/decisions/DR-002-guarded-egress.md` identify the HTTP owner.
The raw-request exemptions are **exactly** platform's
`src/http/guarded/transport.fetch.ts` and OAuth's `src/guarded-transport.ts`; no whole
package/directory is exempt. OAuth's DNS-pinned adapter delegates through injected
ports. The reviewed Tovu redaction wrapper delegates to Jini diagnostics, so no
second scanner or redaction implementation was needed. Known taint sanitizers name
the existing `redactSecrets`, `redactText`, and `redactSecretShapes` owners; arbitrary
functions containing "redact" in their names do not count.

Limits: CE taint tracking is local to a function. The error rules conservatively
cover **all catches** (including promise rejection callbacks), since arbitrary
provider/importer provenance cannot be proved across calls in CE. Some local errors
will need triage. Imported redactor aliases, arbitrary wrapper loggers, deeper nested
causes, indirect network call aliases, and components returning JSX through helpers
or complex conditional expressions are not exhaustively modeled. Recognizing a
redaction call by name does not prove its binding or that all sensitive prose was
removed. Provider responses should still use fixed messages. These are review aids,
not proofs of SSRF safety or secret removal. The two error rules can report the same
log sink for different review concerns. Rule tests do not establish production path
exemptions; inspect the first application scan to verify those scopes too.

The “factory learns” loop is: identify a concrete review regression, minimize the
unsafe example, name its existing behavior owner, then add a rule and adjacent
same-stem `.ts`/`.tsx` target under `.semgrep/tests/`. Add `// ruleid: rule-name`
immediately above each expected finding and `// ok: rule-name` above the closest
valid variant. Include aliases, redaction boundaries, and unrelated safe code where
relevant. The rules live beside targets so **`semgrep --test .semgrep` discovers
every pair**; no separate custom test runner is needed. Do not use `todoruleid` or
`todook` to hide a known mismatch. Follow Semgrep's
[annotated rule-test format](https://semgrep.dev/docs/writing-rules/testing-rules).

CI uses the official `semgrep/semgrep:1.175.0` image pinned by its
[multi-platform digest](https://hub.docker.com/layers/semgrep/semgrep/1.175.0/images/sha256-1623685c0f6388b0bc8d577a712bf92b88252aaa09d6d7e38943dafa10ed978c).
It checks out full history and the PR head, runs blocking custom rule tests, then
runs the same launcher with the PR base SHA as `--baseline-commit`. Only findings
absent from that baseline report on PRs; pushes run full scans. The application scan
has `continue-on-error: true`; the job itself does not, preserving the rule-test gate.
It has read-only contents permission, no persisted checkout credential, and no
Semgrep service token. No application install/build is needed for this job.

Before making application findings blocking, run/triage the full backlog, fix rule
false positives with negative examples, assign owners, and agree the rule/severity
scope with the Coordinator. Then add `--error` (and any reviewed `--severity`
filters) to the scan invocation and remove **that step's** `continue-on-error` in
one reviewed policy change. Retain PR-baseline scanning and surface analysis failures;
do not hide legacy debt with blanket ignores or suppressions. No Semgrep scan,
rule test, install, or build was run in this dispatch; the first actual results
remain pending.

## Knip entry points and source resolution

`knip.json` lists every current `packages/*` workspace, nested `packages/cms/forms`, the
four example packages and root tooling. Package entries map actual `exports` runtime
targets back from `dist` to their existing TypeScript source, including conditional CJS
exports, wildcard contract exports, the CLI's `src/main.ts` and MCP's `src/bin/serve.ts`.
Test files are entries in the default development analysis. Generated/build output is
ignored; source files are not all entries, so unused implementation files remain visible.
Public entry exports are retained by Knip's default behavior because external consumers
are outside this checkout. Do not use `--include-entry-exports` to declare published APIs
dead without checking consumers.

When adding a workspace or public export/bin, update its Knip entries alongside the
manifest. Inspect `pnpm exec knip --config knip.json --debug` when a file appears unused
unexpectedly. The [Knip workspace configuration reference](https://knip.dev/reference/configuration)
describes per-workspace entries and public-entry handling.

`development/quality/workspace-resolution.mjs` gives dependency-cruiser analysis-only
aliases from the same manifests into source. Exact aliases preserve undeclared-subpath
findings, and `.js` extension aliases reach the real `.ts`/`.tsx` files, so source cycles
are not hidden behind compiled `dist` barrels. The module uses Node 24's filesystem APIs,
no webpack dependency. Its package patterns mirror `pnpm-workspace.yaml`; update them
when workspace membership changes. It is not a runtime package resolver.

## Dependency graph scope and guard ownership

All dependency rules currently warn. Configuration/resolution warnings still deserve
attention: an incomplete graph can hide cycles. `no-unresolved` surfaces those edges
instead of turning an absent dependency into clean architecture evidence. Dependency
cruiser's [rule reference](https://github.com/sverweij/dependency-cruiser/blob/v18.1.0/doc/rules-reference.md)
defines cycle, orphan and dependency-type matching.

| Rule/report | Purpose and boundary |
| --- | --- |
| `no-circular` | All graph cycles, including type edges, following Tovu's canonical rule. These are not all runtime initialization failures. |
| `no-cross-package-relative:*` | Cross-package relative edges, including parent/nested package boundaries. Public package imports should be used instead. |
| `no-private-source-import:*` | Resolved edges from outside a package into files behind its public export targets; includes type-only imports. |
| `no-unresolved-package-internals` | Bare `@jini-ai/*/src` or `/dist` imports refused by package exports still appear as findings. |
| `no-production-to-tests` | Source code must not import `__tests__`, `tests`, `testing`, `fixtures`, or test/fixture-suffixed modules. Test code can import source. |
| `no-orphans` | Isolated source modules, excluding published entry targets and executable bins; imported files with no consumer require Knip/reachability analysis too. |
| `automation-engine-vocabulary-firewall` | Guard's first TODO: import edges from local `foundry/automation` to engine packages, except its permitted agent-runtime leaf. The wrapper includes that tree when present and explicitly reports its absence in clean CI. |
| `[residual-js-review]` | Guard's second TODO: inventory every residual JS/JSX/MJS/CJS file under package source trees, including isolated files. This is a review queue, not an invented approved JS allowlist. |

Guard remains the owner of R1/R2 package/public-export checks, protocol purity, product
neutrality, authorization/composition, package-layer restrictions, subpath isolation,
DOM splits, extension requirements and driver isolation. Some requested package boundary
checks overlap R2; dependency-cruiser adds resolved-edge evidence, not a new approved API
list or a replacement guard. The source aliases/public targets derive from manifests.

The automation rule is an import boundary, not a proof against copied/renamed engine
types or against inappropriate agent-runtime use. The untracked foundry tree is absent
from fresh CI checkouts. Residual JS's permanent allowlist scope remains unspecified in
guard.ts; route the emitted inventory and that decision through the Coordinator before
making any entry blocking. No architecture exception has been approved here.

## Secret scanning

`.gitleaks.toml` extends every built-in rule. Its only allowlist uses **AND** between one
exact fixture file and three exact source-line patterns that construct synthetic tokens
with `.repeat()` at runtime. There is no blanket `__tests__` exclusion and no global
credential-prefix exemption. New exceptions require a demonstrated false positive and
the smallest path-plus-pattern match. Tovu's prefix-anchored secret patterns informed
the review; they do not replace Gitleaks' maintained defaults.

The `secrets-report` job checks out full history (`fetch-depth: 0`) and downloads the
**free CLI** directly from the official v8.28.0 release. It verifies the Linux x64
archive against a SHA-256 pinned in CI before extracting/executing it; the checksum
comes from the [official release assets](https://github.com/gitleaks/gitleaks/releases/expanded_assets/v8.28.0).
Review version, archive name, architecture, and checksum together on upgrade. No
licensed Gitleaks Action, `GITLEAKS_LICENSE`, service, Docker fallback, or scanner npm
dependency is required. Installation failures remain visible at job level; report-only
job policy prevents them from blocking the existing gates.

The first CLI scan covers the PR base-to-head or push before-to-after range; a new
branch with no prior SHA scans head history. The second reuses `quality-secrets.sh`
to scan `--all --full-history -m`, including merge history, even if event findings
failed the first scan. Both scans and the job remain report-only. Findings are
redacted in CI logs, with read-only permissions, no persisted checkout credentials,
no artifact uploads and no PR comments. Verify both steps on the first actual run.
The local script prints an install hint and explicit SKIPPED result when Gitleaks is
absent; it never downloads tools. Use v8.28.0 (or a reviewed newer release) for the
configured AND allowlist.

Local scans include all locally available refs, not refs you have never fetched, and
exclude uncommitted files. To inspect current files separately, use
`gitleaks dir . --config .gitleaks.toml --redact --exit-code=0`.
See [Gitleaks configuration](https://github.com/gitleaks/gitleaks#configuration) for rule
extension and allowlist semantics. Actual exposed credentials require rotation and
owner triage even while the job is informational.

## Property tests and replay

`test:properties` in platform, chat, OAuth and CMS runs only the new suites with the
package's existing Vitest config. The root command selects all four with `--no-bail`,
so one failed package does not prevent reports from the others. No global fast-check
configuration is changed. Each property runs 150 cases with seed `20261020` by default:

```bash
FC_SEED=12345 pnpm quality:properties
pnpm --filter @jini-ai/platform run test:properties
```

For a minimized failing path, temporarily pass the reported `path` with the same seed to
that property's `fc.assert` options. Retain the counterexample as a named regression
test when fixing a defect; do not weaken the generator/assertion to clear the report.

| Target | Invariants |
| --- | --- |
| `platform/net/address` and `endpoint-policy` | Expanded/padded/cased/canonical IPv6 equivalence; mapped/translated/NAT64 tails retain IPv4 classification; RFC1918, CGNAT, loopback, link-local, ULA and tunnel forms are refused by strict peer policy; public controls remain public. |
| `chat/core/partial-json` | Never throws on arbitrary bounded text/UTF-16; complete JSON round-trips; every recoverable cut is structurally prefix-consistent; completed members survive an incomplete next token. |
| `oauth/endpoint-safety` | Non-HTTPS schemes fail before policy; policy receives a URL snapshot; development loopback HTTP still requires approval; strict platform-backed policy refuses internal HTTPS variants; displayed links refuse userinfo. |
| `cms/forms` | Accepted text/checkbox values survive unchanged; honeypot never persists; unknown keys are rejected; exact maxLength boundary is honored; native checkbox normalization and authored-value matching remain correct. |

The browser-configured model-server policy intentionally permits loopback; strict
SSRF peer/OAuth policy does not. The tests preserve both contracts. Public embedded
IPv4 controls ensure the tests do not enforce a blanket NAT64/mapped-address ban.
JSON's null fallback is allowed only by the repair contract; complete JSON is asserted
separately. Prefix-consistency generators use bounded integers: incomplete exponents
can change magnitude, so numeric order/equality is not a valid general prefix invariant.

Existing tests, assertions, coverage includes/excludes and thresholds are retained.
The four Vitest configs only gain LCOV reporters for future Cloud imports. See
[the dormant Cloud setup](../development/sonarqube/README.md) before enabling it.

## First runs and promotion

1. Coordinator refreshes the lockfile, installs and builds in an authorized environment.
   Run the new commands and package tests/typechecks; record findings and actual test counts.
   This patch adds 24 generated test cases (including six range cases), deleting none;
   runtime counts are unverified until that first run.
2. Check CI logs for all new steps, the independent full-history scan, missing action
   license, unresolved graph edges, skipped local trees and stale/missing LCOV reports.
   Capture a dated baseline of real findings with owners; do not mass-ignore reports.
3. Fix false positives by correcting entries/resolution and review each narrow exception.
   Prioritize actual exposed credentials and security-boundary failures. Keep legacy debt visible.
4. After the owner reviews clean/reliable results, promote one rule at a time: switch selected
   dependency rules to `error`, remove Knip's `--no-exit-code`, change the local secret
   findings exit code, and deliberately remove the corresponding CI `continue-on-error`.
   Fast-check already returns genuine failures; it needs only an explicit CI gating decision.
   Keep a regression or a new-findings baseline where historical debt remains.
5. SonarJS promotion is a separate decision: review individual rules and baseline real findings
   before making them errors. Cloud activation also needs the public-repository decision,
   project identifiers, token, fresh normalized LCOV and a reviewed New Code period.

The informational script modes suppress *finding* exit codes for Knip/Gitleaks, not
configuration/tool errors. Vitest returns real failures; CI alone makes its step
non-blocking. A green CI job means the reports ran under that policy, not zero findings.
