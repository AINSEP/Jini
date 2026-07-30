# Jini CI/CD and Autonomous Quality Plan

> **Status:** Deferred design document. Nothing in this document is enabled yet.
>
> **Recorded:** 2026-07-23
>
> **Implementation prerequisite:** Finish the current application, package, and
> test-baseline stabilization work before adding CI as a required merge gate.

## Purpose

Build a rigorous, understandable CI/CD system that:

- gives developers fast feedback on local commits and pushed branches;
- validates every pull-request revision before merge;
- tests the exact combined revision that enters `main`;
- exercises failure paths, contracts, integration boundaries, and desktop/web
  behavior rather than relying on happy-path coverage;
- separates deterministic merge authority from probabilistic AI review;
- permits useful autonomous investigation and fixing without creating an
  unbounded reviewer/fixer loop;
- never prevents a human contributor from continuing to fix a genuine issue;
- evaluates existing free, open-source, and self-hostable autonomous review
  systems before building or adopting one;
- keeps the repository owner able to explain, stop, inspect, and recover every
  automated system before that system receives consequential authority;
- releases only artifacts produced from a verified `main` revision.

This plan deliberately separates three systems:

1. **CI** determines whether a revision satisfies executable repository
   contracts.
2. **Autonomous quality agents** help diagnose and repair failures under bounded
   authority.
3. **CD** promotes an already verified revision into packages, desktop
   artifacts, or deployments.

## Core decision

Deterministic CI is the merge authority. AI reviewers and fixers are assistants
around that authority, not substitutes for it.

```text
local commit -> local fast checks
       push -> GitHub CI -> required Merge Gate -> merge queue
                                            |
                                            v
                                      verified main
                                            |
                                            v
                                  package/desktop release

failed deterministic check
       |
       v
read-only AI triage -> autonomous fixer workspace -> deterministic CI again
       |                         |
       +---- human escalation <--+
```

An AI approval alone must never make a failing revision mergeable. Conversely,
an autonomous fixer's internal work budget must never prevent a person from
pushing another fix and running CI again.

## Why this differs from the PR #5228 experience

The Open Design
[MemorySection refactor PR #5228](https://github.com/nexu-io/open-design/pull/5228)
demonstrated two different failure modes:

- It grew to 37 commits, 72 changed files, 14,497 additions, and 2,467
  deletions.
- It received 27 `CHANGES_REQUESTED` reviews and only three approvals.
- Three commits existed only to retrigger unrelated flaky checks.
- Its final revision had a broad green check matrix, but semantic issues around
  malformed successful responses and state hydration could still be found.
- The test suite executed many paths, but important negative contracts,
  concurrency behavior, and malformed-response handling were not specified
  strongly enough.
- The reviewer/fixer objective was effectively open-ended: keep searching until
  no more possible defects can be found.

The lesson is not that autonomous review is useless. The lesson is that its
success criterion must be measurable and convergent.

Good success criteria include:

- every declared contract test passes;
- the supplied reproduction no longer fails;
- all findings introduced by the current diff are resolved, waived, or
  converted into tracked follow-up work;
- no existing required check regresses.

“No model can imagine another bug” is not a measurable success criterion.

## Required owner comprehension gate (“grill me”)

The repository owner has explicitly requested a rigorous explanation and
questioning session before these systems become operational. This is a safety
requirement, not optional onboarding.

There is no assumption that the owner should trust an agent-generated workflow
because its YAML looks plausible or its checks are green. Before implementation,
Codex should explain the proposed system in plain language and then actively
test the owner's understanding through teach-back and failure scenarios.

The exercise should cover:

- the difference between local checks, CI, autonomous review/fixing, CD, and
  production monitoring;
- exactly which deterministic check blocks a merge and which AI outputs are
  advisory;
- what code, credentials, logs, pull requests, and infrastructure each actor
  can read or change;
- how a stale SHA, false-positive review, flaky test, compromised dependency,
  or malicious pull request is handled;
- how to stop an agent, revoke its credentials, cancel a workflow, bypass a
  broken rule safely, and recover the last known-good state;
- how autonomous progress budgets work and why an agent pause does not prevent
  a human from continuing;
- where costs, model identity, reasoning configuration, prompts, tool calls, and
  patches are recorded;
- what conditions permit package publication, desktop signing, deployment,
  rollback, and auto-merge;
- which assumptions are enforced in executable tests and which still depend on
  human policy.

The session should use concrete scenarios rather than vocabulary trivia. Example
questions include:

1. A pull request is approved by an AI reviewer but `Merge Gate` is red. What
   happens and why?
2. An autonomous fixer changes a test until it passes. How would you determine
   whether it fixed the product or weakened the contract?
3. A test fails once and passes on retry. Is the revision green, flaky, or
   blocked?
4. An agent has made six useful iterations and is still uncovering bounded
   failures. Should it continue?
5. An agent repeats the same patch twice and asks for broader write access. What
   stops it, and who can authorize more scope?
6. A GitHub Action used by the release workflow is compromised. What access
   could it have, and how do pinned SHAs and minimal permissions reduce harm?
7. A required check is broken and blocks every pull request. How can it be
   repaired without normalizing permanent administrator bypasses?
8. A published desktop build is bad. Which exact artifact is rolled back, and
   why must it not be rebuilt from the same source during rollback?

Codex should identify gaps or uncertain answers, explain them again with a
concrete example, and update this plan when the discussion exposes an unstated
decision. The goal is not to “pass” the owner or demand jargon. The goal is for
the owner to be able to:

- describe the authority boundaries accurately;
- locate the relevant workflow, rule, logs, credentials, and emergency stop;
- recognize when an AI agent is making an unsupported claim;
- make informed decisions about risk, cost, bypass, and release.

Run this comprehension gate at three points:

1. before implementing the first required CI workflow;
2. before granting any autonomous fixer write permission or enabling
   auto-merge;
3. before adding release credentials or unattended production promotion.

Do not enable the corresponding high-impact capability until the owner gives
explicit sign-off after the relevant session.

## Current Jini baseline

As of 2026-07-23:

- `.github/workflows/publish.yml` is the only GitHub Actions workflow.
- Publishing runs after pushes to `main`; it is not a pre-merge quality gate.
- The workspace contains hundreds of package tests, but there is no root
  `build` or `test` script that defines the canonical complete suite.
- There is no repository-level browser or desktop E2E harness yet.
- Root typechecking still has known `packages/ui` test-double failures that
  should be repaired before typecheck becomes a required check.
- The root package declares Node `~24`, while the current publish workflow sets
  up Node 20. CI and publishing must use the declared supported runtime.

CI should not be made required while the expected baseline is knowingly red.
The first implementation step is to make the intended local verification
command reproducibly green.

## Validation layers

| Layer | Trigger | Purpose | Expected duration |
| --- | --- | --- | --- |
| Local commit check | Each local commit | Formatting, linting, and focused tests for fast feedback | Seconds |
| Local pre-push check | Before a push | Guard, focused typecheck, focused unit tests | A few minutes |
| Branch push check | Every pushed non-`main` branch | Frozen install, boundaries, typecheck/build, affected tests | About 5–10 minutes |
| Pull-request check | Open, reopen, synchronize, ready-for-review | Full package suite, contracts, integrations, consumer tests, selected UI tests | About 10–25 minutes |
| Merge Gate | PR head and merge group | Stable aggregate authority over every required result | Minimal overhead |
| Main verification | Every push to `main` | Verify the actual merged revision and produce promotable artifacts | Full suite |
| Nightly/deep check | Scheduled | Repetition, flake detection, mutation, property, fuzz, and broad matrices | Time-boxed, potentially hours |
| Release/promotion | Verified release revision | Sign, attest, publish, deploy, or promote existing artifacts | Product-dependent |

GitHub cannot validate an unpushed local commit. Local hooks are developer
feedback and can be bypassed; server-side CI and repository rules remain the
enforced authority.

## Proposed GitHub Actions structure

### `ci-fast.yml`

Run on pushes to non-`main` branches:

- check out the exact revision;
- install with `pnpm install --frozen-lockfile`;
- use Node 24 and the repository-declared pnpm version;
- run boundary and metadata guards;
- run typecheck/build and tests for affected packages and their dependants;
- report focused failures quickly.

This workflow is feedback, not the only merge gate.

### `ci.yml`

Run on:

- `pull_request`;
- `merge_group`;
- pushes to `main`.

Initially run the complete suite on every pull-request revision. Introduce
affected-package optimization only after the dependency graph and invalidation
logic are themselves tested. A false negative from an optimization is more
expensive than a few extra CI minutes.

Suggested jobs:

1. **Preflight**
   - frozen dependency installation;
   - lockfile consistency;
   - repository guard;
   - package metadata and boundary checks;
   - generated-file drift checks.
2. **Static**
   - typecheck;
   - lint/format checks once canonical commands exist;
   - public API and protocol compatibility checks.
3. **Package unit tests**
   - all package tests;
   - deterministic sharding only if needed;
   - machine-readable test reports.
4. **Contract tests**
   - HTTP and event schema contracts;
   - malformed-response behavior;
   - public package/export contracts;
   - runtime and agent adapter contracts.
5. **Integration tests**
   - daemon, SQLite, HTTP, streaming, chat, and runtime composition;
   - cancellation, reconnect, failure recovery, and persistence boundaries.
6. **Consumer tests**
   - pack publishable `@jini/*` packages;
   - install them into `examples/minimal-host`;
   - prove that a consumer does not depend on workspace-only source behavior.
7. **Web and desktop smoke**
   - reference web boot and a small critical-flow suite;
   - Electron smoke on supported operating systems;
   - later, installed-artifact smoke rather than source-only smoke.
8. **Merge Gate**
   - always run after all required jobs;
   - inspect every dependency result explicitly;
   - fail if a required job failed, was cancelled, timed out, or was
     inappropriately skipped;
   - expose one stable check name for repository rules.

Required workflows should not use top-level path filters. A filtered workflow
can leave a required check pending, and large diffs can exceed changed-file
filtering limits. Let the workflow start and make any safe relevance decision
inside jobs while still producing the stable `Merge Gate` result.

### Concurrency

- Cancel superseded CI runs for the same pull request or branch.
- Do not cancel verification already running for `main`.
- Serialize production promotion.
- Key all autonomous observations and changes to the exact head SHA.
- Discard review or triage output if the PR head changes before publication.

## Canonical repository commands

Before workflow implementation, define and document canonical root commands
conceptually equivalent to:

```text
pnpm build
pnpm test
pnpm typecheck
pnpm guard
pnpm verify:ci
```

`verify:ci` should be reproducible locally and should compose the same
deterministic checks used by GitHub. Workflow YAML should orchestrate and
parallelize these commands; it should not contain a second, hidden definition of
repository correctness.

## Test strategy

### Unit tests

Continue testing package-local logic, but require tests for both success and
failure behavior. A unit test count or coverage percentage is not evidence that
the important invariants were selected.

### Boundary and contract tests

Contract tests should deliberately exercise:

- malformed `200 OK` payloads;
- missing, partial, null, wrong-type, and unknown fields;
- invalid event orderings;
- incompatible protocol versions;
- retries, duplicate commands, and idempotency;
- provider timeouts, rate limits, and partial failures;
- errors that must be redacted at an HTTP boundary;
- backward-compatible package exports and serialized data.

Runtime validators should exist at untrusted transport boundaries. TypeScript
types alone do not validate network or persisted data.

### Concurrency and state-machine tests

Critical lifecycle code should test:

- cancel during start, replay, or stream delivery;
- terminal events racing with replay;
- reconnect after partial delivery;
- concurrent finish/cancel calls;
- append or persistence failure before committing in-memory state;
- process restart and state recovery;
- subscriber cleanup when callbacks or encoders throw;
- timeout and watchdog failure.

Property-based or model-based tests are appropriate for state machines whose
interleavings are larger than a curated example set.

### Integration tests

Exercise real component composition:

- daemon plus SQLite;
- daemon plus HTTP;
- runtime process plus stream parser;
- HTTP plus reference web chat;
- Composer command plus chat submission plus streamed response;
- installed/packed package plus minimal consumer.

Use fakes at true external service boundaries, not between every Jini package.

### Semantic Composer and agent controls

The Composer should expose semantic operations through stable UI/chat ports,
for example:

```text
composer.setDraft(...)
composer.attach(...)
composer.submit()
composer.cancel()
```

WebMCP, MCP-UI, AG-UI, integration tests, and agent workflows should call the
same product command surface. Playwright should verify that actual browser
buttons and keyboard interactions reach that surface, but it should not be the
only way to drive ordinary chat behavior.

This produces faster and less brittle integration tests while retaining a small
set of genuine browser and desktop checks.

### Nightly/deep testing

Move expensive, high-value discovery into scheduled lanes:

- repeat concurrency-sensitive tests many times;
- mutation-test critical validators and state transitions;
- run property and fuzz tests with persisted seeds;
- execute wider operating-system/runtime matrices;
- detect order dependence and resource leaks;
- measure and report flaky tests;
- run longer desktop and packaging scenarios.

A nightly finding should open or update one deduplicated issue. It should not
silently mutate `main`.

## Flaky-test policy

Empty commits must never be the supported retry mechanism.

When a check fails:

1. Preserve its logs, seed, environment, shard, and exact SHA.
2. Permit at most one diagnostic rerun at the job or test layer.
3. If the rerun passes, classify the result as flaky rather than silently green.
4. Create or update a deduplicated flake record with owner and first/last seen
   revisions.
5. Keep the test blocking until fixed, or place it in an explicit,
   owner-approved quarantine with an expiry.
6. Fail expired quarantines.

Infrastructure failures and product failures need different labels and
ownership, but neither should require contributors to manufacture a new commit.

## Autonomous quality system

### Evaluate existing free platforms first

Before building a Jini-specific autonomous reviewer or adopting Looper, survey
current free, open-source, free-tier, and self-hostable code-review platforms.
Licenses, pricing, model support, and free-tier limits change, so reverify them
at evaluation time rather than preserving an assumed list in this plan.

The survey must include Looper and multiple credible alternatives. Evaluate each
candidate against the same requirements:

- license, maintenance activity, community health, and self-hosting support;
- whether repository data or source must leave infrastructure controlled by the
  owner;
- supported Git forges, coding-agent CLIs, models, and BYOK options;
- read-only review, suggested-patch, isolated-worktree, and direct-write modes;
- head-SHA pinning, stale-result cancellation, idempotency, and finding
  deduplication;
- changed-range and affected-contract scoping;
- progress-aware budgets, loop/oscillation detection, and human escalation;
- protection against weakening tests, changing CI, leaking secrets, or
  expanding write scope;
- interaction with GitHub required checks, merge queue, CODEOWNERS, and
  contributor forks;
- auditability of prompts, model/reasoning configuration, tool calls, patches,
  costs, and decisions;
- false-positive dismissal, legacy-debt handling, and reviewer quality;
- installation complexity, operational burden, and recovery when its daemon or
  service fails.

Do not select a platform from its README or a single impressive review. Create a
small, sanitized Jini evaluation corpus containing:

- a correct change that should pass;
- a straightforward regression;
- a malformed-response contract bug;
- a concurrency or lifecycle bug;
- an unrelated pre-existing defect that should not block the change;
- a flaky-test/infra failure;
- an oversized diff that should trigger human scoping;
- an attempted test weakening or unauthorized workflow change.

Run candidates against the same revisions and score:

- true blockers found;
- false blockers raised;
- important regressions missed;
- convergence behavior;
- unauthorized actions attempted;
- time, model/token cost, and human review burden;
- quality and reproducibility of evidence.

The possible outcomes are:

- adopt a platform largely as-is;
- adopt it behind stricter Jini policy wrappers;
- reuse selected architectural ideas;
- build a small Jini-specific system only where existing options fail measured
  requirements.

The comparison and recommendation must be reviewed during the owner
comprehension gate before autonomous write access is approved.

### Authority separation

Use distinct roles:

- **Observer/triager:** read-only; classifies the failure and gathers evidence.
- **Fixer:** writes only in an isolated branch or worktree within an explicit
  scope.
- **Reviewer:** read-only and independent from the fixer; assesses the proposed
  patch and new regression test.
- **CI:** reruns deterministic checks and remains the final technical authority.
- **Human maintainer:** decides ambiguous product behavior, scope expansion,
  waivers, and release promotion.

An agent must not review and approve its own patch as the only review.

### Fix budgets are not contributor limits

There should be **no two-attempt limit on users**. A person may push as many
genuine fixes as needed. Every new revision receives fresh deterministic CI.

Autonomous fixing should use an adaptive work budget rather than a universal
hard attempt count:

- A fix incident is keyed by repository, PR, head SHA, failing check, and a
  normalized failure signature.
- The fixer may continue while it is producing measurable new evidence or
  monotonic progress.
- Every few mutation cycles—three is a reasonable initial checkpoint—the system
  re-triages instead of blindly continuing.
- Progress can mean fewer failing assertions, a newly isolated reproduction, a
  validated contract decision, or a patch that passes the targeted regression
  while exposing a different bounded failure.
- A changed head SHA, materially changed failure signature, maintainer
  clarification, or approved scope expansion starts a new decision point rather
  than consuming an old incident forever.
- Time, token, cost, changed-line, and wall-clock budgets remain configurable
  safeguards.

The autonomous fixer pauses and escalates when:

- it produces the same failure without new evidence in consecutive cycles;
- it oscillates between equivalent patches or reopens resolved findings;
- it needs a product or compatibility decision;
- the required change crosses its authorized file/risk boundary;
- it proposes weakening tests, guards, schemas, coverage thresholds, or CI;
- it reaches its configured resource budget without meaningful progress;
- secrets, security, migrations, release infrastructure, or destructive data
  operations require new authority.

A pause means “the agent needs help,” not “the contributor may no longer fix
this.” The PR remains editable, new human pushes continue to trigger CI, and a
maintainer can explicitly resume autonomous work with new context or a larger
scope.

### Changed-scope review

The reviewer should primarily block on:

- regressions introduced by the current diff;
- violated contracts on a touched execution path;
- pre-existing bugs that the diff materially worsens or makes newly reachable;
- missing tests for newly declared behavior.

Unrelated legacy debt should become a separate issue unless it creates an
immediate safety or security risk.

Findings should have stable identities based on invariant, location, and
evidence. A resolved or waived finding cannot be reopened without materially new
evidence.

### Required regression-first behavior

For a bug fix, the fixer should normally:

1. reproduce the failure;
2. add or identify a deterministic failing test;
3. make the smallest authorized fix;
4. run the focused test;
5. run affected package checks;
6. hand the patch to independent review and full CI.

Exceptions—such as inherently flaky timing defects—must still preserve a
repeatable diagnostic harness, stress test, trace, or other executable evidence.

### Autonomous mutation restrictions

Without human approval, an autonomous fixer must not:

- delete or skip failing tests;
- loosen assertions or runtime validation;
- lower coverage or mutation thresholds;
- add broad retries or arbitrary sleeps;
- change required CI workflows or repository rules;
- update unrelated dependencies or the lockfile;
- expand beyond the declared file/risk scope;
- push directly to `main`;
- force-push a contributor-owned branch;
- enable auto-merge.

For an external contributor PR, prefer a suggested patch or a separate
maintainer-owned fix branch unless the contributor explicitly authorized bot
writes.

## Pull-request scope and risk

Large changes need explicit handling because review quality falls as unrelated
concerns accumulate.

Introduce a soft size warning and a human exception rather than an inflexible
line-count rejection. Candidate starting points:

- warn above 800–1,000 non-generated changed lines;
- warn above 25 changed files;
- require a risk note when protocol, persistence, security, CI, public API, or
  desktop release code changes;
- require an explanation when generated snapshots or source moves legitimately
  make the diff large.

The preferred response to an oversized change is to split it into independently
valid vertical slices with explicit acceptance contracts, not to weaken review.

## Repository rules

Create a `main` ruleset only after the baseline CI is green:

- require a pull request;
- block direct and force pushes;
- require the stable `Merge Gate` check from GitHub Actions;
- require the latest reviewable revision to be approved;
- dismiss stale approvals after material changes;
- require CODEOWNERS review for critical surfaces;
- require merge queue or strict up-to-date checks;
- restrict bypass authority and audit its use.

Use merge queue so the required suite tests the combined revision that would
actually enter `main`. The CI workflow must include the `merge_group` event or
required checks will not run for the queue.

## Security and supply-chain checks

- Set default workflow permissions to read-only and grant writes per job.
- Never expose repository secrets to untrusted pull-request code.
- Avoid `pull_request_target` for building or running contributor-controlled
  source.
- Pin third-party Actions to reviewed full commit SHAs.
- Enable dependency review and reject newly introduced vulnerabilities at an
  agreed severity.
- Enable CodeQL/default code scanning where available.
- Generate provenance and an SBOM for released packages and desktop artifacts.
- Keep signing, notarization, and publication credentials in protected release
  environments.

## CD and artifact promotion

CI and CD must use the same verified revision.

### Package publication

- Align the publish workflow with Node 24.
- Require the release/version PR to pass the same `Merge Gate`.
- Build and test the exact release SHA.
- Prefer promoting artifacts produced by verified `main` CI; otherwise repeat
  the complete immutable verification before publishing.
- Keep Changesets as the versioning mechanism.
- Generate provenance and record package name, version, git SHA, workflow run,
  and checksums.

### Desktop release

When the desktop host is ready:

- build on the supported macOS, Windows, and Linux runners;
- sign/notarize before promotion;
- install and launch the produced artifact in a clean smoke environment;
- verify daemon startup, renderer connection, Composer submission, and clean
  shutdown;
- publish first to a canary/prerelease channel;
- promote the exact tested artifacts rather than rebuilding them;
- keep rollback metadata and the prior known-good release available.

### Deployment

For hosted examples or future services:

- create an ephemeral preview environment per PR where useful;
- run smoke tests against the deployed preview;
- promote the verified artifact to staging;
- require protected-environment approval for production until rollback and
  health automation are proven;
- automatically roll back on explicit health-contract failure, not on an LLM
  opinion.

## Observability and audit

Persist for every CI and autonomous run:

- repository and exact SHA;
- trigger and actor;
- command, runner image, OS, Node, and pnpm versions;
- test reports, coverage, seeds, and relevant logs;
- normalized failure signature;
- agent vendor/model/reasoning configuration;
- prompts/instructions and tool permissions;
- files changed and patch;
- resource usage and elapsed time;
- triage classification and escalation reason;
- final human or automated disposition.

Autonomous operations must be idempotent. Reprocessing the same event must update
the existing incident or finding rather than creating another review, issue, or
patch loop.

## Deferred implementation sequence

Do not begin this sequence until the current application and package work is
ready for CI enforcement.

### Phase 0 — Green baseline

- repair known root typecheck failures;
- align supported Node versions;
- define canonical root build/test/verify commands;
- measure complete-suite runtime and existing flakes;
- decide the initially supported operating-system matrix.

### Phase 0A — Owner comprehension and platform research

- run the first owner “grill me”/teach-back session;
- document questions, answers, gaps, and resulting plan changes;
- survey current free, open-source, free-tier, and self-hostable autonomous
  review platforms;
- benchmark credible candidates against the same sanitized Jini corpus;
- record whether to adopt, wrap, reuse, or build;
- obtain explicit owner sign-off before enabling required CI.

### Phase 1 — Deterministic CI

- add fast push and full PR/main workflows;
- add frozen install, guard, typecheck, build, and all package tests;
- add the stable `Merge Gate`;
- upload machine-readable test and failure artifacts;
- verify behavior on success, failure, cancellation, and superseded revisions.

### Phase 2 — Integration and consumer gates

- add packed-package/minimal-host verification;
- build daemon/SQLite/HTTP/chat integration fixtures;
- test malformed contracts and concurrency;
- add semantic Composer controls;
- add focused web and Electron smoke tests.

### Phase 3 — Repository enforcement

- create the `main` ruleset;
- require `Merge Gate`;
- add CODEOWNERS for critical surfaces;
- enable merge queue;
- rehearse bypass and recovery procedures.

### Phase 4 — Deep and security lanes

- add nightly mutation, property, repetition, and flake detection;
- enable dependency review and code scanning;
- harden Action permissions and pin dependencies;
- add release provenance/SBOM.

### Phase 5 — Autonomous triage

- run the second owner comprehension gate before granting agent write access;
- ingest deterministic failures read-only;
- normalize and deduplicate incidents;
- classify product, flaky, infrastructure, security, and unknown failures;
- produce evidence-backed proposed next actions;
- validate SHA invalidation and stale-result cancellation.

### Phase 6 — Bounded autonomous fixing

- add isolated worktrees and strict mutation scopes;
- require regression-first evidence;
- implement adaptive progress checkpoints and resource budgets;
- add oscillation/no-progress detection;
- use independent read-only review;
- keep humans unrestricted and CI authoritative.

### Phase 7 — CD

- run the third owner comprehension gate before adding release credentials;
- connect verified `main` to Changesets publication;
- add package provenance;
- add desktop build/sign/install-smoke/canary promotion when ready;
- add hosted preview/staging/production promotion only for real deployable
  consumers.

## Decisions to make at implementation time

- Which CI checks must be green before enabling the ruleset?
- What runtime target and operating systems are officially supported?
- What is the acceptable PR feedback time and nightly budget?
- Which packages or paths require CODEOWNERS?
- What constitutes sufficient progress for extending an autonomous incident?
- What initial time/token/cost/line-change budgets are appropriate per risk
  class?
- Which flaky-test quarantine policy and expiry are acceptable?
- Which free/open-source autonomous review candidates pass the Jini benchmark,
  and should one be adopted, wrapped, or used only as design input?
- Has the owner completed the relevant comprehension gate and explicitly signed
  off on the authority being enabled?
- Which release artifacts need signing, notarization, provenance, and SBOMs?
- When is human approval required for package publication and desktop
  promotion?

These are configuration and governance decisions. They should not be encoded as
model prompt folklore.

## Primary references

- [PR #5228](https://github.com/nexu-io/open-design/pull/5228)
- [Looper](https://github.com/nexu-io/looper)
- [GitHub required checks and merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [GitHub dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customize-dependency-review-action)
- [GitHub Actions secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
