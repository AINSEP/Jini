# `@jini-ai/agent-plugins/software-engineering`

One portable plugin, displayed as **Software Engineering** through host metadata.
Resolve this subpath and stage only its directory through the existing agent-plugin lifecycle.
It has one small entry router and six on-demand references: implementation, architecture,
debugging, verification/code review, security, and prototyping. It installs no checker, MCP server,
hook, analyzer, dependency, watcher or background task. Host activation and permissions apply.
The inner content version is 0.2.1; the containing npm package version follows the release process.

## Repeatable update

From the Jini root, use an upstream checkout containing the desired commit:

```sh
git -C /path/to/AI-Dev-Shop fetch origin <sha>
node scripts/sync-software-engineering.mjs /path/to/AI-Dev-Shop <40-character-sha>
```

The script reads Git objects at that exact SHA, not working-tree files. It selects named sections,
applies explicit portable adaptations, validates each reference's size and rejects upstream-specific
wording before writing. Review the diff when headings or budgets change; never skip those checks.
The local router and adaptation paragraphs remain maintained here. No upstream code is executed.
Increment plugin.json's inner version when content changes, regenerate the existing plugin catalog,
run the checks below, rebuild Jini and relink/stage the selected payload in the host. Keep any host-owned staging mirror synchronized with the complete skill tree and its equality test.

```sh
node --test packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs
pnpm --filter @jini-ai/agent-plugins typecheck
pnpm --filter @jini-ai/plugin-catalog generate
pnpm guard:plugins
pnpm guard:plugins:packed
```

## Selection and adaptations

Selected foundations and implementation guardrails; architecture defaults and boundary principles;
root-cause investigation and hypothesis testing; behavior-level assertions; requirement, architecture
and resource review; resource-level authorization, secret handling and secure input handling; and
focused exploratory prototyping. These cover the useful engineering responsibilities of Programmer,
Software Architect, TDD, Code Inspection and Security without shipping their pipeline personas.

Left out coordinator startup, approval/report hierarchies, spec certification, peer orchestration,
analyzer installation, backend-specific integrations, deployment automation, mobile guidance and
visual design assets. They require separate host capabilities or are outside web app engineering.
UI work discovers the host's design/accessibility capability. No sibling plugin is imported.
No project names, source revisions or session provenance are included in delivered skill text.
Host-only rules live in overlays. Existing tests, supported behavior and honest verification remain
required; adding feature tests is determined by the task and repository, not a mandatory pipeline.

LICENSE retains this payload's existing Apache-2.0 terms. NOTICE retains author attribution and
identifies the adaptation. The selected upstream snapshot has no root LICENSE or NOTICE; this
README does not claim that upstream supplied an Apache license declaration.

## Size and state cost

Entry ≤4 KiB; each reference ≤5 KiB; published payload including legal files ≤40 KiB.
One selected payload is staged per build; install cost is O(payload) per new digest. Guidance reads
load only the requested reference through the existing trusted reader. No persistent state, timer,
cache, poll, migration, endpoint or runtime I/O path is added.

## Upstream revision

AI-Dev-Shop commit: `f02b883bbf51d043c3589eba093d78745600e13b`.

### Selected source files (SHA-256)

| Path | Hash |
| --- | --- |
| `skills/architecture-decisions/SKILL.md` | `84d5068554139caa860cd9349f4e1de26714e2326ed07e5f9b1333ab014ba56d` |
| `skills/code-inspection/SKILL.md` | `96d10fbf3eb12fbe1bb593f2dd88318bef2a5fd3fc4faac76fa7431f227b8b5f` |
| `skills/coding-foundations/SKILL.md` | `f2baeec706d33c25c93b178d14c90c49a7be8db0bcce046275696818258600a1` |
| `skills/implementation-guardrails/SKILL.md` | `c86231496d9d3366fda8942b8dabf535c0fcd5c1a41ecce18af0476dcbe5d6bc` |
| `skills/secure-input-handling/SKILL.md` | `cbacd5dbd92059a51821a78e9f19fbca8a1f88597c96c85e8172ec6685bb1134` |
| `skills/security-review/SKILL.md` | `4bbc8625ff1a081a59755b2158caffc6dbbd30435848beb59ee6c5207a471a65` |
| `skills/systematic-debugging/SKILL.md` | `c12f128cf423c86e0777d22433896d542ebf01c80e3c1456ba9ba45d993274ee` |
| `skills/test-design/SKILL.md` | `793f2899f79fe147daea4fa62215e7d665a8a2c73ea689c99bb617e559fa7627` |
| `skills/vibe-coding/SKILL.md` | `234b040f9c381307eb809e8783f9168d5093213c3b3711f9b6b408d40cfaccf1` |

## Skill hashes (SHA-256)

| Path | Hash |
| --- | --- |
| `skills/software-engineering/SKILL.md` | `c2d1080438d23bcad9559fc684506f6c277b54ab23fb12b00f11c2c6a328fa2e` |
| `skills/software-engineering/references/implementation.md` | `51399d0d3086da41ea7c7b6fe2bd5216752ecd7ba3c42edf2e760b8bfabb2dff` |
| `skills/software-engineering/references/planning.md` | `ce4b8a4e4c1ccdb59fa96e22429354664b32e9deb5fd40316d0fb7c7dbced3a1` |
| `skills/software-engineering/references/debugging.md` | `8ba84994837106d02ecf6e28926bccb044ecfa61fed551def04c0ab172031085` |
| `skills/software-engineering/references/verification.md` | `8ac6b41e7203fa6a16e0e4a0d980ed530418e9e0da6426502dc798dcf9fce1b6` |
| `skills/software-engineering/references/security.md` | `ad501b2e130b7b1c64f75b790b48f59af6b32751a8e7d3d51ad5268b3815126e` |
| `skills/software-engineering/references/prototyping.md` | `ac802999f8e66c7b857e53055b04e16c2c36dc7f405e730d640210af0b7f011e` |
