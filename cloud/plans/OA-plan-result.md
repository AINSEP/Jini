Software Architect(Direct): I loaded and applied the Software Architect, Programmer, and TDD skill files.

**1. Goal**

Connect an OAuth account once on this Mac, grant sites references to it, refresh it centrally, and let the owner disconnect every granted site.

**2. Findings**

- Both clones report `merge-1029`; their uncommitted work was treated as input. Graph MCP tools are unavailable, so verification used bounded source searches and reads.
- The earlier trim correctly separates OAuth from phase 1. Today’s picker explicitly rejects OAuth, so enabling sharing requires a deliberate extension: [service.ts:24](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/service.ts:24).
- Reuse the existing owner database, transaction, site UUID grants and selected-row lookups. No additional database is needed: [project-store.ts:244](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/project-store.ts:244), [attachments.ts:34](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/attachments.ts:34).
- Site references currently hold only `{credentialId}`. OAuth also needs a binding from the consuming API connection/MCP server to that credential: [site-references.ts:18](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/site-references.ts:18).
- The existing consumer vault intentionally refuses writes. Do **not** widen it to let sites refresh owner credentials: [attached-vault.ts:37](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/project-keys/attached-vault.ts:37).
- Jini already supplies encrypted token storage, owner/client binding, a 30-second durable lease and generation fencing: [vault-token-store.ts:20](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/integrations/src/api-connections/token-store/vault-token-store.ts:20). Its refresher persists rotation before returning: [refresh.ts:91](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/oauth/src/refresh.ts:91).
- API connections currently resolve clients and tokens within each site. Simply changing the vault would retain the wrong identity/client assumptions: [host.ts:185](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/host.ts:185).
- External MCP has separate site-local token persistence and leases. Shared connections must bypass those paths: [external-mcp-oauth.ts:787](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/external-mcp/external-mcp-oauth.ts:787), [external-mcp-oauth.ts:960](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/external-mcp/external-mcp-oauth.ts:960).
- Reuse MCP’s existing per-call gate and fresh HTTP bearer supplier: [external-mcp-oauth.ts:196](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/external-mcp/external-mcp-oauth.ts:196), [adapter.http.ts:123](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/federation/adapter.http.ts:123).
- **UNVERIFIED runtime risk:** the refresher loads before acquiring its lease and then refreshes that earlier value. A delayed acquirer could redeem an already-rotated token: [refresh.ts:127](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/oauth/src/refresh.ts:127).
- Existing disconnect already disables the connection before provider revocation and preserves disabled credentials for retry: [account-actions.ts:139](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/integrations/src/api-connections/account-actions.ts:139).
- Saved-key capture is already closed. Preserve it and test actual OAuth export/import paths, including the archive helper that passes plugin-state rows through: [saved-keys.ts:23](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-backup/saved-keys.ts:23), [vault-stores.ts:225](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/vault-stores.ts:225).
- Chapters 13/14 and project memory are absent from the clone; I consulted their `/Users/la/Programming/Tovu/` copies. Runtime behavior and test results remain **UNVERIFIED**; nothing was changed or run.

**3. Ordered implementation plan**

Paths below use **T** = Tovu clone and **J** = Jini clone. Line estimates exclude tests unless stated.

1. **Represent shared connections and expose a narrow consumption port.**
   - Files: J `packages/integrations/src/api-connections/{shared.ts,types.ts,index.ts}`; T `features/api-connections/vault-stores.ts`, `features/project-keys/site-references.ts`.
   - Reuse credential-sets and existing `api-connection` rows. Keep lifecycle record, token row and sealed issuing context in the owner store; the site stores only its consumer binding and credential ID.
   - Preserve issuer, exact endpoint/resource, client ID/authentication/secret, scopes and known account identity. Never reconstruct the issuing client from the consuming site’s settings.
   - The Jini consumer accepts injected grant/storage ports, checks grant before and after token acquisition, and exposes access tokens/status only. Cache one refresher per owner connection **per process**; the durable lease coordinates processes. Do not cache authorization.
   - Public additions take `(requiredObj, optionalObj)`. No new package, database or SQL migration is expected: the existing project schema already admits `api-connection` rows ([migration:27](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/migrations/project/0001_project_credential_kinds.ts:27)).
   - **Size:** +180–260 / −10–25; tests +180–260.
   - **Proof:** contract tests for two sites sharing `workspace-local`, guessed IDs, wrong plugin/resource/client, missing scopes, grant removal during refresh, and absence of refresh tokens in site storage.
   - **Cannot be smaller:** a grant alone cannot identify which consumer uses which connection; exposing the owner vault would cross the existing security boundary.

2. **Make the reused refresher safe for delayed lease acquisition.**
   - Files: J `packages/oauth/src/refresh.ts`, `tests/token-refresh.test.ts`; extend existing token-store security tests.
   - First reproduce the race with barriers: B loads; A refreshes and releases; B acquires. After acquisition, reload and re-evaluate expiry before redeeming.
   - Carry the saved resource and scopes through the shared refresh adapter; retain current timeouts, polling and persist-before-return behavior.
   - **Size:** +20–45 / −5–15; tests +100–160.
   - **Proof:** exactly one redemption across that schedule; rotation saved before return; persistence failure returns no token; expired lease recovery; disconnect during refresh prevents subsequent use.
   - **Cannot be smaller:** sharing increases cross-process contention, and the lease alone does not invalidate a token loaded before acquisition.

3. **Add explicit shared sign-in and reuse to desktop API connections.**
   - Files: T `features/api-connections/{host.ts,connect.ts,surface-connections.ts}`, `features/project-keys/service.ts`, `features/custom-credentials/credential-copy-tool.ts`, composition wiring.
   - Extend the existing owner card with “Use a saved connection” and an explicit shared destination for new sign-ins. Keep existing local sign-ins and phase-1 precedence.
   - The existing approval binds owner, site UUID, consumer and selected entry; validate compatibility again on submission. Complete shared sign-in directly into owner storage, then grant it.
   - Write the inert site binding before committing the owner grant. A partial failure leaves an unused reference, never a secret copy or unauthorized grant.
   - Show whether local or shared credentials are effective. A failed/revoked shared selection cannot silently select another account.
   - **Size:** +110–190 / −25–55; tests +180–260.
   - **Proof:** one sign-in serves two approved sites; a third site is denied; canceled/forged/replayed cards grant nothing; local connections remain unchanged; a second site’s BYO client cannot replace the issuing client.
   - **Cannot be smaller:** silent adoption or changing all existing sign-ins to shared would violate the requested behavior.

4. **Wire external MCP through the same owner connection.**
   - Files: T `features/external-mcp/{external-mcp-oauth.ts,contracts.ts}`, `assistant/external-mcp-connection-source.ts`, `assistant/mcp-federation/bootstrap.ts`, affected composition roots.
   - Inject shared persistence/resolution into existing discovery, registration and completion flows. Shared client secrets and tokens go directly to owner storage; retain the local path for existing local connections.
   - Bind shared callbacks/device completions to their destination and generation, so disconnect supersedes unfinished authorization.
   - Capture connection identity in each HTTP token-supplier closure; URL alone is insufficient. Extend the existing gate to check live shared authorization.
   - For stdio, reuse roster reload/reconnect when its injected access token changes; gate future calls even while an old child remains open.
   - **Size:** +140–220 / −30–70; tests +220–320.
   - **Proof:** authorization-code and device flows; two server IDs using one owner credential; distinct credentials at the same URL; refresh without another sign-in; already-open HTTP/stdio sessions denied after revocation; automatic stdio renewal.
   - **Cannot be smaller:** boot-time token injection cannot enforce disconnect or refresh an already-open session.

5. **Add “Stop using here” and owner-only “Disconnect everywhere.”**
   - Files: T `features/project-keys/service.ts`, owner lifecycle adapter, `cli/commands/owner-store.ts`, desktop owner-store contracts/IPC/preload and `renderer/SharedKeys*`.
   - Site disconnect removes its grant only. Global disconnect uses Jini’s existing lifecycle; wrap the stopping record CAS and `attachments.removeKey` in one owner transaction, before provider traffic.
   - Keep stale site references inert. Retry provider revocation explicitly through the existing pending state; a provider failure never restores local access. Existing site controls must not accidentally call global disconnect.
   - Reuse plugin revoke hooks or Jini’s guarded revocation helper where supported. Clearly distinguish “stopped on every site on this Mac” from provider revocation confirmation.
   - **Size:** +150–240 / −10–30; tests +180–280.
   - **Proof:** detach A leaves B working; global disconnect stops both; stale approval/callback/refresh cannot restore access; restart preserves pending revocation; IPC rejects forged fields; owner confirmation shows affected sites.
   - **Cannot be smaller:** deletion currently refuses in-use keys ([owner-store.ts:158](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/cli/commands/owner-store.ts:158)); global disconnect is a distinct, explicitly confirmed action.

6. **Prove the complete path in the later cloud container.**
   - Files: extend existing project-store, API-host, MCP-revocation, portability and desktop render/IPC suites; add focused shared-OAuth integration fixtures.
   - Test with the changed Jini packages actually consumed by Tovu; merely checking out both repositories does not replace npm dependencies.
   - Use two independent handles/processes against the real owner SQLite database. Also exercise PostgreSQL-backed site bindings; PostgreSQL alone cannot prove the desktop lease.
   - Verify ZIP/backup/import paths contain no owner tokens, client secrets or grants. Imported references confer no authority; narrowly exclude the new binding namespace where needed.
   - **Size:** production +0–25 / −0–15; tests +180–280.
   - **Proof:** sign in once → grant A/B → concurrent expiry → one refresh → revoke A → disconnect everywhere → restart → export/import. Run relevant regressions and complexity checks: desktop ≤9, elsewhere ≤10.
   - **Cannot be smaller:** mocked stores cannot prove cross-process CAS, and unit tests cannot establish export exclusion or composition coverage.

**4. Added I/O cost**

Planning estimates, excluding SQLite pages/WAL and existing provider API traffic. Let **B** = binding bytes, **G** = grant result bytes, **R** = lifecycle record bytes, **C** = sealed context bytes, **E** = token-envelope bytes; actual sizes are **UNVERIFIED**.

| Operation | Frequency × payload/work |
|---|---|
| Owner picker | Each open/explicit refresh × ≤50 metadata rows; fetch usage for the selected connection only |
| Shared token use | Each token request × approximately `B + 2G + 3R + C + E`; selected rows, no vault scan |
| MCP call gate | Each gate invocation × `B + G + R`; confirmations can invoke it twice |
| New shared sign-in | Once per explicit attempt × context write, existing attempt write/consume, and existing fenced record/token installation |
| Grant | Each approval × binding read/CAS write + owner record/grant validation + one grant insert |
| Stop here | Each click × selected-grant validation + one grant delete; no provider request |
| Refresh winner | Once when due per owner connection × existing lease/persist/release I/O + **one added reload**; one provider request |
| Lease contender | Existing 250 ms polling for ≤5 seconds: ≤20 × `(R + E)` per waiting caller; no background polling |
| Global disconnect | Each confirmation × selected record read/CAS + delete that connection’s grants; provider success then deletes tokens/updates status |
| Revocation retry | Each explicit Retry × selected disabled credential reads + one provider request; no retry worker |
| stdio renewal | Each actual token change × existing close/reload/handshake; lease-only changes must not restart it |

Provider OAuth response bodies already have a 64 KiB bound: [bounded-json.ts:3](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/oauth/src/bounded-json.ts:3). CAS conflicts can repeat selected-row operations; instrument the integration tests to report counts and bytes.

**5. Exclusions and cuts**

- No boot migration, existing-token adoption, copy cleanup, silent removal, remote access or self-hosted support.
- Independent old local connections remain independent; global confirmation must state this limit. Requests already sent may finish.
- No new broker, daemon, database, lease table, scheduler or replacement OAuth implementation.
- **CUT-CANDIDATES:** multi-account management, shared account switching, cross-protocol credential matching, provider-specific revocation additions, bulk adoption and usage dashboards. Park them.
- No schema change is planned. Any unavoidable change must be a new ADR-066 TS migration, never an edit to published migrations.

**6. Effort and dependencies**

**24–36 hours of Codex work**, including tests and integration fixes: steps 1/2 about 5–7h, step 3 about 4–6h, step 4 about 6–9h, step 5 about 4–6h, step 6 about 5–8h. Steps 3–5 depend on the shared contract; final verification depends on all steps and Tovu consuming the changed Jini build.

**7. Owner questions**

None block this plan. Recommendation: make sharing an explicit choice, keep existing local connections intact, and label the global action “Disconnect this shared connection from every site on this Mac.”