# Proposal: a product-neutral plugin/capability-pack host for `@jini/*`

**Status:** Proposal only — not implemented. No code was written or changed as part of this
document. Requires Coordinator/Software Architect sign-off before any `@jini/plugin-runtime` (or
equivalent) package is scaffolded, per this task's explicit instruction to propose, not build.

**Scope note:** this document was written alongside two HTTP-route/CLI-command ports on the same
branch (see `packages/http/source-map.md`'s 2026-07-21 additions and `packages/cli/source-map.md`'s
matching entry). Unlike those two — which had an existing, detailed source-map to port against —
a generic plugin host has no locked-architecture precedent anywhere in `ADS-memory/reports/jini-port/`. This
document exists to give the next task that precedent, not to build ahead of one.

## What OD's actual plugin/marketplace system does today

Read directly from `leonaburime-ucla/open-design`, branch `refactor/web-memory-slice` (the branch
`packages/http/source-map.md`'s routes-classification table was built against), via `git show` —
not reconstructed from memory or from that table's one-paragraph-per-file summaries alone.

### The route surface (already classified OD-PRODUCT, not reconsidered here)

`apps/daemon/src/routes/plugins/index.ts` (304 lines, ~40 operations:
list/search/stats/sources/info/manifest/install/upgrade/uninstall/apply/duplicate/canon/diff/
doctor/replay/trust/snapshots/simulate/verify/events/run/scaffold/validate/pack/candidates/login/
whoami/export/publish/publish-repo/open-design-pr/yank), `assets.ts` (287 lines, manifest-namespaced
asset serving), and `marketplaces.ts` (121 lines, a thin wrapper over the marketplace subsystem).
One literal product-identity route path (`/contribute-open-design`), a hardcoded
`nexu-io/open-design` upstream-PR target, and `gh` CLI shelling for the publish flow. None of this
is reconsidered here — it stays OD-PRODUCT.

### The actual engine underneath (`apps/daemon/src/plugins/*`, ~50 files) + `packages/plugin-runtime`

**Manifest & validation.** A separate workspace package, `@open-design/plugin-runtime`
(`packages/plugin-runtime/src/`), owns manifest parsing independent of the HTTP layer:
`parsers/manifest.ts` (`parseManifest`), `merge.ts` (`mergeManifests`), `digest.ts` (content
hashing), and `validate.ts` (`validateManifest`/`validateSafe`). The manifest itself
(`PluginManifest`, a Zod schema — `PluginManifestSchema` — in `@open-design/contracts`) is a
declarative capability-*request* document under an `od.*` namespace: `od.context.mcp[]` (MCP
servers to register), `od.connectors.required[]`/`optional[]` (external service connectors),
`od.genui.surfaces[]` (human-in-the-loop UI surfaces), `od.pipeline.stages[]` (agent pipeline
stages, with a hard cross-field rule: `repeat: true` requires an `until` expression), and
`od.capabilities[]` (a flat capability-string list). `validateSafe` layers cross-field checks the
JSON/Zod schema alone can't express (the repeat/until rule; a GenUI surface's `oauth.connectorId`
must reference a declared connector; an unrecognized capability string becomes a **warning**, not
an error — explicitly so a forward spec patch can add vocabulary without breaking existing
installs). Two **compat adapters** (`adapters/agent-skill.ts`, `adapters/claude-plugin.ts`)
translate two *other* ecosystems' manifest formats — Anthropic Agent Skills' `SKILL.md` and Claude
Code's `.claude-plugin/plugin.json` — into this same canonical shape, so OD's registry can ingest
plugins authored for those ecosystems without their authors targeting OD specifically.

**Trust tiers & capability grants** (`apps/daemon/src/plugins/trust.ts`). Two tiers: `trusted`
(local-folder installs — "the user copied the folder here themselves") and `restricted`
(everything else: bundled, marketplace, GitHub, URL, project-local), decided purely by
`sourceKind` at install time. Each tier has a **default capability set**: `restricted` gets exactly
`['prompt:inject']`; `trusted` gets `['prompt:inject', 'mcp:*', 'connector:*', 'genui:*',
'pipeline:*']` plus everything its own manifest's `requiredCapabilities()` computes. A user can
explicitly promote a restricted plugin via `od plugin trust <id>` (a separate CLI action, not part
of install). The vocabulary is a **small, closed, fixed set**
(`prompt:inject`/`fs:read`/`fs:write`/`mcp`/`subprocess`/`bash`/`network`/`connector`/
`genui:custom-component`) plus scoped variants matched by regex (`connector:<id>`, `mcp:<name>`,
`genui:<kind>`) — capabilities outside this set are rejected at the HTTP layer for an explicit
trust-promotion request, but (per `validateSafe` above) merely warned-about at manifest-validation
time, a deliberate two-speed strictness split.

**Enforcement is re-checked at the point of use, not just at install time**
(`apps/daemon/src/plugins/connector-gate.ts` is the clearest example, and its own comment states
the reasoning explicitly): a connector capability is checked **three times** — once at apply-time
(resolving `od.connectors.required[]` against a live connector catalog and auto-deriving an
OAuth-prompt UI surface for anything not yet connected), once at token-issuance time (before the
daemon hands a connector tool-token to the agent, validating the snapshot's
`capabilitiesGranted` against `connector:<id>`), and once again on **every actual tool-execution
call** ("`/api/tools/connectors/execute` re-validates on every call so a token replacement attack
never bypasses the gate"). This is a real, load-bearing security pattern worth carrying forward as
a *shape*, independent of the OD-specific connector/genui/pipeline nouns it's currently wired to.

**Loading/installer** (`apps/daemon/src/plugins/installer.ts`). Three source kinds: a local-folder
copy, a `github:owner/repo[@ref][/subpath]` tarball fetched from `codeload.github.com`, and a
generic HTTPS tarball URL — both remote kinds extract into a temp dir then reuse the local-copy
path. Hard constraints, all already generic in shape: reject path-traversal segments and symlinks
during copy/extraction, cap the copied tree at 50 MiB by default, refuse to silently overwrite a
different plugin id at the same destination slot. A **lockfile**
(`apps/daemon/src/plugins/lockfile.ts`, `PluginLockfile`, `schemaVersion: 1`) records per-plugin
`manifestDigest`/`archiveIntegrity` — content hashes for reproducibility/diffing, **not**
cryptographic signature verification: there is no public-key signing scheme, trusted-publisher-key
registry, or signature-check step anywhere in this subsystem (confirmed by grep across
`apps/daemon/src` for `worker_threads`/`isolated-vm`/`vm2`/`new VM(` — zero hits outside an
unrelated `atoms/registry.ts` name collision — and for `sign`/`signature`/`checksum`/`integrity`,
which surfaces only this lockfile's hash fields).

**No code-execution sandbox exists.** This is the single most important architectural finding for
this proposal: OD's plugin system does not run third-party *code* in an isolated boundary at all.
"Running" a plugin means OD's own trusted daemon code interprets a declarative manifest — it
registers the MCP servers the manifest names, gates connector/tool access by the capability strings
above, renders the GenUI surfaces the manifest declares, and drives pipeline stages the manifest
specifies. Where a plugin's own arbitrary code *does* run (e.g. a bundled MCP server binary), it
runs as whatever subprocess the daemon would already spawn for an MCP client, gated by the same
capability checks described above — there is no separate plugin sandbox process, VM, or
capability-restricted runtime. The entire security model rests on: (a) trust-tier defaults
generally denying unrequested capabilities, (b) the closed capability vocabulary, and (c)
re-validation at each point of use — not on execution isolation.

**Registry & marketplace are two separate subsystems.** `apps/daemon/src/plugins/registry.ts`
scans a daemon-data-dir plugin root, resolves each folder into a manifest (parsing
`open-design.json` directly, or synthesizing one via the `agent-skill`/`claude-plugin` compat
adapters), and persists discovered records into a SQLite `installed_plugins` table so later
CLI/HTTP calls don't rescan the filesystem. `marketplaces.ts`/`marketplace-seed.ts`/
`marketplace-doctor.ts` are a separate, GitHub-backed **federated community catalog** — a different
concern (discovery/search/trust-roll-up across a community index) from the local registry (what's
actually installed on this machine).

## What a product-neutral "host infrastructure for running third-party capability packs" needs

This section is architecture, not an implementation plan — it names the pieces and the shape each
one should have, based on what worked (and what's conspicuously absent) in OD's version above.

1. **Loader.** Port the *shape* of `installer.ts` near-verbatim — it is already generic: pluggable
   source resolvers (local folder / git-hosted tarball / generic URL / a future registry-backed
   resolver), the same hard constraints (traversal/symlink rejection, size cap, controlled
   overwrite semantics), progress-event reporting (resolving → copying → parsing → persisting).
   None of this needs OD's nouns; it needs a generic "pack" noun instead of "plugin," and the
   destination root/registry it copies into should be an injected port (matching this repo's
   `Pack`/DI-token composition contract in `packages/core/src/pack.ts`), not a hardcoded daemon
   data directory.

2. **Manifest & capability-schema validation.** Port the *shape* of `plugin-runtime`'s
   parse-then-validate split (schema parse → cross-field rules → `{ok, warnings, errors}`, unknown
   vocabulary strings warn rather than fail) but the manifest's *content* must be redrawn against
   the kernel's own nouns (`Tool`, `Agent`, `ToolRegistry`/`ToolExecutor`, `ProviderRegistry` — per
   `ADS-memory/reports/jini-port/extraction-plan.md` §2.1/§2.3) rather than OD's `connector`/`genui`/`pipeline`/
   `design system` vocabulary, which has no meaning in the neutral kernel. Whether to also port the
   *compat-adapter* idea (ingesting Claude Code's `.claude-plugin/plugin.json` or Agent Skills'
   `SKILL.md` format into a canonical Jini pack manifest) is a real, separate, valuable question —
   flagged here as a candidate follow-up, not decided.

3. **Trust/capability-grant model.** The tiered-trust-with-a-small-closed-vocabulary pattern is
   sound and portable: default trust by source kind, default capability sets by tier, an explicit
   promotion action, a fixed vocabulary that grows only warned-not-failed on drift. The actual
   vocabulary strings need to be new — kernel capabilities are things like "register a `Tool`,"
   "run as a `ToolExecutor` boundary caller," "consume a `ProviderRegistry` credential," not
   `connector:*`/`genui:*`. This is where this proposal stops short of naming concrete strings: that
   vocabulary is exactly the kind of design decision this document is flagging *for* Software
   Architect sign-off, not preempting.

4. **Negotiation/enforcement protocol — re-check at the point of use, not just at load time.**
   `connector-gate.ts`'s three-checkpoint pattern (apply-time resolution, grant-time validation,
   re-validation on every actual call) is the right shape and has a natural home already in this
   repo: `@jini/daemon`'s `ToolExecutor` is described in the root `AGENTS.md` as "a real authz gate,
   being *built* not lifted." A pack's declared tool/capability requests should resolve into
   `ToolRegistry` registrations that `ToolExecutor`'s *existing* authz gate checks per call — this
   avoids inventing a second, parallel gate the way a naive port might, and keeps "packs" a
   consumer of the kernel's authorization boundary rather than a competing one.

5. **Sandbox boundary — the one piece OD has essentially nothing to port, and the one this
   proposal most needs a human decision on.** OD's actual posture (no code isolation; capability
   strings gate what trusted host code will do on a pack's behalf) is cheap and matches most of
   what "capabilities" mean in OD's own vocabulary (mostly gating access to host-interpreted
   declarative config, not raw code execution) — but it is a materially weaker posture than what
   the task brief's phrasing ("running signed third-party capability packs") implies, and a
   `trusted`-tier pack that *does* request `subprocess`/`bash` gets exactly that, unsandboxed. Real
   options, in increasing cost/strength order, none chosen here:
   - **(a) No sandbox, declarative-only manifests.** Packs cannot ship arbitrary executable code at
     all — only declarative tool/prompt/pipeline-stage descriptions the kernel's own trusted code
     interprets (matches OD's actual current scope for the bulk of its capability types).
   - **(b) No sandbox, but arbitrary code is possible via a subprocess** (mirroring how an MCP
     server or a coding-agent CLI already runs as a subprocess in this repo) — the same
     env-allowlisting/process-group-cleanup/resource-limit posture named in
     `PROP-agent-subprocess-env-allowlist-2026-07-21.md` becomes the plugin sandbox boundary by
     reuse, not a new mechanism.
   - **(c) A real isolation boundary** — an embedded WASM or QuickJS-style interpreter for
     pack-declared logic, or OS-level sandboxing (seccomp/containers) around a pack's subprocess.
     Materially more engineering, and the first genuinely new subsystem this proposal would
     introduce with no existing-code precedent anywhere in either OD or this repo.

6. **Signing/supply-chain trust — also new, not a port.** OD's `archiveIntegrity`/`manifestDigest`
   lockfile fields are reproducibility hashes, not a trust anchor (nothing verifies them against a
   publisher's key). A design that actually wants "signed" packs needs, from scratch: a detached
   signature format over `{manifest digest, archive digest}`, a trusted-publisher-key registry or a
   sigstore/cosign-style transparency-log approach, and a decision about what a *first* install
   requires (TOFU vs. a pinned key list vs. requiring the community-registry maintainer to have
   already verified it).

## What must stay OD-product-owned — NOT enter this design

- **The marketplace catalog itself** (the GitHub-backed federated community index, trust-roll-up
  seeded from marketplace-maintainer review) — a product community-curation feature.
- **The `nexu-io/open-design` hardcoded upstream-PR publish flow** and `gh` CLI shelling for the
  community-contribution workflow (`plugin publish`/`publish-repo`/`open-design-pr` per
  `packages/cli/source-map.md`'s `plugin` row).
- **The capability-grant UI** — whatever `od plugin trust`'s interactive UX and any design-system
  capability-grant dialogs look like — product UX, not host infrastructure.
- **OD's actual capability vocabulary strings** (`connector:*`, `genui:*`, `pipeline:*` tied to
  OD's specific connector/GenUI/pipeline subsystems, and the compat-adapter target ecosystems
  chosen) — the *pattern* of a small closed vocabulary is portable; these particular strings are
  not.
- **Asset-serving route specifics** (`manifest.od.*` namespacing, showcase/preview endpoints) —
  product surface, already classified OD-PRODUCT in `packages/http/source-map.md`.

## Naming caution — read before choosing a package name

A parallel research pass (a second dispatch that read only the three HTTP route files above, not
the deeper `apps/daemon/src/plugins/*` engine this document covers) independently flagged a vocabulary
risk worth preserving regardless of which research pass a reader trusts more:

1. **"Pack" is already a kernel noun with an incompatible meaning.** `extraction-plan.md §2.3`
   ("Packs own their app-services") defines a `Pack` as a **build-time-composed, trusted, in-process**
   feature module (`definePack({ deps, services, http, cli })`) — the opposite of a runtime-loaded,
   third-party, sandboxed unit. Naming this proposal's subject "`@jini/pack-host`" (or similar) would
   silently collide two unrelated nouns under the same word, the same failure mode
   `extraction-plan.md §12 C5`'s vocabulary firewall already caught once for OD's "agent." §5's own
   phrasing above ("packs a consumer of the kernel's authorization boundary") already uses "pack"
   informally without addressing this — worth resolving before any package name is chosen.
2. **"Capability" is already overloaded at least four ways in this codebase**: `ToolPolicy`'s
   allow/deny authorization decision, `@jini/capability-providers`' auth/storage/payments/db/realtime
   provider ports, OD's own `capabilitiesGranted`/capability-string vocabulary (§0 above), and
   `RegistryEntry.capabilitiesSummary` (`packages/protocol/src/registry.ts`) — a flat *display* list,
   not a structured request/grant schema. Whatever schema a follow-up introduces needs a name that
   doesn't imply it *is* one of those four things when it composes with, but is distinct from, all of
   them.

## Open questions for Coordinator / Software Architect sign-off

1. Does a plugin/pack host belong in the locked §3 package set at all yet, or is it premature
   given extraction-plan's own stated priority order (ship the headless engine first — daemon
   spine, `ToolExecutor`, HTTP/CLI transports — before frontend/plugin-ecosystem milestones)?
2. Which sandbox tier (§5 above: declarative-only / subprocess-reuse / real isolation) is the
   *starting* posture, and is it meant to be the permanent one or an explicitly-named Phase 1 like
   OD's own trust.ts comments describe their own capability model ("Phase 1 keeps the policy
   minimal... Phase 2A wires the marketplace trust roll-up")?
3. Is "signed" packs (per the task brief's phrasing) an actual Phase 1 requirement, or is it
   acceptable to ship OD's current no-signing posture first and treat cryptographic supply-chain
   trust as an explicit, separately-scoped follow-up?
4. Should the compat-adapter idea (ingesting Claude Code / Agent Skills manifest formats) be
   in scope for a first pass, given it has a working precedent in OD but adds real scope, or
   deferred until a second consumer/format actually needs it (mirroring the two-consumer rule
   `packages/cli/source-map.md`'s `mcp` row already applies elsewhere in this repo)?
5. Does the capability vocabulary get defined per-pack-domain (e.g., `@jini/agent-runtime` owns
   what "run a subprocess" capability means, `@jini/daemon`'s `ToolExecutor` owns what "register a
   tool" means) with the plugin host only orchestrating grants across them, or does the plugin
   host package own one central vocabulary? This mirrors the same "who owns app-services vs. who
   owns orchestration" split extraction-plan §2.4 already resolved for packs generally — worth
   deciding explicitly here rather than assuming an answer.
