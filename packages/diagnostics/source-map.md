# `@jini/diagnostics` — provenance

Origin: `leonaburime-ucla/open-design`'s `packages/diagnostics` on `main`
(cloned fresh to `/tmp/od-source`; 7 files, ~608 LOC across `src/`). Per
`ADS-memory/reports/jini-port/recon/r2-packages.md` §12: "diagnostics-bundle tooling: HTTP
endpoint constants, JSON/text redaction, sources, manifest, zip builder,
agent-logs. OD coupling is low (one `DIAGNOSTICS_FILENAME_PREFIX =
"open-design-diagnostics"` constant + daemon-endpoint comments)... rename the
prefix."

**⚠️ Not yet in extraction-plan.md's locked §3 package set.** This is a
genuinely new standalone package this porting session created — same
situation `@jini/deploy` was in when it landed (see extraction-plan.md's
"Not yet locked — pending Coordinator/Software-Architect sign-off" section).
It needs Coordinator/Software-Architect sign-off before being folded into
the locked list. Do not treat it as already-locked.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/contract.ts` | `packages/diagnostics/src/contract.ts` | `DIAGNOSTICS_EXPORT_PATH`/`DIAGNOSTICS_CONTENT_TYPE` verbatim. **Identity-stripped:** `DIAGNOSTICS_FILENAME_PREFIX = "open-design-diagnostics"` → `"jini-diagnostics"`. |
| `src/redaction.ts` | `packages/diagnostics/src/redaction.ts` | Verbatim — zero OD coupling in this file (secret-pattern regexes, JSON/text redaction, username-path scrubbing; all generic). |
| `src/sources.ts` | `packages/diagnostics/src/sources.ts` | Verbatim — log-source collection (whole-file or tail-bounded reads) and macOS crash-report discovery; zero OD coupling. |
| `src/manifest.ts` | `packages/diagnostics/src/manifest.ts` | Verbatim — manifest/machine-info builders and the diagnostics filename formatter; zero OD coupling (takes an arbitrary `prefix` string, doesn't reference the contract constant itself). |
| `src/zip.ts` | `packages/diagnostics/src/zip.ts` | Verbatim — orchestrates sources+manifest+machine-info into a `JSZip` archive; zero OD coupling. |
| `src/agent-logs.ts` | `packages/diagnostics/src/agent-logs.ts` | See "Design decision" below — logic verbatim, **identity-stripped** two comment mentions of "Open Design"/`OD_DATA_DIR` (reworded to "a host daemon"/"a host application's data dir", no behavior change — these were prose only, not env var names actually read by the code). |
| `src/index.ts` | `packages/diagnostics/src/index.ts` | Barrel, re-export set unchanged. |

## Design decision: `agent-logs.ts` carries real agent-CLI vocabulary, ported anyway

`r2-packages.md`'s coupling grade for this package ("LOW... daemon-endpoint
comments") was assessed at the whole-package level. Read in isolation,
`agent-logs.ts` carries more domain content than the other six files: it
hardcodes knowledge of four specific coding-agent CLIs — Claude Code, Codex,
OpenCode, and an "AMR"-style OpenCode runtime — including their default
config-home directory names (`.claude`, `.codex`, `opencode`) and env-var
override names (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_TEST_HOME`,
`XDG_DATA_HOME`). "AMR" itself is OD's own internal name for an agent
orchestration layer, not a generic term.

This was ported anyway, deliberately, not dropped or trimmed, for three
reasons: (1) the task brief explicitly lists `agent-logs` as one of the
seven modules that make up "diagnostics-bundle tooling" and does not flag it
for exclusion the way Target 2's task brief explicitly excluded
`project-storage.ts`; (2) every one of these CLI integrations is optional
and caller-parameterized (`homeDir`/`claudeConfigDir`/`codexHome`/
`amrOpenCodeHome`/`xdgDataHome` are all inputs, not hardcoded paths the
function reaches for on its own) — a Jini-based product that drives the same
external agent CLIs (Claude Code, Codex, OpenCode are all plausible
`@jini/agent-runtime` targets per extraction-plan.md's roadmap) can reuse
this verbatim, and one that doesn't simply never calls
`buildAgentCliLogSources`; (3) the "AMR" agent slot is additive-only (only
appended to `agentDirs` when `amrOpenCodeHome`/`dataDir` is supplied) so a
non-OD consumer never sees it activate. Flagged here explicitly rather than
silently ported, per this porting session's own standard: a future
Coordinator/Software-Architect review of this not-yet-locked package should
weigh whether the Claude/Codex/OpenCode/AMR-specific vocabulary belongs in a
neutral diagnostics package or should be generalized further (e.g. a
caller-supplied list of `{agent, dir}` pairs instead of the four names being
baked into the function body). Not resolved here — this is exactly the kind
of judgment call flagged for sign-off, not a decision this task should make
unilaterally.

## Tests

`src/redaction.test.ts`, `src/zip.test.ts`, `src/agent-logs.test.ts` ported
from `packages/diagnostics/tests/{redaction,zip,agent-logs}.test.ts`
near-verbatim (all 22 tests), moved beside their source files (this porting
session's convention — see `@jini/platform`'s per-file test layout) rather
than kept in a separate `tests/` directory, so no second `tsconfig.tests.json`
was needed. **Identity-stripped** the two `zip.test.ts` fixture app names
(`"open-design"` → `"jini-host"`) — fixture data, not tested behavior; the
assertions were updated to match.

## Not ported (build tooling, not package content)

`esbuild.config.mjs` (the origin's separate-publish dual CJS/ESM build
script) and `vitest.config.ts` (only needed because the origin's tests live
outside `src/`) — this package builds via the shared `tsc -p tsconfig.json`
convention every other `@jini/*` package in this porting session uses, and
its tests sit beside their source files, so neither is needed.

## Dependencies

`jszip` (`^3.10.1`, matching the origin package's pinned version, new
runtime dependency — this is the first `@jini/*` package to need zip
packaging).
