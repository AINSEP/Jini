Software Architect(Direct): I loaded `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/software-architect/skills.md`. This is a read-only plan; no files changed, tests ran, or services started.

**1. Goal**

Ship one small, portable `@jini-ai/agent-plugins/ainsep-software-engineering` plugin that routes coding tasks to selected AI-Dev-Shop engineering guidance.

**2. Findings**

- Both clones are on `merge-1029`. The clone’s todos file is older; I read the complete current item 10 in [the owner checkout](/Users/la/Programming/Tovu/development/todos.md:42), including complexity gates, optional tests, test-ready design, and mutation testing.
- The UI plugin already establishes the pattern: canonical skills in AI-Dev-Shop, copied into a self-contained Jini plugin, with host-specific rules outside that payload. Its [sync instructions record the upstream revision and portability adaptations](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/ui-ux-design/README.md:34). An automated UI sync command is **UNVERIFIED**; this plan assumes an explicit one-way copy.
- Jini already owns subpath registration, packaging, installation, activation, and isolation. Adding a plugin requires its payload, [registry row](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/lib/agent-plugin-packages.ts:70), and package metadata. No new plugin runtime is needed.
- Tovu already selects package subpaths through [its bundled catalog](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/bundled-catalog.ts:40). Its [overlay formatter covers both tool and pinned-reference delivery](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/host-plugin-guidance.ts:17).
- Both repositories already have `complexity:strict` commands gating cognitive and cyclomatic complexity at 10; see [Jini](/Users/la/Programming/tovu-integration-clones/prov2-jini/package.json:25) and [Tovu](/Users/la/Programming/tovu-integration-clones/prov2-tovu/package.json:110). AI-Dev-Shop’s source policy differs: its cognitive breach starts at 16 and nesting at 5. Adapt this deliberately rather than copying conflicting rules. [Source policy](/Users/la/Programming/Tovu/AI-Dev-Shop/harness-engineering/sensors/code-structure-quality.md:304)
- Important cost: every supporting-file request inventories the skill and **reads all supporting files**, then reads the requested file. Progressive disclosure limits delivered text, but does not avoid those disk reads. [Reader](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/src/lifecycle/skill-file-reader.ts:112)
- Automatic complexity/mutation execution across arbitrary hosts is **UNVERIFIED**. Jini’s mutation command declaration remains a placeholder. A guidance plugin cannot guarantee execution where the host supplies no checker. [Declaration](/Users/la/Programming/tovu-integration-clones/prov2-jini/ADS-memory/governance/contracts/computational-controls.md:32)

**3. Ordered plan**

Paths below use `A = AI-Dev-Shop`, `J = prov2-jini`, and `T = prov2-tovu`. Line estimates are additions/deletions; copied guidance is counted separately.

1. **Create the canonical portable skill in `A/skills/ainsep-software-engineering/`.**  
   Add `SKILL.md` and four references: `planning.md`, `implementation.md`, `debugging.md`, `verification.md`. Approximately **+280–360 / −0 lines**.
   Derive the content from Software Architect, Programmer, Code Inspection, and their existing foundations; Programmer already names the relevant shared skills. [Wiring](/Users/la/Programming/Tovu/AI-Dev-Shop/agents/programmer/skills.md:8)
   Put reuse, dependency injection, testability, useful errors, resource bounds, and host permissions in the entry skill. Route feature/refactor work to implementation, architecture work to planning, bugs to debugging, and completion/testing work to verification.
   Remove pipeline prerequisites, persona switching, required ADS folders, and mandatory report choreography. Reserve future framework-specific references by convention; create none now.
   **Tests:** reference resolution, self-contained content, payload-size limits, and five fixed-request routing evaluations.

2. **Define the quality policy inside `verification.md`; reuse host checkers.**  
   Approximately **+60–90 / −0 lines**, included in the source tree above.
   Require cognitive and cyclomatic **≤10**, or **≤9 for `apps/desktop`**, preserving stricter repository rules. Recommend nesting **≤3**.
   Allow a narrow cyclomatic exception for a proven exhaustive switch whose arms only delegate; retain the raw measurement and exhaustiveness evidence. Ordinary branching remains gated. Do not enable a blanket switch exemption.
   Feature tests remain optional; existing required checks still apply. Bug fixes begin with a failing regression test. New tests trigger scoped mutation testing of their covered implementation.
   Missing checkers produce a specific **UNVERIFIED** result naming the missing capability; the agent handles permitted setup, and never claims PASS or refuses application boot.
   **Tests/evaluations:** 10/11 and desktop 9/10 boundaries, nesting, exhaustive versus non-exhaustive switches, missing tools, and optional-test behavior.

3. **Package and sync into Jini.**  
   Create `J/packages/agent-plugins/ainsep-software-engineering/` with `plugin.json`, the copied skill tree, README, provenance, and applicable LICENSE/NOTICE.
   Use one eponymous skill, `provides: ["software-engineering"]`, and no MCP server, hooks, executable analyzer, or sibling-plugin imports.
   Update `J/packages/agent-plugins/package.json`: bare/wildcard exports, runtime-entry metadata, and `files`; add the registry row.
   Approximately **+60–100 authored lines**, plus **the copied source tree; −0**.
   Record the upstream revision and copied-file hashes; future changes flow AI-Dev-Shop → Jini. No generic sync framework.
   **Tests:** add `ainsep-software-engineering/__tests__/bundled-package.test.mjs` (**+70–110 lines**). Reuse the existing [table-driven packed installation tests](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/__tests__/standalone-agent-plugin.integration.test.ts:67) for resolution, readable skills, isolation, and preserved disablement.

4. **Add Tovu wiring and overlay.**  
   Add the subpath to `T/apps/website/src/features/agent-plugins/bundled-catalog.ts`; update the [selection test’s expected IDs](/Users/la/Programming/tovu-integration-clones/prov2-tovu/development/scripts/__tests__/bundled-agent-plugin-selection.test.ts:23).
   Add `T/content/agent-plugin-overlays/ainsep-software-engineering/GUIDANCE.md`: discover and use site/theme tools first; no shell/installers from chat; checkout commands apply only in an authorized coding environment.
   Bundle it disabled initially, using existing enablement and consent.
   Approximately **+25–40 / −0 production lines**, **+40–70 test lines**.
   **Tests:** actual delivered guidance through tool and pinned-reference paths, permissions, disabled-plugin behavior, and staging.

5. **Release Jini before updating Tovu’s dependency.**  
   Bump the containing package through its existing release process, then update Tovu’s dependency/lockfile and run the focused checks above during implementation.
   Approximately **+5–15 / −5–15 metadata lines**, plus generated lockfile changes.
   No database schema or new public function is needed. Existing injected lifecycle ports and two-object contracts remain the integration boundary.

**4. Cost**

Proposed budgets: entry skill ≤4 KiB; four references ≤5 KiB each; overlay ≤2 KiB; complete plugin payload `P` ≤40 KiB. These are targets, not measurements.

| Added operation | Frequency × payload |
|---|---|
| Source sync | Each content release × ≤24 KiB read + ≤24 KiB copied |
| Product asset staging | Each build × approximately `P` read + `P` written |
| Workspace seeding | Each seed/boot × O(`P`) packing/verification; each new digest × O(`P`) installation writes plus existing activation/digest records |
| Guidance reads | Each request × ≤20 KiB reference inventory + ≤5 KiB selected text + ≤2 KiB overlay; three requests ≤81 KiB, excluding metadata |
| Model context | Entry + two references + repeated overlay: approximately ≤20 KiB per ordinary task |
| Quality checks | Each verification pass × changed-source bytes `D`; repeat only after relevant edits |
| Mutation | Only when tests are added × `m` mutant runs × test work; temporary writes scale with mutated source and runner workspace |
| Polls/background work | **0 × 0**; no timer, watcher, daemon, or periodic rescan added |

Exact lifecycle pass counts and mutation-runner workspace sizes remain **UNVERIFIED**. Preserve the existing lifecycle rather than adding caching to this feature.

**5. Exclusions and CUT-CANDIDATES**

- No React/Vue/Angular specialization, all-skills catalog, multi-agent coordinator, new UI, schema migration, or provider SDK.
- No copied UI-design content or plugin-to-plugin imports; discover other capabilities through the host.
- **CUT-CANDIDATE:** automatic analyzer downloads, private tool caches, and universal mutation adapters.
- **CUT-CANDIDATE:** executable router, host hooks, new enforcement service, and generalized sync tooling.
- Guidance requires verification, but universal runtime enforcement remains outside this first version.

**6. Effort and dependencies**

**12–18 hours of Codex work:** source/routing 4–6h; quality policy/evaluations 2–3h; packaging/sync/tests 3–4h; Tovu wiring/release validation 3–5h.

Dependencies: canonical content → Jini payload and checks → Jini release → Tovu dependency and delivery checks. Publishing availability can add waiting time.

**7. Owner questions**

Should every user receive this guidance automatically? **Recommendation: ship it available but initially off**, using the existing enablement flow. This avoids silently changing how existing agents program; it does not block the plan.