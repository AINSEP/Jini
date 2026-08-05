# REF-002: Tovu-specific MCP timeout policy debrand — proposal

**Status:** PROPOSE ONLY — no engine source modified.
**Author:** Refactor agent, 2026-08-05.
**Mechanical gate:** case-insensitive grep for `tovu` across Jini's engine packages (`packages/**`, excluding `dist/`, `node_modules/`, and the untracked `packages/vibecoding/` work another live session owns — not touched, not read for content beyond directory listing).

## Bottom line up front

**Recommendation: do not pursue REF-002 as scoped.** The grep found **10 hits, 0 genuine policy leaks**. None of the 10 have anything to do with MCP timeout policy. Separately, I inspected the actual MCP delegated-tool timeout mechanism directly (`packages/mcp/src/server/tools/delegated-tool.ts`, `packages/mcp/src/bin/serve.ts`) since that's REF-002's stated subject — it is **already** host-parameterized correctly (generic default + injected option + env var override, no branding anywhere), and the grep confirms **zero** `tovu` hits anywhere under `packages/mcp/`. The premise "Tovu-specific MCP timeout policy currently lives in Jini engine code" does not hold up against the code as it exists today. This is a negative result — REF-002 has no target at its current size.

## 1. Every hit, file:line

| # | File | Line | Ships to npm? |
|---|------|------|----------------|
| 1 | `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` | 1922 | Yes (`dist/` copied, `files: ["dist"]`) |
| 2 | `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` | 2429 | Yes |
| 3 | `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` | 2643 | Yes |
| 4 | `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` | 3760 | Yes |
| 5 | `packages/ui/src/features/settings/dialog/styles/settings-dialog.css` | 3905 | Yes |
| 6 | `packages/chat/src/react/styles/reference.css` | 131 | Yes |
| 7 | `packages/daemon/src/remote-tool-bridge.ts` | 11 | Yes (comment, not stripped by tsc) |
| 8 | `packages/daemon/src/agent-executor.ts` | 602 | Yes |
| 9 | `packages/http-kit/src/remote-run-events.ts` | 11 | Yes |
| 10 | `packages/daemon/src/__tests__/agent-executor.test.ts` | 5110 | **No** — `daemon/package.json` `files` explicitly excludes `!dist/**/__tests__/**` and `!dist/**/*.test.js` from the npm tarball |

(`dist/` mirror files — e.g. `packages/daemon/dist/agent-executor.js`, `packages/ui/dist/.../settings-dialog.css` — were excluded from this table as build output of the above; they were checked and confirmed to carry the same text, which is *how* I confirmed rows 1–9 actually ship, not separate leaks to fix independently.)

## 2. Triage: genuine leak vs. incidental

**All 10 are incidental. Zero genuine policy leaks.**

- **Rows 1–5, `settings-dialog.css` (comment prose):** Each is a CSS comment explaining *why* a selector is scoped the way it is — e.g. row 1: `"...they'd otherwise leak onto every unrelated <button> in the Tovu admin."`; row 3: `"...matches OD exactly; Tovu's single "All" tab hits this)."`. These describe the porting rationale (this component was ported from a separate "OD" design system into Tovu's admin) for future maintainers. No selector, class name, or value is conditioned on a host identifier — the CSS behaves identically regardless of which host mounts it. Comment prose, per the triage categories given in the brief.
- **Row 6, `reference.css` (comment prose):** Cites `tovu-learnings.md §7`, a repo-root documentation file, by name. Prose citation, not policy.
- **Rows 7–9, `daemon`/`http-kit` (comment prose):** All three cite `tovu-learnings.md §1a` or `§9` as the source of an investigation trail that justified an architectural decision (co-location requirement, env-var forwarding for `claude` CLI auth). The decision itself (documented in the surrounding, non-Tovu-named prose) is host-neutral; only the citation names the doc file.
- **Row 10, test description string:** Same doc citation, inside a test's `it(...)` description. Test fixture / description text, not executable policy.

None of the 10 branch on a Tovu identifier, hardcode a Tovu-specific value, or reference a Tovu URL/hostname/config key in code that executes. All fail the "genuine leak" bar because there is nothing to inject or override — they're just words in comments and one test title.

**Directly relevant negative check:** `packages/mcp/` — the package that actually implements MCP tooling and the delegated-tool timeout REF-002 names — returns **zero** `tovu` hits of any kind (verified: `grep -rniI tovu packages/mcp/` → exit 1, no matches).

## 3. Proposed owning side / mechanism per genuine leak

**N/A — no genuine leaks found.** There is nothing to move from engine to host config.

For completeness, since REF-002's stated subject is MCP timeout policy specifically, I inspected how that mechanism is actually built today (not because the grep pointed there — it didn't — but because the backlog item names it directly):

- `packages/mcp/src/server/tools/delegated-tool.ts:63` — `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS = 6 * 60 * 1000` (6 min), with a comment at line 51 reading: *"A host whose exchange ceiling differs should override it via `delegatedToolTimeoutMs` rather than [hardcoding one]."* The option is consumed at line 92–96 as `options.delegatedToolTimeoutMs ?? DEFAULT_DELEGATED_TOOL_TIMEOUT_MS`.
- `packages/mcp/src/bin/serve.ts:77` — exposes `DELEGATED_TOOL_TIMEOUT_ENV_VAR = 'JINI_DELEGATED_TOOL_TIMEOUT_MS'` (generic `JINI_` prefix, not `TOVU_`), read at lines 145–146 and threaded into the same option.
- `packages/mcp/src/server/daemon-client.ts:32` — separate, unrelated `DEFAULT_TIMEOUT_MS = 15_000` for the daemon HTTP client, also overridable via `options.timeoutMs`.

This is already exactly the shape a debrand fix would propose (generic default + injected option + env var override, host-neutral naming). There's no Tovu-specific value or branch anywhere in this code path today. If a Tovu-side override exists, it lives in Tovu's own config (outside Jini's engine packages, out of this grep's scope) and is out of REF-002's stated boundary ("policy currently lives in Jini engine code").

## 4. Blast radius

Since there is no genuine leak, there is no functional consumer to break by "fixing" anything — a code change here would be purely cosmetic (renaming a doc citation in comments) and carries the same blast radius as any comment edit: zero, since nothing reads comment text at runtime. The one thing worth flagging for awareness, not action:

- Rows 1–9 do ship into the published npm tarballs for `@jini-ai/ui`, `@jini-ai/chat`, `@jini-ai/daemon`, and `@jini-ai/http-kit` (confirmed against each package's `files` field and by diffing `dist/` copies). An external consumer inspecting those packages' shipped source/CSS would see the string "Tovu" in comments. This is a minor, low-stakes brand-visibility detail, not a policy leak — no behavior, config, or API surface differs by host. Row 10 does not ship (test files are excluded from all four packages' `files` fields).
- Tovu is very likely the only host affected in the sense that these comments were written *about* Tovu (the design-system-port rationale in `settings-dialog.css` explicitly discusses adapting a component for "the Tovu admin"). No other host is named anywhere in the 10 hits.

## 5. Recommendation

**Do not do REF-002 as currently scoped — it has no genuine target.** Two options if the backlog item is kept open at all:

1. **Close it as a non-issue.** The MCP timeout mechanism is already correctly host-agnostic (verified above); the "policy leak" premise doesn't match current code. Recommended.
2. **Downgrade to a trivial, optional cosmetic cleanup** (if brand-neutrality in comments matters independent of any functional leak): rename the doc citations from `tovu-learnings.md` to a host-neutral phrasing (e.g. "this repo's own learnings doc") in the 6 comment/test-string hits (rows 6–10, plus row 7 already says "this repo's own", so really 4 remaining: rows 6, 8, 9, 10), and reconsider whether the 5 `settings-dialog.css` comments (rows 1–5) should keep naming "Tovu" explicitly since they're actively documenting a Tovu-specific port decision for future maintainers of *that exact component* — renaming those would remove useful, true information for no engine-boundary benefit. I'd advise against spending a Refactor/Programmer cycle on option 2 given the size (a handful of comment words) relative to the mechanical gate's original framing as a real host/engine boundary violation.

I did not modify any engine source for this task, per the propose-only constraint.
