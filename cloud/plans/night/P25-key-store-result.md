Software Architect(Direct): I loaded `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/software-architect/skills.md`.

**Goal**

Save an owner’s key or OAuth connection once. Each site receives a reference through one human-approved grant. Revoking that connection stops future use everywhere; exports carry no personal credentials or grants.

**Findings — source evidence**

- Item 25 and the later GitHub section explicitly require references and absorption of existing paths: `development/todos.md:69,82–83`.
- Shared Keys already uses the project vault, rather than a new owner database: [owner-store.ts:95](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/cli/commands/owner-store.ts:95).
- However, that database is **per sites root**, under `~/.tovu/projects/<projectId>/`, rather than one machine-level store: [project-store.ts:22](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/project-store.ts:22).
- References already exist: `site_key_attachments`, keyed by the site’s metadata UUID, with uncached eligibility checks: [attachments.ts:7](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/attachments.ts:7).
- The picker currently excludes OAuth connections; its grant tool directly accepts model arguments without a human card: [service.ts:65](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/service.ts:65), [tools.ts:35](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/tools.ts:35).
- The existing attached-vault wrapper filters reads but forwards mutations. It needs a narrower consumer boundary: [attached-vault.ts:14](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/attached-vault.ts:14).
- Copy Keys discovers other sites and writes copies; the legacy importer also explicitly leaves site copies behind: [credential-copy-tool.ts:30](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/custom-credentials/credential-copy-tool.ts:30), [owner-store-import.ts:6](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/cli/commands/owner-store-import.ts:6).
- GitHub has two **logical** credential paths. Source control already uses `secrets_vault`, then falls back to saved API keys: [source-control-credential-repo.ts:9](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/source-control/source-control-credential-repo.ts:9), [tool-registrations.ts:145](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/source-control/tool-registrations.ts:145).
- API connections remain site-scoped; Jini already supplies durable refresh leases, client binding and generation fencing: [agent-plugin-connections.ts:125](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/agent-plugin-connections.ts:125), [vault-token-store.ts:1](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/integrations/src/api-connections/token-store/vault-token-store.ts:1).
- **Export gap:** optional saved-key exports currently flatten attached project secrets into the bundle: [saved-keys.ts:163](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-backup/saved-keys.ts:163).
- Production currently opens no project store: [deps.ts:1003](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:1003).
- Graph MCP tools were unavailable; findings use direct source inspection. Architecture chapters 13/14, constitution, governance index and project memory are absent from this clone; formal compliance remains unverified.

**Design — smallest**

1. **Extend the existing vault and attachments.** Consolidate project credentials into one canonical `project.db` under the owner’s resolved app-data directory. Retain the existing cipher, vault service and grant table; keep legacy `owner.db` as an import source only.
2. **Move generic ownership into Jini.** Put reference/grant policy in `@jini-ai/platform/secrets/credential-sets`, SQL adapters in `@jini-ai/db`, and shared OAuth orchestration in `@jini-ai/integrations`. Tovu supplies paths, identity, permissions, cards and composition.
3. A site stores only its selected credential reference and usage configuration. The owner database holds the secret and authoritative `(siteUUID, credentialId)` grant. Bind site identity server-side; never trust a model-supplied identity or `workspace-local`.
4. Expose separate owner-management and site-consumption ports. Site code cannot enumerate ungranted entries, mutate shared secrets or acquire the owner key. Owner-authenticated UI may browse available connections; site agents see granted metadata only.
5. Reuse the existing human exchange/card lifecycle for **“Use this connection on this site.”** Bind approval to owner, site, entry and intended use; revalidate on submission. Granting credentials preserves plugin enablement, tool permissions and Auto/Ask/Off controls.
6. **One credential identity across consumers.** Saved API-key and source-control readers resolve the same entry. Keep username/repository settings as non-secret configuration. Provider-specific mapping remains in `@jini-ai/agent-plugins/github`; remove the dual-store fallback after adoption.
7. **Shared OAuth:** retain the issuing client, issuer, resource/audience, account, scopes and refresh material together. Site-local API/MCP connections reference this owner connection; their tool/write grants remain local. Preserve that issuing client when another runtime uses the connection.
8. Reuse Jini’s refresher and durable lease, keyed by the owner connection—not site/server ID. Refresh on demand, persist rotation before returning, and check grant plus connection generation again before use. Never copy refresh tokens into site vaults.
9. **Revoke here** removes one site grant. **Disconnect everywhere** disables the owner connection and removes all grants atomically; OAuth generation advances before remote revocation. Provider failure cannot restore local access. Existing requests may finish; subsequent authorization fails.
10. Every credential-consuming operation checks current authorization, including operations using an already-open MCP/provider session. Revision polling must not be the revocation boundary.
11. **Exports:** remove attached-owner capture entirely, including password-protected “include saved keys.” Exclude owner database/key, grants and usable owner bindings. Imported sites require fresh grants; importing a site must never grant access.
12. **Site Token/root key:** these name the same site encryption secret, currently called **Site key / `TOVU_SITE_KEY`**. Preserve one site root, with existing purpose derivation. The owner vault has its own single encryption root; neither becomes an API bearer credential. Never distribute the owner root through site configuration.

**Non-desktop access**

- **Localhost, same OS owner:** resolve the same app-data store directly through trusted host composition; desktop need not be running. Changing sites root must not create another credential store.
- **Self-hosted, same host:** explicitly configure an owner-store directory outside site/export roots, accessible to the trusted host account. Production mode alone must not disable that configured store.
- **Another machine:** the desktop’s store is unavailable by default. Show that state; do not copy credentials or silently start sign-in. A separately provisioned host-local store is a different store.
- **Optional:** authenticated remote access through the same consumption port. Networking, pairing and availability make this a separate addition, unnecessary for the initial machine-local feature.

**Steps — ordered, planned files**

1. Write RED acceptance tests for grant isolation, shared refresh, global revocation and export exclusion before changing behavior.
2. Extract/extend `features/project-keys/{attachments,attached-vault,service}.ts` into Jini’s existing secrets packages. Contracts take `(requiredArgs, optionalArgs)` and inject storage, authorization, identity and clock.
3. Update `composition/project-store.ts`, `platform/site-dir/sites-workspace-options.ts` and `cli/commands/owner-store.ts` for one canonical app-data location. Preserve root-specific project identity separately for telemetry.
4. Add immutable ADR-066 TS migrations and checksums for required reference/status data and supported credential kinds. Use existing migration ledgers; leave published steps and frozen Drizzle files untouched.
5. Extend `owner-store-import.ts` and existing source readers with resumable adoption: dry run → owner write/read-back → reference/grant → source cleanup. Record progress across databases; compare source revisions before cleanup.
6. Preserve existing authorized use only for originating/already-attached sites. Merge identical compatible credentials; keep different tokens/accounts distinct and report selection conflicts. Transfer OAuth client/discovery context with tokens.
7. Wire `api-connections/{host,vault-stores}.ts`, `external-mcp/external-mcp-oauth.ts`, `composition/agent-plugin-connections.ts` and Jini integration adapters to owner references and the existing refresh machinery.
8. Route custom/vendor/media/assistant and source-control credential consumers through that resolver. Remove absorbed save/copy/fallback paths after reconciliation; do not retain a legacy fallback that defeats revocation.
9. Replace `credential-copy-tool.ts` with the grant card; extend existing admin controls and desktop `SharedKeys`, bridge and CLI actions with usage, per-site removal and global disconnect.
10. Remove owner capture from `composition/site-portability.ts` and `site-backup/saved-keys.ts`; verify share ZIP, backups, GitHub backup and restore paths.
11. Add secret-free grant/revoke/adoption outcomes to existing diagnostics. Preserve or relocate every “why” comment. Keep complexity ≤10, desktop ≤9.

**Tests — RED first, DI fakes**

- Two sites both using `workspace-local`: grant A; B cannot list, guess, resolve, refresh or modify A’s credential. Include direct HTTP and forged/replayed card submissions.
- One approved grant creates a reference and no site secret; cancellation creates neither. Granting does not enable unrelated plugin/tool permissions.
- Both GitHub consumers use one entry; ambiguous tokens require selection; revocation cannot fall back to an old copy.
- Fake clock, transport and storage: concurrent refresh redeems once; rotation persists first; expired lease recovers; disconnect during refresh prevents token resurrection/use.
- Reuse the same OAuth connection from desktop and localhost without changing its client or starting another sign-in. Cover Higgsfield’s external-MCP path explicitly.
- Inject crashes at every adoption boundary; restart converges without lost secrets, extra grants or repeated refresh-token redemption.
- All export modes contain zero owner secrets, roots or grants; restore never attaches automatically.
- Later SQL integration tests exercise real concurrent handles and migration checksums. No tests, builds or servers were run for this plan.

**Cost**

- Budgets below are proposed payload limits, excluding database page/WAL overhead.
- Credential use: **operation frequency × one indexed grant/status read plus one selected credential envelope**, capped at 64 KiB; no whole-vault reads.
- Owner picker: **one read per open/explicit refresh × ≤50 metadata rows/page × ≤1 KiB/row**; no new background polling.
- Grant/revoke: **one transaction per click × selected grant/status rows**; global revoke touches that credential’s grants only.
- Refresh: **once when due per shared connection × bounded token request/response**, plus existing lease/rotation/release writes. Contending callers retain the existing bounded wait: **4 reads/second × up to 5 seconds × selected connection payload**.
- Adoption: **one bounded pass × source entries/payloads**, resumable; never repeated on a timer.

**Risks**

Cross-database adoption and OAuth client preservation are the main implementation risks. Cut over each credential only after verification; retain recovery material outside site exports, and prevent older runtimes reopening retired stores. Previously distributed copies cannot be recalled—provider rotation may still be needed. Same-user host processes remain trusted; application grants do not sandbox hostile code with filesystem access.

**Out of scope**

Remote broker/sync, new secret-manager infrastructure, provider-specific auth in core, unrelated member passwords/personal BYOK, and a root-key rotation redesign.

**Estimate**

Approximately **7–10 engineering days**, including migration recovery, both OAuth paths, UI and tests. Optional remote access is separately scoped. This plan changes no files.