# why-jini (cloud run 2026-11-18)

Branch `fix/why-comments-jini` (Jini), based on `origin/refactor/terra` 4c189236. Task: put back the "why" comments
the refactors dropped (input: `origin/ci/why-comment-gate:cloud-results/why-comments-baseline.txt`, 55 blocks over
02edbb68..65d73b0d).

## Result
`node scripts/check-why-comments.mjs --base 02edbb68 --head HEAD`: 61 lost blocks at the start (the base moved since the
baseline, +6 new ones), 30 distinct ids left after restoring, all 30 allow-listed (48 blocks, because one pointer comment
repeats in 20 route tests). Final output: `48 comment blocks lost (48 allow-listed)` / `why-comments: ok`, exit 0.

## Restored (comment-only commits, one package each)
- core 901d14c8: byte-size 1024-based/decimal comment (function doc + test) that moved from admin/media; the
  same-origin env-injection explanation on `createLocalSameOriginPolicy`; the "guard reads the policy's own env" test
  comment; "category of outcome a provider probe can report" on `ConnectionTestKind`.
- agent-runtime 80a01f70: pi-rpc "Outbound: send new_session then prompt" header.
- daemon 90e2f133: codex `codexDisablePlugins` "explicit host/run policy" wording.
- server 0b576a05: node-pty test "no real subprocess or filesystem by default" convention; terminal-service spy comment.
- ui 1adff7d2: memory config hydrate comment (verbatim), connectors save/scan re-entrancy and "OAuth poll deliberately
  not effects" notes, preview-modal outside-click comment, fakeUiKit "minimal in-memory kit".

## Allow-listed with a reason (`scripts/why-comments-debt.json`, 30 ids)
The code or the claim is gone or false now: same-origin-gate fixture deleted (injected origin policy port), the legacy AG-UI
wire reducer and its isError "gap" (now carried), session-manager options removed, `registerToolCatalogRoutes` replaced
by `toolCatalogRoutes`, deleted `providers/types.ts` and re-export shells, the `createFrontendControl` forwarder, the
version-manager "cannot split cleanly" claim (it was split), decorative dividers, `invocation.ts` provenance. Each entry
carries a one-line reason.

## Gates
- `node scripts/check-why-comments.mjs --base 02edbb68 --head HEAD`: exit 0 (above).
- `node --test scripts/__tests__/check-why-comments.test.mjs`: 22 pass, 0 fail.
- Not run: `pnpm install`/`pnpm -r build`, typecheck, package tests. Every code-side change is a comment, so no
  executable line changed; the gate only needs git and node. Run `pnpm check:size`/lint in CI.

## Left / next
Nothing from the baseline is unresolved. Reviewer: skim the 30 reasons in the debt file; any you disagree with should be
turned into a restored comment. Overlap: touches comments only in the listed files.
