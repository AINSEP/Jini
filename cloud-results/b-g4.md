DONE 0e4152300 fc82d6d42

# b-g4 — P8 triaged backlog part B (build + test)

Branches: Tovu and Jini `integ/b-g4-2026-11-25` = `integ/merge-21-2026-11-24` (Tovu `7c87b3c3f`, Jini `010c8cd87`) + Sol `codex/tv-b-p8b` / `codex/b-p8bj`, tested and fixed, + every `BUILDER: OPUS` sheet in `plans/sheets-1124b/rev-p8b.md`. The SHAs on the first line are the last code commits; the report commit sits on top. WIP was pushed after each step to `integ/wip-b-g4` (both repos).

- **Bootstrap:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first and followed its test-first inner loop, pre-completion checklist and architecture audit. The dispatch was marked `<<SUBAGENT_DISPATCH>>`, so the CLAUDE.md/AGENTS.md bootstraps were skipped as that marker requires.
- **Setup:**
  - Node 24.22.3 (`/opt/node24/bin` first on PATH).
  - Jini: `pnpm install --frozen-lockfile` and a build of `./packages/*`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini` (the default path is wrong for cloud); `prepare-desktop-hooks`; a build of `packages/{contracts,sdk}`.
- **Agents:** Opus coordinated. Workers were Opus-high for the credential, deletion, ordering and redaction sheets and Sonnet for A046/A382 and V2.T B199/B239. At most 4 ran at once; each finished within its call budget.
- **OPUS-REVIEW:** `rev-p8b.md` carries no `BUILDER: SOL (OPUS-REVIEW)` sheet, so there was nothing to review. All 5 SOL sheets were tested here and their named mutations re-run.
- **B140:** the B140 old-title scrub (ADR-066 data migration) is a p8a sheet (P8-T1.S), not part of this p8b set, so it was not built here.

## Sheets

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P8-T6.J (B177 campaign archived list) | Sol, tested by Opus | DONE | `saveCampaign refuses an archived list…` (create, edit). `allow-archived-campaign-list` RED. Test names split by case (`de3c2956a`). |
| P8-V2.J (B238 inventory false flag) | Sol, tested by Opus | DONE | `inventory preserves explicit false capability flags…`. `drop-false-capability-flags` RED. |
| P8-T6.T (B177 subscriptions) | Sol, tested by Opus | DONE | save and import witnesses. `skip-save-list-archive-guard` and `skip-import-list-archive-preflight` each RED independently. |
| P8-T11.T (B237 WebMCP offset) | Sol, tested by Opus | DONE | `a capital İ before a mixed-case body closer…`. `index-lowercased-copy` RED. |
| P8-L1.T-C036 | Sol, tested by Opus | DONE | `prompt prefix does not re-export the assembly helper`. `restore-forwarding-export` RED. The lost why-comment is allow-listed with its reason. |
| P8-T7.J (B203/B204) | Opus worker | DONE | `a trashed destination redirect is blocked…`, `…changed after review is not overwritten…`, `an intervening redirect edit cannot pass the version-gated write` (barrier rig). `omit-not-live-from-blocked`, `drop-caller-version-basis` and `split-compare-from-write` all RED. Read, compare and write run under the host's `redirects:write` writer lock, so the STOP condition was not hit. cms changeset; baseline updated. |
| P8-T8.J (B135/B136 Jini) | Opus worker | DONE | `a per-provider PATCH cannot submit a second provider`, `PATCH and DELETE authorize before calling their credential ports`, `a stale legacy PUT never reaches a write`, `saving or removing one provider calls only that provider's operation`. `accept-map-body-on-patch`, `write-before-authorize`, `ignore-legacy-revision` and `send-entire-provider-map` all RED. Two new cms subpaths. The cms changeset was raised to **minor (0.x breaking)** with a consumer inventory, because `getProviders`/`saveProviders` changed shape. The ui changeset is minor (additive). cms and ui baselines updated. |
| P8-T8.T (B121 + B135/B136 Tovu) | 2 Opus workers + 2 follow-ups | DONE | Source Control: `a canonical Source Control key survives reload…`, `a foreign or ungranted canonical key…`, plus a host-move/paired-field refusal pin I added. `legacy-only-list-update-delete`, `drop-canonical-workspace-scope` and `paired-field-dropped` RED. Media: `saving one provider does not wipe a built-in key…`, `Remove on a plugin-vendor key deletes that key and nothing else`, `a stale legacy PUT preserves newer credentials`, plus workspace/auth refusal pins and no-secret-in-wire pins. `replace-map-on-patch`, `remove-by-omission` and `compare-revision-outside-writer-boundary` RED. No schema change: the revision comes from stored vault id, CAS counter and write time. Follow-ups: Security → Other credentials and the Jini admin Security adapter were rebound to PATCH/DELETE; both 409'd after the PUT gained If-Match. Mutations `send-entire-provider-map-from-security` and `whole-map-put-from-security-adapter` RED. |
| P8-T9.T (B200/B201) | Opus worker | DONE | `invalid External MCP form input explains the field…`, `a changed approval basis asks for a new card and saves nothing`, `credential-shaped submitted values do not appear…`, and 3 URL repoints. `collapse-all-tool-input-errors`, `remove-stale-basis-identity`, `return-unredacted-input-message` and `old-settings-path` RED. The second and third tests were already green before the fix and act as regression guards. |
| P8-T10.T (B141/B186) | Opus worker | DONE | `closing during federation startup never starts a paid BYOK call`, `closing during credential resolution never starts a BYOK stream`, plus a pre-entry close test. `arm-close-after-federation` and `ignore-close-before-inputs-resolve` RED. B186: `search and describe follow a provider becoming unavailable…`, `catalog registration reads no chart snapshot…`. `pin-static-manifests` and `read-snapshot-at-registration` RED. Also fixed one already-red BYOK preflight test that was missing an argument. |
| P8-T13.J (C063 subpath retirement) | Opus (me) | **STOP (per sheet)** | `@jini-ai/chat/server/run-finalizer` is in the exports of the **published** npm `@jini-ai/chat` 0.7.1 and 0.7.2 (`latest`). GitHub code search across the accessible repos and a grep of Tovu found no importer, but consumers outside these checkouts cannot be ruled out. Following the sheet ("If use is uncertain, stop before removal"), nothing was removed, and the gate test was not added because it would be a committed red. Owner call: deprecate in 0.8 with a notice, or remove as a breaking change. |
| P8-L1.T (A046, A382, A453, B018) | Opus (me) + Sonnet worker | DONE | A046: duplicated starter/tovu-theme keep their own key; shipped and `__original-themes__` copies are byte-identical. `hard-coded-key` RED. A382: 3 named tests + 1. `ignore-version-in-stamp`, `use-dist-directory-mtime` and `ignore-force-result` RED. A453: `names no remote font host…`; fonts and OFL texts verbatim from `4e2b5f55cf` (fetched by SHA). `googleapis-import` RED. B018: I confirmed the resolved artifact (`npm pack @jini-ai/platform@0.7.3-next.2`) exports all six canonical names. `the canonical Jini exists error maps…` and `the Tovu keyring imports no retired RootKey names`, plus an impostor-name pin; `restore-root-key-name-match` and `restore-legacy-import` RED. |
| P8-L2.J (C096) | Opus (me) | DONE | `submitForm: a duplicate reaching the claim before the first insert completes stores one row across a minute boundary`. It uses deferreds, a step-tied clock, a `finally` release and an asserted step order, and checks one event. `skip-attempt-claim` RED and reverted. Test-only. |
| P8-V1.J (B147, B270, B272) | Opus worker | DONE (verify) | B147 GREEN (`ignore-explicit-successor-off` RED). B270 update path GREEN (`bypass-locked-graph-validation` RED). B270 create path RED → todo. B272 RED → todo, then **fixed** by me in `c7a79d426` (restore runs the wildcard cap; todo promoted; `ignore-capacity-on-restore` RED). |
| P8-V1.T (B115, B066, B170, B226, B231, B272-oauth) | Opus worker + fix worker | DONE (verify) | B066 GREEN (`treat-every-long-path-as-a-token` RED; this needed the contracts dist). B170, B226 and B272-oauth RED → todo. B115 and B231 RED → **fixed** (`90d10054d`, `12fa4b0ea`; `drop-sender-frame-admission` and `promote-post-save-heal-error-to-save-refusal` RED). |
| P8-V2.T (B199, B239, B259) | Sonnet worker + Opus (me) | DONE (verify) | B199 identity GREEN (`ignore-approved-server-id` RED). B199 live-probe RED → todo; an owner call is needed, because the tool says "never connects" but production injects the probe. B239 picker GREEN (`always-apply-recommendations-on-open` RED); new empty-allowlist RED → todo. B259 RED → todo. |

## Gates vs merge-21

- **Gate 0:** desktop `npm run gates` on merge-21 Tovu passed 6/6.
- **Desktop after this run's changes:** 6/6 PASS after B115 (the last `apps/desktop` change), again in the pre-push hook at `38300cc4d`. The push of `e8ea015ce`, made while two workers were mid-edit, was refused by the hook; nothing was bypassed.
- **Tovu (final, once):**
  - `tsc` root 0, admin `tsc` 0, `check:hooks` 0, `check:boundaries` 0, `check:why-comments` (base merge-21) ok: 18 lost, all 18 allow-listed with reasons.
  - `check:complexity` lists 5 entries. All 5 are also present at the Sol-merge state and none is in a file this run touched: use-held-back-themes, modules.hooks, public-config, newsletter confirmation, site-databases. The two this run introduced (`requireKnownMcpSave` 12, `rotatedToken` 14) were split to 10 or below in `09d04f1b4`.
  - Changed website/dev tests: 271 tests, 267 pass, 0 fail, 4 todo. Changed admin tests plus the security and media suites: 51 files, 916 pass, 2 todo.
- **Tovu importer runs:** 101 importer files of the Sol/B018 modules gave 1745 pass and 18 fail. The same 10/40 failures in those 7 files reproduce with merge-21 copies of the changed modules (publish-content peers missing export, `federate-mcp` provisioning, `mail-send.golden`, publish-credentials pins), so they are pre-existing. `external-mcp-aad` "ordinary reads reject unnormalized legacy envelopes" also fails with merge-21 sources, so it is pre-existing too.
- **Jini:**
  - Builds of cms, ui, user-management, agent-plugins, agent-runtime and admin: 0.
  - Strict typecheck (noUncheckedIndexedAccess, exactOptionalPropertyTypes) of all six: 0.
  - `api:check` 0 (cms and ui baselines updated; admin and user-management carry merge-21 drift, left alone). `check:hooks` ok. `check:why-comments` (base merge-21) ok.
  - `guard`: 1 violation, the same as merge-21 (HW3 `admin/src/shell/lib/shell-failure-log.ts`). No product or host words were added.
  - `check:complexity`: 12 entries, identical to the merge-21 count; none in touched code.
  - Vitest: redirects + media routes + forms 535/1 todo; ui media-providers 131; user-management newsletter 94; agent-runtime inventory 10; agent-plugins 2; admin security 542. The two failures in the full run (`missing-peer.test.ts`, pglite `repo.dialects`) were 5 s timeouts under load and pass alone.

## UNVERIFIABLE-IN-CLOUD

- A453 and A046 in a real browser: font rendering, and the toggle surviving a theme duplicate plus reload.
- A382 with a real `npm run dev` relink/rebuild cycle.
- B115 in a real Electron subframe.
- The media/Security screens against a live site, including a two-window concurrent edit.
- Postgres-dialect tests (no postgres socket here).
- External downstream consumers of `@jini-ai/chat/server/run-finalizer` (C063).

## New bugs

- **Fixed in this run:** B272 redirect restore capacity (J `c7a79d426`); B115 (T `90d10054d`); B231 (T `12fa4b0ea`); the media/Security 409 knock-on (T `38300cc4d`, `e79ca2ea2`, J `538470813`); a missing test for the rotatedToken refusal (T `2d1ff1c8e`).
- **Logged in `development/open-bugs.md` (section b-g4):**
  - B270-create
  - B272 via the Trash tool
  - B170, B226 and B272-oauth (todos)
  - B199 (owner call)
  - B239 empty allowlist
  - B259
  - B115's remaining chat channels
  - permanent delete misses canonical Source Control keys
  - External MCP store messages echo values
  - Media tab hook optional; AccessTokensTab hook optional
  - Per-provider port not atomic across remove+patch
  - Media revision same-ms collision (low)
  - Media-generation tool saves without a revision
  - Pre-existing merge-21 reds
- **`development/todos.md`:** no row in it matches this set's work, so none was ticked.
