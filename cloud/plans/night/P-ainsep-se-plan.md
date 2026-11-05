Software Architect(Direct): Build **AINSEP Software Engineering as a portable coding router, a compact engineering core, and task-loaded references**. Reuse AI-Dev-Shop’s engineering knowledge; remove its organizational machinery. Tests remain optional, testable design remains required, and tests that are added receive mutation testing.

This was read-only inspection within the permitted folders. No edits, tests, builds, installs, or git writes were performed.

**Inventory and disposition**

The inventory contains **22 personas, 125 SKILL.md files, 10 sensors, six contract-directory documents, 30 framework-template files, and 22 provider-template files**. Grouped entries below assign the same disposition to every named member. References inherit their parent’s disposition; “trimmed” means selected content, with pipeline prerequisites and ADS paths removed. Inclusion describes the eventual library; Thursday’s subset follows below.

| Source | Decision and reason |
|---|---|
| Agents: Programmer, Code Inspection, Refactor | **INCLUDE, merged into implement/review**—authoring, self-review, safe restructuring; no persona switching. |
| Software Architect, System Design, Spec, Red-Team, CodeBase Analyzer | **INCLUDE, trimmed into planning/discovery**—boundaries, acceptance criteria, existing-system understanding, failure analysis. |
| Database, Supabase Sub-Agent, Security, DevOps, Docs | **INCLUDE, merged into domain skills**—retain engineering practices, remove dispatch and report contracts. |
| TDD, QA/E2E, TestRunner | **INCLUDE, trimmed into optional testing**—remove mandatory test-first/certification sequence. |
| Coordinator, Observer, Skills Librarian, VibeCoder | **LEAVE OUT**—organizational roles unnecessary for one coding agent. |
| Web Design, Search Visibility | **LEAVE OUT**—separate design/discoverability responsibilities. |
| Skills: coding-foundations, implementation-guardrails, testable-design-patterns, function-quality-assessment, inline-code-documentation, general-behavior | **INCLUDE, merged into core**—reuse-before-write, explicit dependencies, stable contracts, readable functions; replace pipeline assessment paperwork. |
| code-navigation, codebase-analysis, codebase-graph, syntax-aware-editing, systematic-debugging, code-inspection, refactor-patterns, focused-test, browser-live-analysis, superpowers-receiving-code-inspection, superpowers-requesting-code-inspection, superpowers-verification-before-completion | **INCLUDE, trimmed into discover/debug/review/verify**—capability-aware investigation and evidence; graph tooling optional. |
| architecture-decisions, architecture-migration, system-design, system-blueprint, design-patterns, critical-internal-constraints, implementation-outline, advanced-frontend-architecture, feature-slice-design, hexagonal-architecture, non-functional-requirements-discovery, package-extensibility, reverse-spec, spec-writing, superpowers-brainstorming, superpowers-writing-plans | **INCLUDE, trimmed into planning/architecture references**—preserve existing conventions and binding ownership; no default FSD, Orc-BASH, ADR, or exhaustive scorecard ceremony. |
| api-design, api-contracts, backend-implementation, secure-input-handling, security-review, tool-design | **INCLUDE, trimmed into backend/security**—contracts, trust boundaries, validation, useful errors, bounded effects. |
| sql-data-modeling, postgresql, supabase, supabase-upstream, supabase-postgres-best-practices, change-management | **INCLUDE, trimmed into data/migrations**—retain platform routing, safety and compatibility. |
| developer-documentation, devops-delivery, infrastructure-as-code, observability-implementation, performance-engineering, memory-regression, backup-strategy, disaster-recovery-planning, incident-response | **INCLUDE, trimmed into operations references**—activate according to task and production risk. |
| data-engineering, rag-ai-integration, llm-operations | **INCLUDE, trimmed, later**—specialized application concerns. |
| adversarial-test-design, e2e-test-architecture, test-design | **INCLUDE, merged into optional testing**—retain meaningful assertions and mutation guidance; remove mandatory coverage floors. |
| superpowers-finishing-a-development-branch, superpowers-using-git-worktrees | **INCLUDE, merged into git hygiene**—preserve user work; avoid automatic branching/merging policies. |
| frontend-react-orcbash, vercel-composition-patterns, vercel-react-best-practices | **INCLUDE, trimmed, later React pack**—framework guidance without imposing an architecture. |
| expo-react-native, vercel-react-native-skills | **INCLUDE, trimmed, later native pack**—outside Thursday’s web/backend core. |
| frontend-accessibility, gstack-design, interface-design, shadcn-ui, ui-ux-design, vercel-web-design-guidelines, web-compliance | **LEAVE OUT of this package; compose with ui-ux-design**—these are its existing seven skills. |
| impeccable | **LEAVE OUT as a parallel design system**—extract only reviewed, nonduplicated engineering gaps such as localization into their proper owner. |
| taste-skill, theming, tovu-theme-authoring, seo-geo | **LEAVE OUT**—visual/host/publishing specialties. |
| adr-governance, agent-evaluation, constitution-compliance, context-engineering, coordination, enterprise-spec, experimental-validation, external-audit, find-skills, gstack-ios, gstack-release, handoff, improve-codebase-architecture, memory-systems, pattern-priming, roast, superpowers-dispatching-parallel-agents, swarm-consensus, vibe-coding | **LEAVE OUT**—pipeline, agent-platform, council, approval, memory, or duplicate workflow machinery. |
| Nested `skills/expo/skills/`: building-native-ui, eas-update-insights, expo-api-routes, expo-cicd-workflows, expo-deployment, expo-dev-client, expo-module, expo-tailwind-setup, expo-ui-jetpack-compose, expo-ui-swift-ui, native-data-fetching, upgrading-expo, use-dom | **INCLUDE, selectively trimmed, later native pack**—load individual capabilities, never the whole collection. |
| Nested `taste-skill/vendor/`: brandkit, design-taste-frontend, design-taste-frontend-v1, full-output-enforcement, gpt-taste, high-end-visual-design, image-to-code, imagegen-frontend-mobile, imagegen-frontend-web, industrial-brutalist-ui, minimalist-ui, redesign-existing-projects, stitch-design-taste | **LEAVE OUT**—alternate visual workflows. |
| Sensors: code-structure-quality, type-safety, dependency-structure, dependency-drift, duplication, dead-code | **INCLUDE, trimmed**—local checks and repair instructions; no Observer scheduling. |
| mutation-quality, changed-code-coverage, coverage-quality | **INCLUDE, trimmed, conditional on tests**—mutation required when adding tests; coverage diagnostic rather than universally mandatory. |
| change-history, sensor README and its co-change scripts | **LEAVE OUT**—maintenance analytics unnecessary for task completion. |
| Contracts: computational-controls, runtime-validation, architecture-fitness, enforcement | **INCLUDE, merged into command discovery and verification policy**—infer existing commands; preserve declared boundaries without mandatory project contract files. |
| Contract README, specs-as-built-freshness; all spec-provider contracts | **LEAVE OUT**—ADS/provider administration and generated-spec governance. |
| Templates: adr, implementation-outline, critical-internal-constraints, research, system-blueprint, tasks | **INCLUDE, trimmed into optional planning notes**—produce only useful decision/constraint records. |
| known-flaky-tests; self-validation/{generic-web-app,node-api,python-service,supabase}; bootstrap/{contracts-bootstrap,starter-conventions-typescript} | **INCLUDE, trimmed into verification/setup recipes**—remove ADS paths and certification requirements. |
| Other templates: context-offload, evaluator-contract, evaluator-report, governance-adr, handoff, load-bearing-harness-audit, progress-ledger, red-team, tdd-coverage-triage, test-certification, verification-packet; bootstrap/{constitution,playwright-mcp-setup,workspace-gitignore}; all three README files | **LEAVE OUT**—organizational records or environment-specific bootstrap. |
| All 22 files under spec-provider `templates/` | **LEAVE OUT**—Speckit/BMAD/OpenSpec package workflows are not prerequisites. |
| Remaining framework/harness material | **LEAVE OUT**, except trimmed evidence, data-classification, capability-checking, self-validation and anti-thrashing rules—useful single-agent safeguards without registries, hooks, ledgers, or session recording. |

Counts and identities come from the filesystem and [agent roster](/Users/la/Programming/Tovu/AI-Dev-Shop/framework/routing/agent-index.md).

**Gaps**

“Thin” means some guidance exists, but the plugin needs a clearer implementation contract or dependable routing.

| Practice | Current evidence/status | Plugin addition |
|---|---|---|
| React | **Present:** frontend-react-orcbash, Vercel skills | Version-aware, framework-native entrypoint; architecture optional. |
| Next.js | **Thin:** Vercel React performance rules | Server/client boundaries, rendering, actions, cache invalidation, auth. |
| Vue, Angular, Svelte | **Thin:** architecture selector names native idioms | Dedicated implementation guides. |
| Nuxt | **Missing dedicated guide** | SSR, hydration, server routes, runtime config, caching. |
| State | **Present but React-heavy:** frontend implementation patterns, Zustand reference | URL/client/server ownership; persistence and subscription lifecycles. |
| Forms/validation | **Thin:** secure-input-handling, shadcn examples | Schema ownership, client/server parity, async errors, duplicate submissions. |
| Fetching/caching | **Present but uneven:** backend caching, React Query examples | Cancellation, races, invalidation, optimistic rollback, tenant-scoped keys. |
| Auth/session | **Thin cross-stack:** security-review, Supabase | Cookies/CSRF, refresh/logout, SSR isolation, authorization at resource boundaries. |
| Accessibility | **Present:** frontend-accessibility | Compose with design plugin; update baseline and verify actual interactions. |
| Performance budgets | **Present:** performance-engineering/web-performance-targets | Project-specific bundle budgets; distinguish lab checks from field CWV. |
| Dependencies/supply chain | **Present:** dependency-drift, security advanced reference | Unify lockfile, frozen install, audit freshness, install-script and license checks. |
| Secrets | **Present:** security-review, rotation guidance | Client/server exposure checks, redaction, secret scanning. |
| Human-readable, pasteable errors | **Thin:** tool-design recovery messages, backend taxonomy | Universal safe error contract and copyable diagnostic details. |
| Logging/observability | **Present:** observability-implementation | Scale requirements to project; correlation IDs and redaction by default. |
| i18n | **Thin:** impeccable/harden, scattered references | Message extraction, plurals, Intl, RTL, locale routing and fallbacks. |
| Safe DB migrations | **Present:** SQL modeling, change-management, DevOps | Explicit lock/backfill/restore checks and expand-contract sequence. |
| API versioning | **Present:** api-design/versioning-and-lifecycle | Route automatically on public contract changes. |
| Lint/format setup | **Thin:** command slots, starter conventions | Detect and extend existing setup; minimal stack recipes when absent. |
| CI basics | **Present:** devops-delivery | Small reproducible pipeline with existing commands and conditional tests. |
| Deploy/rollback | **Present:** DevOps, rollout thresholds, change-management | Preview, health verification, rollback compatibility. |
| Git hygiene | **Present:** git strategy, worktree/branch skills | Preserve unrelated work; avoid destructive shortcuts. |
| Mobile/touch, scroll fighting | **Present:** UI mobile matrix; native skills | Design plugin owns browser checks; engineering guidance covers listener/scroll-lock cleanup. |
| OWASP security | **Present but uneven:** security-review, secure-input-handling, advanced reference | Task-triggered threat checklist; strengthen web session/browser patterns. |
| Test-ready design + mutation | **Present:** foundations, testable-design-patterns, mutation sensor | Remove mandatory tests while retaining seams; operationalize mutation when tests are added. |

**Quality gates**

The inspected [structure sensor](/Users/la/Programming/Tovu/AI-Dev-Shop/harness-engineering/sensors/code-structure-quality.md) differs from the brief: cognitive review **11–15**, breach **16+**; nesting review **4**, breach **5+**. Cyclomatic is report-only. The registry marks cognitive/nesting gates **unvalidated**.

Proposed plugin policy:

- **Cyclomatic ≤10 and cognitive ≤10** for every new or materially changed logic-bearing function. Unchanged legacy debt is reported separately.
- **Nesting ≤3** as an additional readability gate. Report function size without an arbitrary line-count gate.
- Exclude generated/vendor content and declarative markup; include handlers, callbacks, transformations and embedded business logic.
- Never lower thresholds, widen exclusions, delete assertions, or fragment functions solely to clear measurements.

| Language | Proposed measurement path |
|---|---|
| JS/TS, including JSX/TSX | **Thursday:** isolated ESLint toolchain: `complexity`, SonarJS cognitive complexity, `max-depth`; parser-backed function attribution. |
| Python | Later candidate: lizard cyclomatic + complexipy cognitive. |
| Go | Later candidate: lizard cyclomatic + gocognit cognitive. |
| Rust, Java, C/C++, C# | lizard cyclomatic; validate language-specific cognitive adapters or use an existing Sonar installation. |

Non-JS candidates require upstream verification and conformance fixtures before support is promised. External research was outside this task’s permitted search scope. **Lizard does not measure cognitive complexity.**

“No setup” should mean **no project configuration changes**: provision pinned analyzers in the plugin/host tool cache during installation, reuse available runtimes, and invoke them explicitly. Missing runtime, unavailable downloads, unsupported language or analyzer failure produces **UNVERIFIED**, never PASS. A documentation-only plugin cannot guarantee execution across every CLI; hooks are host-specific.

Before release, validate threshold boundaries at 10/11, nesting, guards, switches, boolean expressions, anonymous/nested functions and TSX. Preserve raw diagnostics, tool versions, scope and exclusions.

On failure, the agent flattens nesting, separates responsibilities, reuses existing owners, then reruns checks and relevant verification. Unresolved breaches remain incomplete.

**Resolve the switch conflict explicitly:** replace ADS’s unconditional exhaustive-switch mandate with **compile-time exhaustive handling**. A typed total handler table is acceptable when it preserves payload typing and readability. Splitting one exhaustive dispatch merely to game cyclomatic counts is unacceptable; genuinely irreconcilable cases require an owner decision.

Tests are optional. Existing relevant tests still run. When tests are added, mutate their covered source with a supported adapter—StrykerJS first, other ecosystems later. Strengthen assertions against meaningful survivors; do not fabricate expected results or conceal unsupported mutation runs.

**Router**

Always load approximately **1,200–1,800 tokens**: router, reuse-before-write, ownership, dependency/effect boundaries, safe errors, testability, verification honesty.

Detect stack per affected workspace using manifests, lockfiles, source extensions and framework configuration. Resolve task location before selecting a monorepo stack; dependencies alone are insufficient.

| Task | Load on demand |
|---|---|
| Feature/change | Core + affected stack; planning only for unclear behavior or meaningful boundary changes. |
| Bug | Debugging + affected subsystem + reproduction/verification. |
| API/worker | Backend + contracts; add security/observability for changed trust or I/O boundaries. |
| Schema/query | Data + detected database; migration safety for persisted changes. |
| Refactor/review | Ownership + structure/type checks + compatibility. |
| Tests | Test design + detected runner + mutation adapter. |
| Release/dependencies | Git/CI/deploy or supply-chain references. |
| UI | Engineering stack guidance plus discovered ui-ux-design capabilities. |

Aim for **4,000–6,000 active tokens**, expanding explicitly for complex work. Load individual references, not whole catalogs.

`ui-ux-design` owns visual direction, accessibility guidance, component states, UI Loop and mobile browser verification. AINSEP owns behavior, state/data flow, contracts and engineering gates. Compose through host discovery—**no sibling imports or copied design files**. Missing design capability is reported without inventing access.

**Plugin shape**

Use **`ainsep-software-engineering`**, published as:

`@jini-ai/agent-plugins/ainsep-software-engineering`

Minimal proposed manifest:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "ainsep-software-engineering",
  "version": "0.1.0",
  "description": "Routes coding tasks to engineering guidance and verification.",
  "extensions": {
    "tovu": {
      "id": "jini/ainsep-software-engineering",
      "displayName": "AINSEP Software Engineering",
      "summary": "Helps write maintainable, secure, test-ready code.",
      "provides": ["software-engineering"]
    }
  },
  "keywords": ["coding", "architecture", "debugging", "security", "quality"]
}
```

```text
ainsep-software-engineering/
  plugin.json
  skills/
    ainsep-software-engineering/SKILL.md
    engineering-core/SKILL.md
    {planning,debugging,backend,data,security,verification,...}/
      SKILL.md
      references/
  tools/                 # gate launcher/adapters
  templates/             # small optional recipes
  provenance.json
  THIRD_PARTY_NOTICES
  __tests__/             # unpublished package checks
```

Estimated v1: **60–90 files, 200–350 KB guidance/content**, excluding analyzer distribution size, which must be measured separately.

Proposed source: `AI-Dev-Shop/integrations/agent-plugins/ainsep-software-engineering/`, containing an explicit source allowlist and portability adaptations. One-way sync into Jini’s matching plugin folder; no reverse edits. Preserve source revisions, transformations and licenses.

Reuse Jini’s existing manifest validation, lifecycle, package registry, exports, runtime-entry metadata and packed isolation. The [package README](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/README.md) already owns those mechanisms. Tovu-specific restrictions belong only in its overlay. Bump plugin semver whenever shipped bytes change; release through the containing package’s established versioning.

**Thursday v1 — November 5, Codex non-UI**

1. Extract core/router and backend, API, database, debugging, security, git/CI and verification references.
2. Remove ADS paths, coordinator dependencies, mandatory testing, specialist approval choreography and duplicate policies.
3. Add safe copyable errors: specific failure, safe context, next action, stable code/correlation ID; never bare “Something went wrong.”
4. Ship the isolated JS/TS gate and fix/rerun loop. Validate metrics, routing, missing-tool outcomes and package isolation.
5. Support JS/TS mutation when tests are added; explicitly identify unsupported mutation stacks.
6. Add provenance/license records, Jini registration and sync checks.
7. Verify installation/invocation on Codex; document other hosts as unverified until exercised.

Later: full React/Next, Vue/Nuxt, Angular/Svelte, native and specialized-app packs; additional language analyzers, mutation adapters and host integrations.

Owner questions:

1. Confirm strict ≤10 for both metrics, or allow narrowly documented exhaustive-dispatch exceptions?
2. Is JS/TS executable enforcement sufficient for Thursday?
3. May installation provision pinned analyzers in a private cache?
4. Which CLI/runtime combinations must be verified at launch?
5. Confirm the proposed ID and `jini/` catalog namespace?
