# TestRunner Handoff — Packaged ChatPane / Open Design parity

- Run time: 2026-07-23T22:12:18-07:00
- Persona: TestRunner
- Result: **PASS for the requested automated verification matrix**
- Convergence: **100%** of in-scope automated tests passed
- Manual exception: the native operating-system folder-dialog click was not repeated; the already-running app and its ports were not disrupted

## Continuation inputs and evidence gap

- Handoff: `ADS-memory/.local-artifacts/handoff/20260724T043442Z-handoff.md`
- Handoff SHA-256: `596a4987d6df5af18add9662a00e3c614dada0ae535cdd5bb5c6f818f60d0643` — exact match
- Locked architecture: `ADS-memory/reports/jini-port/extraction-plan.md`
- Architecture SHA-256: `c1ccae2bb11cfe482bf9b367d17c6f5ef0999b223c5eaf868893f570933cc97d` — exact match
- Coverage profile: coordinator-supplied continuation contract, **100/100/100/100**, reinforced by `ADS-memory/knowledge/project_memory.md`
- Convergence threshold: coordinator-supplied continuation contract, **100% of in-scope tests**

Formal provider spec/tasks/test-certification artifacts were absent because this
was a resumed implementation. Therefore, there was no certification spec hash,
certified per-test-file hash inventory, declared mutation slot, or formally
certified expected count to validate. Per coordinator direction, the exact
handoff hash and current runnable suite inventory were used as the continuation
contract. This is an audit evidence gap, not a test failure.

Codebase Memory MCP was checked first for structural discovery; no Jini project
is indexed. Exact current-worktree reads and `rg` inventory were therefore used
as the documented fallback.

## Test placement gate

Mechanical inventory command:

```sh
test_root='packages/chat-react/src/features/chat-pane'
while IFS= read -r file; do
  case "$file" in
    "$test_root/__tests__"/*) ;;
    *) printf '%s\n' "$file"; exit 1 ;;
  esac
done < <(rg --files "$test_root" | rg '\.(test|spec)\.[^.]+$' | sort)
```

Result: **PASS**. All five feature tests are directly under the root
`packages/chat-react/src/features/chat-pane/__tests__/`; no `.test.*` or
`.spec.*` exists elsewhere in the feature.

- `AgentRuntimePicker.test.tsx`
- `ChatPane.test.tsx`
- `rules.test.ts`
- `useChatPane.test.tsx`
- `useChatPaneWorkingDirectory.test.tsx`

## Suite results

| Command | Result | Exact evidence |
| --- | --- | --- |
| `pnpm --filter @jini/chat-react test:coverage` | PASS | 32 files, 361/361 tests |
| `pnpm --filter @jini/chat-react exec vitest run src/features/chat-pane/__tests__ src/react/components/__tests__/Composer.test.tsx` | PASS | 6 files, 32/32 tests |
| `pnpm --filter @jini/chat-react typecheck` | PASS | exit 0 |
| `pnpm --filter @jini/chat-react build` | PASS | exit 0 |
| `pnpm --filter @jini-app/reference-web test` | PASS | 3 files, 17/17 tests |
| `pnpm --filter @jini-app/reference-web typecheck` | PASS | exit 0 |
| `pnpm --filter @jini-app/reference-web build` | PASS | 3,020 modules transformed; exit 0 |
| `pnpm --filter @jini-app/reference-desktop typecheck` | PASS | exit 0 |
| `pnpm --filter @jini-app/reference-desktop build` | PASS | exit 0 |
| `pnpm --filter @jini/daemon exec vitest run src/__tests__/agent-executor.test.ts` | PASS | 1 file, 138/138 tests |
| `pnpm --filter @jini/daemon typecheck` | PASS | exit 0 |
| `pnpm guard` | PASS | self-test passed; zero violations |
| `git diff --check -- packages/chat-react examples/reference-web examples/reference-desktop packages/daemon` | PASS | exit 0, no output |

Unique test cases in the non-overlapping full suites: **516/516** (361
chat-react + 17 reference-web + 138 daemon). Including the intentional focused
chat-pane/Composer re-execution, this run made **548 passing test invocations**.
No skipped or empty suite was observed.

E2E: **N/A** — no formal E2E requirement/certification was supplied. The
non-disruptive live asset checks below provide runtime static-asset evidence but
are not represented as a full Electron E2E.

Mutation: **N/A — slot not declared**.

## Coverage report

Before execution, the old `packages/chat-react/coverage` directory was moved
recoverably to `/tmp/jini-chat-react-stale-coverage.tE0Kw0/coverage`; the
in-worktree coverage path was confirmed absent before Vitest started.

- Fresh merged artifact: `packages/chat-react/coverage/coverage-summary.json`
- Fresh detailed artifact: `packages/chat-react/coverage/coverage-final.json`
- Summary mtime: `2026-07-24T05:09:24.619Z`
- Parser: Node.js `JSON.parse`
- Coverage scope: `src/**`
- Exclusions: test sources only — `src/**/*.test.ts` and `src/**/*.test.tsx`
- Thresholds in `vitest.config.ts`: statements 100, branches 100, functions 100, lines 100
- Config diff adds only the narrow real-UI-leaf Vitest alias; it does not weaken thresholds or exclude runtime source

| Metric | Covered / total | Result |
| --- | ---: | --- |
| Statements | 2,641 / 2,641 (100%) | PASS |
| Branches | 1,393 / 1,393 (100%) | PASS |
| Functions | 179 / 179 (100%) | PASS |
| Lines | 2,641 / 2,641 (100%) | PASS |

Per-file runtime coverage is 100% throughout the instrumented package,
including `chat-pane/rules.ts`, `chat-pane/react/styles.ts`,
`AgentRuntimePicker.tsx`, `ChatPane.tsx`, `useChatPane.hooks.ts`,
`useChatPaneWorkingDirectory.hooks.ts`, `Composer.tsx`, and `Icon.tsx`.
Interface/type-only modules (`types.ts`, `ports.ts`, `slots.ts`,
`transport.ts`) contain no V8-executable counters and are exempt rather than
being runtime exclusions.

Coverage Gap List: **empty**. No uncovered executable line, branch, function,
or statement remains. No touched-file regression baseline was supplied.

Coverage integrity: **PASS** against the durable project rule. The fresh
configuration instruments all `src/**` executable code, excludes only test
files, retains the exact 100% four-metric gate, and produced detailed V8 JSON.

## Acceptance and architecture evidence

- The public API exposes `workingDirectory`, `initialWorkingDirectory`,
  `onChangeWorkingDirectory`, and the narrow effect-only
  `workingDirectoryAccess`.
- `useChatPaneWorkingDirectory` owns controlled/uncontrolled state, recents,
  validity, cancellation, error normalization, picker calls, recent selection,
  and clear behavior.
- `ChatPane` composes `WorkingDirPicker` and forwards the package-owned working
  directory into run-context creation.
- `examples/reference-web/src/App.tsx` supplies only an initial directory and
  the desktop bridge; it contains no working-directory state machine,
  `workingDirectoryControl`, recents state, invalid state, refresh callback, or
  recent-selection callback.
- The Electron preload/main bridge maps the narrow effects to
  `ShellPort.openFolderDialog`, `recentDirs`, and `dirExists`.

This boundary is correctly package-owned. The API is centered on
`onChangeWorkingDirectory` even though the reference app uses the uncontrolled
`initialWorkingDirectory` form and therefore does not need to persist a
controlled callback.

## Agent icons and Remix font

- Production build contains all **23/23** public agent assets.
- Every built agent asset is byte-identical to its source public asset.
- `dist/remixicon.woff2` exists and is byte-identical to the public font.
- `AgentIcon` maps 23 known ids to the correct SVG/PNG extension, uses CSS masks
  for monochrome marks, and falls back only for unknown brands.
- `AgentRuntimePicker` supplies the `/agent-icons` base path to both selected and
  menu-row icons.
- `remixicon.css` maps the font from the root URL `/remixicon.woff2`.
- Without restarting or touching any port, all **23/23** agent URLs and the font
  were fetched from the already-running `http://127.0.0.1:4173`; every response
  hash matched the source file. Sampled explicit status checks returned HTTP
  200 for Codex, OpenCode, and the font.

## Unrelated pre-existing failure

`pnpm --filter @jini/ui typecheck` was freshly reproduced and is classified
**UNRELATED / PRE-EXISTING**. It fails only in dirty test fakes whose mocked hook
results omit newly required fields:

- `CustomSelect.test.tsx`
- `LanguageMenu.test.tsx`
- `OnboardingDropdown.test.tsx`
- `Toast.test.tsx`

The errors are TS2322 mock-shape mismatches. They do not involve the chat-pane
runtime slice or the narrow Vitest UI entry. No fix was attempted.

## Failure clusters, blockers, and routing

- In-scope implementation failures: none
- Coverage gaps: none
- Flaky tests: none observed
- Infrastructure failures: none
- Audit evidence gap: absent formal spec/tasks/test certification
- Manual residual: native OS folder-dialog interaction was not clicked in this
  TestRunner run
- Worktree risk: repository remains heavily dirty; no reset, checkout, commit,
  push, source edit, or test edit was performed

Suggested next assignee: **Code Reviewer**, with the native Electron folder
dialog left as a concise human acceptance check if the coordinator requires
full live sign-off.
