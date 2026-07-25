# Self-Validation: Packaged Chat Pane

- Date: 2026-07-23 22:06 PDT
- Persona: Programmer (Execution)
- Result: PARTIAL — automated and browser-injected paths pass; the native
  Electron folder dialog was not clicked
- Validation attempts: two focused cycles, followed by one final package build
  and guard cycle

## Scope

Validated the product-neutral `@jini/chat-react` chat-pane composition, its
package-owned runtime and working-directory orchestration, attachment upload
and request decoding in the reference host, and forwarding into daemon runtime
adapters.

The user-required working-directory boundary is:

`workingDirectory` / `initialWorkingDirectory`
→ `onChangeWorkingDirectory`
→ optional `ChatPaneWorkingDirectoryAccess` filesystem effects.

The reference `App.tsx` no longer owns the picker state machine.

## Preflight evidence

- Handoff SHA-256:
  `596a4987d6df5af18add9662a00e3c614dada0ae535cdd5bb5c6f818f60d0643`
- `START-HERE.md` SHA-256:
  `5aa0e0eb41f6b1ae1e32b1cff51524434582f653ecd6de66629d0d70c89db5a3`
- `extraction-plan.md` SHA-256:
  `c1ccae2bb11cfe482bf9b367d17c6f5ef0999b223c5eaf868893f570933cc97d`
- Exact reference icon, font, picker, and runtime-menu sources were inspected
  in the real upstream clone, not the frozen integration snapshot.
- The coordinator confirmed that no Jini codebase-memory project was available,
  so focused source reads were used after the graph-first exception.

## Automated verification

| Check | Result |
| --- | --- |
| `pnpm --filter @jini/chat-react test:coverage` | PASS, 32 files / 361 tests; 100% statements, branches, functions, and lines; no uncovered lines |
| Focused chat-pane + Composer tests | PASS, 6 files / 32 tests |
| Chat-pane test placement audit | PASS; all five feature test files are directly under `features/chat-pane/__tests__/` |
| `pnpm --filter @jini/chat-react build` | PASS |
| `pnpm --filter @jini-app/reference-web test` | PASS, 3 files / 17 tests |
| `pnpm --filter @jini-app/reference-web typecheck` | PASS |
| `pnpm --filter @jini-app/reference-web build` | PASS, 3,020 modules |
| Static asset build audit | PASS; all 23 agent assets plus `remixicon.woff2` are in `dist/` |
| `pnpm --filter @jini-app/reference-desktop typecheck` | PASS |
| `pnpm --filter @jini-app/reference-desktop build` | PASS |
| Focused daemon `agent-executor.test.ts` | PASS, 138/138 tests |
| `pnpm --filter @jini/daemon typecheck` | PASS |
| `pnpm guard` | PASS, zero violations |
| Scoped `git diff --check` | PASS |

`@jini/ui`'s broad package typecheck remains red in pre-existing dirty tests
whose injected hook fakes omit newly required return fields. The failures are
outside this slice and do not involve the added narrow Vitest entry. The
chat-react build, reference builds, and repository guard all pass.

## Security and forwarding evidence

- Upload bodies are streamed with a hard byte cap.
- Display names are reduced to a basename and allowlisted characters.
- The upload endpoint generates the stored path; decoded attachment paths
  outside the upload root are dropped.
- Malformed attachments are dropped and the returned list is capped at ten.
- Empty prompts and unknown sample projects fail closed.
- The selected working directory is resolved and verified as a directory.
- Reference tests cover image/file classification, encoded filenames, daemon
  error messages, malformed error bodies, omitted attachment records, request
  decoding, path escape attempts, body overflow, and working-directory
  resolution.
- Daemon tests assert model/reasoning/image/allowed-directory forwarding to
  argv runtimes, image forwarding to ACP, and image/upload-root forwarding to
  pi-rpc.

Residual local threat: the lexical upload-root check assumes the daemon-owned
UUID upload files are not replaced by another local process with filesystem
access. The upload route uses exclusive creation and does not accept a
client-selected stored path.

## Runtime evidence

The coordinator exercised the built reference UI with a fake preload capability
to isolate package ownership:

- runtime dialog rendered at 320 px with Local CLI/API rows, installed agents,
  model/reasoning selectors, and real agent assets;
- selected working-directory basename rendered in the package-owned trigger;
- the upward folder menu rendered Change folder, Recent, and Clear;
- selecting a folder updated the package-owned state;
- `/remixicon.woff2` and representative Codex, Antigravity, Claude, and
  OpenCode assets returned HTTP 200.

Screenshot:
`ADS-memory/.local-artifacts/jini-chat-pane-live-20260723.png`.

This proves the browser composition and preload contract, but not the operating
system's native Electron folder dialog. That remaining manual action is why
this report is PARTIAL rather than claiming full live Electron validation.

## Architecture audit

PASS:

- `ChatPane` and `useChatPaneWorkingDirectory` own orchestration and UI state.
- `App.tsx` supplies effects and receives changes; it does not assemble recent,
  validity, picker, or cancellation state.
- `packages/*` remain Electron-free and product-neutral.
- Package imports use bare `@jini/ui`, satisfying R2.
- Reference-only assets and upload routing remain in the example host.
- The selected package-owned directory is included in the functional run
  context that reaches the daemon.

WARNING:

- The repository was already broadly dirty. This slice preserved unrelated
  changes and performed no reset, commit, or push.
- A test-only UI barrel is used by chat-react Vitest so Node does not evaluate
  the unrelated browser-only sketch editor from the public UI barrel.

## Function quality assessment

| Unit | Score | Rationale |
| --- | ---: | --- |
| `useChatPaneWorkingDirectory` | 100/100 | One state/effect boundary, typed options/result, cancellation and capability errors directly tested |
| `normalizeWorkingDirectoryError` | 100/100 | Pure O(1) normalization with both Error and opaque rejection coverage |
| `decodePlaygroundRunRequest` | 100/100 | Bounded O(n), validates required fields, normalizes optional fields, and fails closed on escaped paths |
| `sanitizePlaygroundAttachmentName` | 100/100 | Pure O(n) basename/allowlist transform with traversal and control-character tests |
| `readBoundedAttachmentBody` | 100/100 | Streaming O(n) read with an enforced resource cap and boundary test |
| `resolvePlaygroundWorkingDirectory` | 100/100 | One filesystem metadata read; relative, absolute, default, and non-directory cases tested |
| `promptWithPlaygroundAttachments` | 100/100 | Deterministic bounded manifest composition with empty and populated cases |
| `AgentRuntimePicker` / position helpers | 100/100 | Viewport-bounded geometry and interaction branches directly covered |
| `ChatPane` / `Composer` | 100/100 | Props remain effect-oriented; upload, selection, errors, cancellation, and submission are behaviorally covered |

Skepticism pass: rechecked ownership, hidden dependencies, cancellation,
controlled/uncontrolled behavior, runtime propagation, error surfaces, resource
caps, path containment, asset resolution, test placement, and the native-dialog
gap. No additional in-scope code finding remained.
