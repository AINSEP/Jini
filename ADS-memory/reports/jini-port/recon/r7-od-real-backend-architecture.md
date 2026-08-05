# R7 — OD's real backend surface: daemon vs. telemetry-worker vs. desktop vs. packaged

Scope: whole-app-level comparison across the four candidate "OD backend" targets
surfaced this session (`apps/daemon`, `apps/telemetry-worker`, `apps/desktop`,
`apps/packaged`), to ground the `extraction-plan.md` §4/§8/§12-C7 rewrite in real
numbers instead of the plan's original 2026-07-16 estimates. This is the cross-app
companion to `r1-daemon.md` (which already classifies `apps/daemon/src`'s internal
top-level dirs into GENERIC-ENGINE/OD-PRODUCT/MIXED — not repeated here).

Evidence sources: `codebase-memory-mcp` (indexed against
`/Users/la/Desktop/Programming/OSS-Repos/open-design` on `origin/main` @ `958cc887`,
2026-07-17, 145,151 nodes / 281,939 edges), Graphify's pre-computed
`graphify-out/GRAPH_REPORT.md` (built from `f1aabe9e`, 2026-07-04 — 13 days older,
used only for community/cohesion framing, not exact counts), and direct `wc -l`/`find`
against the real clone. All findings verified in-repo; nothing here is inferred.

---

## 1. Real size, per app (verified 2026-07-17, `origin/main` @ `958cc887`)

| App | Real files (.ts/.tsx, excl. `node_modules`/`dist`/vendor) | Real LOC | Notes |
|---|---|---|---|
| `apps/daemon` | 935 | 327,676 | By far the dominant backend surface. |
| `apps/desktop` | ~14 hand-written + tests | **~13,460** (updater 3,529 + runtime 2,829 + deck-capture 1,505 + index 956 + pdf-export 478 + tests ~4,163) | A naive `find` (incl. `vendor/`+`dist/`) reports 86,745 — 6.4x inflated by one vendored bundle: `vendor/dom-to-pptx/dom-to-pptx.bundle.js` (61,445 lines, third-party, not OD code) plus duplicate compiled `dist/main/*.js` output. |
| `apps/packaged` | 37 | 7,297 | No vendor/dist bloat — genuinely this small. Electron launcher/protocol/sidecars/telemetry glue. |
| `apps/telemetry-worker` | 7 (single `src/index.ts`) | not separately measured (trivial) | **Does not exist on upstream `nexu-io/open-design` main** — confirmed via `git ls-tree origin/main -- apps/telemetry-worker` (empty) vs `git ls-tree fork/main -- apps/telemetry-worker` (present). Fork-only. Has a `wrangler.toml` — it's a Cloudflare Worker, not a daemon-adjacent service. |

## 2. §12 C7's "desktop/packaged ≈ 14k lines" claim: verified, with a correction

C7 said: *"OD desktop/packaged ≈ 14k lines (incl. a 3k updater + Chromium PDF/deck
capture) — do not generalize now."* Reading this as **desktop alone** (the "updater"
and "PDF/deck capture" callouts are both desktop-specific, not packaged), the real
hand-written total (~13,460 lines, once the vendored `dom-to-pptx` bundle and compiled
`dist/` are excluded) matches almost exactly. **C7 is accurate and the caution stands.**
`packaged` (7,297 lines) is a separate, smaller surface C7 didn't actually estimate —
still small enough that "do not generalize now" applies equally, just not for the same
reason (no Electron/Chromium native-capture complexity there, just genuinely little
code).

## 3. `apps/telemetry-worker` is not real OD — recommend dropping it from scope entirely

This app only exists on `leonaburime-ucla/open-design` (the personal fork), not on
`nexu-io/open-design` (real upstream). The whole point of the OD-sync mechanism (§4)
is staying in sync with **upstream** OD via `git format-patch`/patch-canary — something
that doesn't exist upstream has nothing to sync against. Whether this is the fork
owner's own unmerged work-in-progress or an unrelated experiment, it shouldn't be
folded into "OD's backend" for extraction-plan purposes. Recommend: drop it from the
task #10 scope discussion entirely; if it ever matters, treat it as a separate,
unrelated small project, not part of the daemon-adapter mechanism.

## 4. Cross-app architecture, from real dependency-graph evidence

`codebase-memory-mcp`'s `get_architecture` (aspects=all) reports, per top-level
package (proxied by graph node count, a rough complexity signal, not LOC):

| Package | Node count | Layer classification (tool's own heuristic) |
|---|---|---|
| `web` | 6,894 | internal (fan-in 136, fan-out 628 — mostly a consumer) |
| `daemon` | 6,892 | **core** (fan-in 557, fan-out 272 — the real hub) |
| `desktop` | 545 | internal (fan-in 54, fan-out 54 — balanced thin client) |
| `packaged` | 172 | *(not separately classified — below the layer-detection cutoff)* |

`telemetry-worker` does not appear as its own package bucket at all (too small /
isolated to register).

**Cross-package call boundaries** (top 10 by call count, from the same query):
`web→daemon` 436, `daemon→web` 136, `web→contracts` 85, `daemon→_official` 79,
`landing-page→daemon` 67, `ui→lib` 60, `daemon→contracts` 57, **`desktop→daemon` 54**,
`web→desktop` 54, `web→_official` 53.

Takeaways:
- **`daemon` is unambiguously the architectural core** — highest fan-in of any
  package (557), the only package graphify's own heuristic labels `core` with real
  inbound+outbound traffic (not just a leaf). This is independent confirmation that
  task #10's daemon-adapter work (and task #1's manifest/canary harness, which is
  scoped to daemon specifically) is targeting the right thing.
- **`desktop` is a thin client of `daemon`**, not a peer hub — 54 calls each direction,
  "internal" layer, no fan-in from anything else. This matches its small real LOC
  (~13.5k) and supports C7's "don't generalize now" read: it's genuinely a
  daemon-consuming shell, not an independent backend surface worth its own
  hollow-re-export treatment yet.
- **`web→desktop` (54 calls) is a real, previously-undocumented coupling** — the web
  frontend calls into the desktop shell directly (likely Electron IPC/bridge APIs),
  not just through daemon. Worth flagging for whoever eventually scopes a `desktop`
  extraction — it's not a clean daemon-only dependency.
- `packaged` and `telemetry-worker` are both too small/isolated to register as their
  own architectural layer — consistent with their small real LOC counts above.

## 5. Recommendation for `extraction-plan.md` §4/§8/§12 (feeds Phase 5)

- Keep task #10's scope as **`apps/daemon` only**, per the plan as originally written
  — real evidence reinforces this rather than contradicting it. Do not add
  `desktop`/`packaged`/`telemetry-worker` to that task.
- Drop `apps/telemetry-worker` from consideration entirely (§3 above) — it isn't OD.
- Leave C7 as-is; it's accurate. Optionally tighten its wording to clarify it's
  describing `desktop` specifically (not `desktop`+`packaged` combined), since the two
  apps have unrelated size drivers (vendored bundle vs. just being small).
