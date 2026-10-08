# Jini capabilities — reuse before writing

Checked 2026-10-07 against the working tree. Find the owning entry point here, then read its linked package docs and contracts before adding behavior. This is an index; [package metadata and runtime rules](packages/README.md) and package READMEs/source maps remain the detailed references.

**Coverage:** 36 packages (35 top-level plus nested `packages/cms/forms`), 271 declared export entries; 120 entries have no direct production importer in the consumer scope below. Wildcard exports count as one declared entry.

**Used by:** direct static/dynamic imports and re-exports found with `rg` in other Jini packages and `Tovu/apps`, including type-only contract users. Tests, fixtures, generated output, examples, scripts and same-package imports are excluded. `none yet` describes that entry point in this scope; its implementation may still be used internally or through a broader barrel. Commerce imports include retained, currently unmounted host adapters.

**Runtime:** per-entry `jini.entries` first, otherwise package metadata; driver-free `db/core` and its `infra/db/core` shim are universal by source. `node (desktop)` maps the declared desktop runtime to its native host requirements. CSS/static assets use their declared runtime. `AVAILABLE, unused: keep (owner 10-07)` records the owner’s retention decision, not a deletion candidate.

## Looking for X?

| Need | Entry point to reuse | Start with |
|---|---|---|
| Human-only secret card | `@jini-ai/ui/mcp-ui/secret-card` | `defineSecretCardTool` |
| Approval or confirmation card in chat | `@jini-ai/ui/mcp-ui/surfaces` | `buildConfirmationSurface` |
| Human answer lifecycle / exchange store | `@jini-ai/daemon/surface-exchanges` | `askThenReport`, `createSurfaceExchangeStore` |
| Application confirm dialog | `@jini-ai/ui-kit/react` | `ConfirmDialog` |
| Plan / approve / execute a mutation | `@jini-ai/core/gated-mutations` | `plan`, `confirm`, `execute` |
| Draggable tab strip | `@jini-ai/ui/tab-strip` | `TabBar`, `TabStrip` |
| Simple select control | `@jini-ai/ui-kit/react` | `Select` |
| Searchable / custom rich select | `@jini-ai/ui/admin-widgets` | `Select` |
| Buttons, inputs, checkbox and switch | `@jini-ai/ui-kit/react` | `Button`, `TextField`, `Checkbox`, `Switch` |
| Menus and overlays | `@jini-ai/ui-kit/react` | `Menu`, `Dialog`, `Overlay` |
| Toasts and notices | `@jini-ai/ui-kit/react` | `ToastRegion`, `Notice` |
| Custom host component kit | `@jini-ai/ui-kit/react` | `KitProvider`, `createKit`, `extendKit` |
| Forms and anonymous submissions | `@jini-ai/cms-forms` | `submitForm`, `validateSubmissionPayload` |
| Scoped settings store and revisions | `@jini-ai/cms/settings` | `getEffective`, `SettingsRepoPort` |
| Settings HTTP / resumable feed | `@jini-ai/cms/http/settings` | `registerSettingsRoutes` |
| Async query cache / mutation hooks | `@jini-ai/ui/fetch-query` | `FetchQueryProvider`, `useFetchQuery` |
| Dirty guard / serialized writes | `@jini-ai/ui/panel-kit` | `useDirtyGuard`, `useSerialWrites` |
| Theme and color scheme | `@jini-ai/ui/theme` | `applyAdminTheme`, `resolveColorScheme` |
| Admin modules and required ports | `@jini-ai/admin/core/module` | `defineAdminModule`, `createAdmin` |
| Admin shell and navigation | `@jini-ai/admin/react/shell` | `AdminShell` |
| Schema-driven entity screens | `@jini-ai/admin/react/entities` | `createEntityPanel` |
| Outbox contracts / delivery worker | `@jini-ai/cms/core` | OutboxPort; worker exists in infra/src/events but has no public export: resolve publication with Coordinator |
| Inbound SSE decoding | `@jini-ai/agent-runtime/providers/sse-decode` | `decodeSseStream`, `decodeSseFrames` |
| Outbound SSE / HTTP route packs | `@jini-ai/http-kit` | mountPackHttp; shared SSE helpers |
| Fetch/SSE chat transport | `@jini-ai/chat/transports/fetch-sse` | `createFetchSseTransport` |
| Streaming tool turns / provider adapters | `@jini-ai/agent-runtime/providers/tool-turn` | `runProviderToolTurn` |
| OAuth + PKCE / device grants / refresh | `@jini-ai/oauth` | `createPkcePair`, `refreshAccessToken` |
| MCP server federation and reload | `@jini-ai/mcp/federation` | `buildFederatedMcpRegistrations`, `createFederationReloadCoordinator` |
| Agent Plugin install / activation / uninstall | `@jini-ai/agent-plugins/lifecycle` | `createAgentPluginLifecycle` |
| Persistent plugin memory and data | `@jini-ai/agent-plugins/persistent-state` | `createPluginMemory`, `pluginStatePaths` |
| Skills validation / installation | `@jini-ai/agentic/skills/install` | `createSkillInstaller` |
| Users, roles, grants and sessions | `@jini-ai/user-management/server` | `login`, `validateSession`, `buildIdentityRegistrations` |
| User/member/login screens | `@jini-ai/user-management/react` | `Users`, `Members`, `Login` |
| Media generation provider gateway | `@jini-ai/integrations/media-providers` | `createCapabilityRegistry`, `renderStub` |
| Media library and renditions | `@jini-ai/cms/media` | `MediaRecord`, `AssetBlobRecord` |
| Credentialed HTTP and SSRF protection | `@jini-ai/integrations/credentialed-http` | makeCredentialedRequest; pair with platform/http/guarded |
| Webhooks and delivery retries | `@jini-ai/integrations/webhooks` | `enqueueDelivery`, `processDueDeliveries` |
| SQL kernels / migrations / store copy | `@jini-ai/db/kernel` | StorageKernel; use db/migrate and db/kernel/store-copy |
| Owner-scoped chat persistence | `@jini-ai/chat/store` | ChatStore; use store/sqlite, store/pglite or store/postgres |
| Run lifecycle / tool authorization gate | `@jini-ai/daemon` | `createRunLifecycle`, `createToolExecutor` |
| Boards / asset grids / tree browsers | `@jini-ai/ui` | ResourceBoard, AssetGrid, AssetTreeBrowser; retained families below |
| Versions / revisions / iframe reuse | `@jini-ai/ui` | VersionManagerModal, RevisionDiffCard, IframeKeepAliveProvider; retained families below |

## engine · `@jini-ai/core`

kernel · [README](packages/core/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/core` | Compose typed packs and register tools; shared auth, redaction and tool-registration rules. | `token`, `bindings`, `definePack`, `createDaemon`, `createToolRegistry` | universal | Tovu: desktop, website; Jini: agent-runtime, artifacts, capability-providers, cli, cms, commerce, daemon, db, desktop-host, devops, diagnostics, http-kit, integrations, mcp, server, sidecar, ui, user-management, vibecoding |
| `@jini-ai/core/composition` | Internal authorization gate for daemon/server only; external hosts must use ToolExecutor. | `authorizeToolInvocation`, `RequiredTokenIds`, `MissingTokenIds` | universal | Jini: daemon, server |
| `@jini-ai/core/gated-mutations` | Plan, confirm and execute mutations with bound, expiring, single-use approvals. | `authorizeForHooks`, `plan`, `confirm` | universal | Tovu: website |
| `@jini-ai/core/model-facing-tool-errors` | Turn approved domain failures into safe errors a model can act on. | `forbiddenRule`, `reclassifyToolError`, `withModelFacingErrors` | universal | Tovu: website |
| `@jini-ai/core/contribution-registry` | Own a contribution collection with replacement by key and detached snapshots. | `createContributionRegistry` | universal | none yet |
| `@jini-ai/core/naming` | Find collision-free names using the host's suffix and exhaustion policy. | `deriveAvailableName`, `deriveDuplicateName` | universal | Tovu: website |
| `@jini-ai/core/primitives` | Canonical clocks, IDs, JSON, HTTP, logging, Result and lexical path containment. | `Clock`, `IdGenerator`, `JsonValue`, `HttpClientPort`, `pathContains` | universal | Tovu: website; Jini: agent-plugins, agent-runtime, agentic, analytics, chat, cms, cms-forms, commerce, daemon, db, desktop-host, devops, diagnostics, http-kit, infra, integrations, mcp, oauth, platform, protocol, registry, ui, user-management |
| `@jini-ai/core/text` | Strip terminal controls, mask secrets and bound untrusted display text. | `sanitizeUntrustedText`, `stripControlSequences` | universal | Jini: cli, mcp |

## engine · `@jini-ai/protocol`

contract · [README](packages/protocol/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/protocol` | Shared run events, lifecycle states, registry schemas and wire errors. | `RunEvent`, `RunStatus`, `EventLog`, `createApiError` | universal | Tovu: desktop; Jini: agent-runtime, agentic, daemon, http-kit, registry |

## agent · `@jini-ai/agent-runtime`

runtime · [README](packages/agent-runtime/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/agent-runtime` | Detect, launch and stream coding CLIs; ACP/pi-rpc protocols and LLM provider adapters. | `RuntimeAgentDef`, `createClaudeStreamHandler`, `probeAcpModels`, `runProviderToolTurn` | node | Tovu: desktop, website; Jini: daemon, server |
| `@jini-ai/agent-runtime/providers/tool-turn` | Run provider-neutral tool turns and normalize vendor schemas. | `providerTurnAdapters`, `runProviderToolTurn`, `googleParametersOf` | node | Tovu: website |
| `@jini-ai/agent-runtime/model-catalog/cache` | Cache discovered models per instance and merge model lists. | `ModelCatalogCache`, `unionModels` | universal | Tovu: website |
| `@jini-ai/agent-runtime/providers/sse-decode` | Decode inbound byte/text SSE frames; used internally by provider runners. | `decodeSseStream`, `decodeSseFrames`, `parseSseRecord` | universal | Jini: chat, cli |

## agent · `@jini-ai/agentic`

capability-surface · [README](packages/agentic/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/agentic` | Describe agent-addressable controls, page capabilities and WebMCP/AG-UI projections. | `PAGE_CAPABILITIES`, `agentHandle`, `executePageCapability`, `toWebMcpTools` | universal | Tovu: admin, website; Jini: admin, chat, commerce, ui, user-management |
| `@jini-ai/agentic/core` | The same framework-free agent-control vocabulary as the root. | `PAGE_CAPABILITIES`, `agentHandle`, `executePageCapability`, `toWebMcpTools` | universal | none yet |
| `@jini-ai/agentic/dom` | Execute allowlisted page actions against real DOM handles. | `createDomPageDriver`, `currentAgentPage`, `getAgentModelContext` | browser | Tovu: admin; Jini: chat |
| `@jini-ai/agentic/a2ui` | Validate and interpret A2UI messages, bindings, catalogs and surface trees. | `createA2uiInterpreter`, `createLabCatalog`, `parseAgentToRendererMessage` | universal | Tovu: website; Jini: chat, ui |
| `@jini-ai/agentic/skills/install` | Validate and install bounded skill bundles using host filesystem/archive/HTTP ports. | `decodeSkillBase64`, `validateSkillPath`, `validateSkillMarkdown` | node | none yet |
| `@jini-ai/agentic/skills/install/node` | Native bounded, no-follow filesystem adapter for skill installation. | `createNodeSkillFilesystem` | node | none yet |

## server · `@jini-ai/cli`

cli · [README](packages/cli/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/cli` | Flag parsing, daemon discovery, bounded HTTP calls and command registration. | `CommandRegistry`, `parseFlags`, `resolveDaemonUrl` | node | none yet |
| `@jini-ai/cli/introspection` | Derive CLI manifests and MCP tool schemas from the live command tree. | `introspectProgram`, `toMcpTools` | universal | Tovu: website |

## server · `@jini-ai/daemon`

runtime · [README](packages/daemon/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/daemon` | Own run lifecycle, event replay, tool execution, subprocesses and frontend/terminal bridges. | `createRunLifecycle`, `createInMemoryEventLog`, `createToolExecutor`, `createAgentExecutor` | node | Tovu: desktop, website; Jini: server |
| `@jini-ai/daemon/store/event-log/sqlite` | Durable cursor/dedupe/replay log; borrow a handle or explicitly open an owned one. | `createSqliteEventLog`, `openSqliteEventLog` | node | Jini: server, sqlite |
| `@jini-ai/daemon/store/agent-sessions` | Session-store contract and in-memory implementation. | `AgentSessionStore`, `createInMemoryAgentSessionStore` | universal | Tovu: website |
| `@jini-ai/daemon/store/agent-sessions/sqlite` | Borrowed-kernel session store plus separate rich legacy SQLite sessions. | `createSqliteAgentSessionStore`, `getAgentSession`, `LEGACY_AGENT_SESSIONS_DDL` | node | Tovu: website; Jini: server, sqlite |
| `@jini-ai/daemon/store/agent-sessions/pglite` | Persist agent session IDs through a borrowed PGlite kernel. | `createPgliteAgentSessionStore` | node | Tovu: website |
| `@jini-ai/daemon/store/agent-sessions/postgres` | Persist agent session IDs through a borrowed Postgres kernel. | `createPostgresAgentSessionStore` | node | Tovu: website |
| `@jini-ai/daemon/http` | Daemon route packs, attachments, frontend control and workspace-root policy. | `registerRunRoutes`, `registerAgentRoutes`, `JINI_ROUTE_MANIFEST` | node | Tovu: desktop, website; Jini: server |
| `@jini-ai/daemon/read-only-tools` | Fail closed on writes, including nested recovery dispatches. | `defaultDaemonMessages`, `constrainPrincipalToReadOnlyTools`, `principalIsReadOnlyConstrained` | node | Tovu: website |
| `@jini-ai/daemon/scheduler` | Inject scheduling without coupling session/run services to native timers. | `SchedulerPort` | universal | none yet |
| `@jini-ai/daemon/tool-audit` | Record tool attempts and tool-catalog audit events through injected sinks. | `describeInput`, `withToolAttemptAudit`, `searchToolsAuditDetail` | universal | none yet |
| `@jini-ai/daemon/surface-exchanges` | Bind human answers to actor/tool/channel; ask once or ask then report. | `createSurfaceExchangeStore`, `askOnce`, `askThenReport` | universal | none yet |
| `@jini-ai/daemon/session-coordination` | Coordinate conversation starts, live runs, stopping runs and session resumption. | `createLiveRunTracker`, `createConversationStartLock`, `waitForStoppingRuns` | universal | none yet |
| `@jini-ai/daemon/run-credentials` | Mint run-scoped credentials and enforce route/run ownership. | `createNodeCredentialCrypto`, `createRunScopedCredentials`, `ensureAgentDaemonToken` | node | Tovu: desktop |

## server · `@jini-ai/db`

persistence-adapter · [README](packages/db/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/db/core` | Driver-free DB operations, restore-point contracts, row parsing and SQL constants. | `DbOpsPort`, `restorePointFilename`, `parseInt8`, `row` | universal | Tovu: website; Jini: chat, daemon, infra, server, sqlite |
| `@jini-ai/db/sqlite` | Inject/open SQLite handles; inspection, integrity and restore operations. | `openSqliteConnection`, `SqliteDbOpsAdapter`, `inspectSqliteDatabase` | node | Tovu: website; Jini: chat, daemon, infra, registry, server, sqlite |
| `@jini-ai/db/pglite` | Manage an embedded Postgres owner, private socket and owner lock. | `startPgliteOwner`, `runningPgliteOwner`, `acquireOwnerLock` | node | Tovu: website |
| `@jini-ai/db/postgres` | Structural Postgres driver ports and timestamp/integer parser setup. | `pgTypesFor` | node | none yet |
| `@jini-ai/db/kernel` | Kysely storage kernel, transactions, turn locks, introspection and storage operations. | `StorageKernel`, `buildKernel`, `TurnLock` | node | Tovu: website; Jini: chat, commerce, daemon |
| `@jini-ai/db/kernel/sqlite` | Build or open SQLite kernels using host-owned drivers. | `sqliteKernel`, `openSqliteFileKernel`, `openMemorySqliteKernel` | node | Tovu: website; Jini: chat |
| `@jini-ai/db/kernel/pglite` | Build embedded PGlite kernels and copy/restore storage. | `openPgliteKernel`, `pgliteOps`, `copyServedPgliteTo` | node | Tovu: website |
| `@jini-ai/db/kernel/postgres` | Build Postgres or PGlite-socket kernels and storage operations. | `openPostgresKernel`, `openPgliteSocketKernel`, `postgresOps` | node | Tovu: website |
| `@jini-ai/db/migrate` | Apply ordered, checksum-checked migrations to the host's ledger. | `assertValidSteps`, `hasLedger`, `runMigrations` | node | Tovu: website |
| `@jini-ai/db/package.json` | Read published package metadata; static JSON, no callable exports. | `name`, `version`, `exports` metadata | node | none yet |
| `@jini-ai/db/transfer` | Plan complete snapshots and transactional Postgres COPY using explicit host layouts. | `planTransfer`, `runCopy`, `createPsqlPostgresTarget` | node | Tovu: website |
| `@jini-ai/db/tools` | Read/restore/transfer tool catalogs and handlers with injected authorization and surfaces. | `createDatabaseReadTools`, `createDatabaseTransferTools`, `createRestorePoint` | node | Tovu: website |
| `@jini-ai/db/kernel/store-copy` | Copy selected schemas between borrowed Postgres kernels after comparing ledgers. | `readCatalog`, `nonEmptyTables`, `assertLedgersAgree` | node | Tovu: website |

## server · `@jini-ai/http-kit`

transport · [README](packages/http-kit/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/http-kit` | Mount Express JSON route packs, guards and outbound SSE; opens no listener. | `defineJsonRoute`, `mountJsonRoute`, `mountPackHttp` | node | Tovu: website; Jini: daemon, server |
| `@jini-ai/http-kit/rate-limit` | Async counters, bounded request windows and explicit proxy/client-IP policy. | `createMemoryCounterStore`, `createRateLimiter`, `resolveClientIp` | node | Tovu: website |
| `@jini-ai/http-kit/middleware` | Refuse oversized parsed JSON with a host-owned error envelope. | `rejectOversizedJsonBody` | node | Tovu: website |
| `@jini-ai/http-kit/verified-origin` | Derive trusted origins from configuration evidence and validate redirect/egress targets. | `createVerifiedOrigin`, `OriginRegistry`, `normalizeOriginCandidate` | node | Tovu: website |
| `@jini-ai/http-kit/observability` | Attach request tracking to HTTP completion, including refused/unmatched requests. | `createRequestTrackingMiddleware`, `applyRequestTracking` | node | none yet |

## server · `@jini-ai/infra`

persistence-adapter · [README](packages/infra/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/infra/db/core` | Deprecated DB-contract shim; new code uses @jini-ai/db/core. | `DbOpsPort`, `restorePointFilename` | universal | none yet |
| `@jini-ai/infra/db/sqlite` | Deprecated SQLite shim; new code uses @jini-ai/db/sqlite. | `openSqliteConnection`, `SqliteDbOpsAdapter` | node | none yet |

## server · `@jini-ai/server`

host · [README](packages/server/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/server` | Compose a local daemon/listener with explicit security and memory or injected SQLite storage. | `createLocalNodeDaemon`, `composeJiniKernel` | node | none yet |
| `@jini-ai/server/storage` | Resolve backend configuration; does not select or open a driver. | `resolveSqliteBackendConfig` | node | none yet |
| `@jini-ai/server/storage/legacy/sqlite` | Explicit legacy app.sqlite acquisition and unchanged concern schema bootstrap. | `migrate`, `openDatabase`, `closeDatabase` | node | none yet |
| `@jini-ai/server/store/projects/sqlite` | Legacy project CRUD and run/awaiting-input projections on a borrowed handle. | `listProjects`, `listLatestProjectRunStatuses`, `listLatestConversationRunStatuses` | node | none yet |

## server · `@jini-ai/sqlite`

persistence-adapter · [README](packages/sqlite/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/sqlite` | Deprecated concern re-exports; use chat/daemon/registry/db owner subpaths in new code. | `createSqliteEventLog`, `createChatHistoryStore`, `searchToolCatalog` | node | none yet |

## platform · `@jini-ai/desktop-host`

host · [README](packages/desktop-host/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/desktop-host` | Desktop shell ports, host bridge, paths, logging, single instance and sidecar launch. | `DesktopHostPorts`, `getJiniHost`, `createNodeSidecarLauncher` | node (desktop) | none yet |
| `@jini-ai/desktop-host/bridge-testing` | Mock/install the desktop bridge for renderer fixtures. | `createMockJiniHost`, `installMockJiniHost` | universal | none yet |
| `@jini-ai/desktop-host/electron` | Assemble injected Electron window, protocol, shell and render-service ports. | `createElectronDesktopHost`, `createElectronRenderService` | node (desktop) | none yet |
| `@jini-ai/desktop-host/tauri` | Assemble injected Tauri ports; render service remains unimplemented. | `createTauriDesktopHost`, `createTauriRenderService` | node (desktop) | none yet |
| `@jini-ai/desktop-host/shutdown` | Track pending teardown, drain/quit decisions and shutdown signal routing. | `createShutdownTracker`, `decideBeforeQuit`, `routeQuitSignals` | node | Tovu: desktop |
| `@jini-ai/desktop-host/electron/navigation-policy` | Admit navigation/popups only within the configured shell/guest origin policy. | `isSameOrigin`, `isExternalBrowserUrl`, `installAppWindowNavigationPolicy` | node (desktop) | Tovu: desktop |
| `@jini-ai/desktop-host/electron/updates` | Coordinate updater checks, restart decisions and multi-instance presence. | `createElectronUpdaterAdapter`, `createNodeUpdateTimers` | node (desktop) | Tovu: desktop |
| `@jini-ai/desktop-host/node-toolchain` | Build/write portable Node/npm/npx shims and host-named environments. | `assertCmdQuotable`, `buildNodeToolchainShims`, `writeNodeToolchain` | node | Tovu: desktop |
| `@jini-ai/desktop-host/electron/usability` | Find-in-page, zoom, spelling menus and remembered window bounds. | `registerFindInPageIpc`, `relayFindResults`, `sendFindToggle` | node (desktop) | Tovu: desktop |
| `@jini-ai/desktop-host/speech` | Transcription contracts, PCM/WAV encoding and validated IPC/preload bridging. | `unavailablePort`, `resolveTranscriptionPort`, `encodeMonoWav` | node (desktop) | Tovu: desktop |
| `@jini-ai/desktop-host/speech/macos` | Compile/run an on-device macOS transcription helper through host ports. | `createMacOnDeviceTranscriptionPort`, `ensureHelperCompiled`, `checkAvailability` | node | Tovu: desktop |
| `@jini-ai/desktop-host/speech/macos/speech-helper.swift` | Swift runtime source asset for macOS speech; no JavaScript exports. | `speech-helper.swift` | node | Tovu: desktop |

## platform · `@jini-ai/platform`

abstraction · [README](packages/platform/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/platform` | Process supervision, PTYs, downloads, blobs, signing, readiness and asset-cache primitives. | `spawnBackgroundProcess`, `createTerminalService`, `LocalBlobStorage`, `S3BlobStorage` | node | Jini: agent-runtime, capability-providers, daemon, devops, sidecar |
| `@jini-ai/platform/fetch-with-timeout` | Fetch with bounded deadlines and a recognizable timeout error. | `fetchWithTimeout` | node | Jini: agent-runtime, integrations, registry |
| `@jini-ai/platform/secrets` | Seal secrets with AES-GCM and explicit keyrings, storage and key-rotation policy. | `AesGcmSecretSealer`, `EnvOrFileKeyring`, `FixedSiteKeyKeyring` | node | Tovu: website |
| `@jini-ai/platform/secrets/credential-sets` | Store vendor credential records and build workspace-bound encryption AAD. | `VendorCredentialSetRepoPort`, `InMemoryVendorCredentialSetRepo`, `buildVendorCredentialAad` | node | Tovu: website |
| `@jini-ai/platform/secrets/testing` | In-memory/fixed keyrings and credential repositories for fixtures. | `InMemoryKeyring`, `FixedRootKeyKeyring` | node | none yet |
| `@jini-ai/platform/http/guarded` | Guard outbound requests, validate peers/redirects and pin vetted DNS addresses. | `createHttpClient`, `classifyAddress`, `createNodeGuardedHttpPorts` | node | Tovu: website; Jini: integrations |
| `@jini-ai/platform/mail` | Mail contracts and purpose/lane gates; production delivery readiness is host-owned. | `MailerPort`, `wrapMailerWithPurposeGate` | node | Tovu: website |
| `@jini-ai/platform/mail/smtp` | SMTP adapter over an injected native transport/module and clock. | `SmtpMailerAdapter`, `createNodemailerSmtpTransport` | node | Tovu: website |
| `@jini-ai/platform/fs/guarded-reader` | Bounded filesystem reads with roots, deny rules and traversal limits. | `createNodeGuardedReaderFilesystem`, `createGuardedFileReader` | node | Tovu: website |
| `@jini-ai/platform/fs/durable-json` | Atomic JSON replacement, corruption/quarantine handling and coordinated updates. | `createNodeDurableJsonPorts`, `createDurableJsonFile`, `salvageJsonPrefix` | node | Tovu: desktop |
| `@jini-ai/platform/fs` | Atomic file/JSON writes, path containment, env-line helpers and shared file locks. | `writeFileAtomic`, `writeJsonFileAtomicAsync`, `resolvePathWithin`, `upsertEnvLine` | node | Jini: mcp, sidecar |
| `@jini-ai/platform/net` | Shared private-IP, IPv6, loopback and external-provider hostname policies. | `isPrivateAddress`, `expandIpv6`, `isLoopbackApiHost` | node | Tovu: website; Jini: agent-runtime, cli, http-kit, integrations, mcp |
| `@jini-ai/platform/net/endpoint-policy` | Browser-safe literal endpoint hostname policy; permits configured loopback without doing DNS/peer checks. | `isLoopbackApiHost`, `isBlockedExternalApiHostname` | universal | Jini: ui |
| `@jini-ai/platform/fs/file-lock` | Sync/async cross-process locks with ownership checks and stale-owner policy. | `isContendedLockError`, `isLockStale`, `withFileLockSync` | node | Tovu: website; Jini: agent-plugins |

## platform · `@jini-ai/sidecar`

process-bridge · [README](packages/sidecar/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/sidecar` | Resolve runtime/IPC paths, allocate ports, exchange NDJSON and discover live daemons. | `createJsonIpcServer`, `requestJsonIpc`, `bootstrapSidecarRuntime`, `readLiveDaemonRegistryRecord` | node | Tovu: website; Jini: cli, server |
| `@jini-ai/sidecar/respawn-policy` | Decide bounded backoff, restart or refusal after a helper-process failure. | `createRespawnPolicy` | universal | Tovu: website |
| `@jini-ai/sidecar/supervisor` | Supervise a daemon via explicit process, clock, scheduler and reporting ports. | `createDaemonSupervisor` | universal | Tovu: website |
| `@jini-ai/sidecar/supervisor/node` | Native process, registry and scheduler adapters for the supervisor. | `createSupervisorRegistry`, `createNodeDaemonProcessAdapter`, `createNodeSupervisorScheduler` | node | Tovu: website |

## chat · `@jini-ai/chat`

state · [README](packages/chat/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/chat` | Framework-free chat contracts, transcript projection and streaming parsers; same owner as core. | `ChatTransport`, `buildTranscript`, `parsePartialJson`, `parseQuestionForm` | universal | none yet |
| `@jini-ai/chat/core` | Message/transport contracts, transcripts, partial JSON, question forms and tool/artifact parsing. | `ChatTransport`, `buildTranscript`, `parsePartialJson`, `parseQuestionForm` | universal | Tovu: admin, desktop, site-chat, website |
| `@jini-ai/chat/react` | Chat hooks, composer/pane components and agentic surface cards over injected transport. | `ChatPane`, `useRunStream`, `registerToolRenderer` | browser | Tovu: admin, desktop, site-chat |
| `@jini-ai/chat/react/chat-pane` | Focused ChatPane assembly, model/agent picker and attachment/answer adapters. | `ChatPane`, `AgentRuntimePicker`, `useChatPane` | browser | Tovu: desktop |
| `@jini-ai/chat/react/styles/reference.css` | Optional reference chat stylesheet; no JavaScript exports. | stylesheet | browser | none yet |
| `@jini-ai/chat/store` | Async owner-scoped conversation/message store contracts and paging errors. | `ChatStore`, `ChatOwnerScope`, `ChatStoreError` | universal | Tovu: website |
| `@jini-ai/chat/store/sqlite` | Borrowed-kernel scoped chat store/maintenance; explicit legacy history DDL helper. | `createSqliteChatStore`, `createSqliteChatMaintenance`, `createChatHistoryStore` | node | Tovu: website; Jini: sqlite |
| `@jini-ai/chat/store/pglite` | Borrowed PGlite chat store and bounded maintenance. | `createPgliteChatStore`, `createPgliteChatMaintenance` | node | Tovu: website |
| `@jini-ai/chat/store/postgres` | Borrowed Postgres chat store and bounded maintenance. | `createPostgresChatStore`, `createPostgresChatMaintenance` | node | Tovu: website |
| `@jini-ai/chat/store/legacy` | Local-project chat session-mode vocabulary. | `ChatSessionMode` | universal | Jini: sqlite |
| `@jini-ai/chat/store/legacy/sqlite` | Synchronous legacy conversation/message CRUD and unchanged DDL. | `listConversations`, `upsertMessage`, `LEGACY_CHAT_DDL` | node | Jini: server, sqlite |
| `@jini-ai/chat/core/run-events` | Translate daemon wire events to chat events and terminal notices. | `asString`, `parseUsageEvent`, `translateRunAgentPayload` | universal | none yet |
| `@jini-ai/chat/core/ag-ui` | Project chat/run events into AG-UI and close interrupted message boundaries. | `reduceAgentWirePayload`, `createAgUiTranslationState`, `translateAgentEventToAgUi` | universal | none yet |
| `@jini-ai/chat/server/run-finalizer` | Finalize assistant runs with injected ledger, clock and daemon ports. | `createAssistantRunFinalizer` | universal | none yet |
| `@jini-ai/chat/react/embed` | Mount an embeddable chat widget with host copy and header. | `EmbedChatWidget`, `mountEmbedChat` | browser | none yet |
| `@jini-ai/chat/transports/fetch-sse` | Fetch/SSE chat transport over an injected decoder and frame mapping. | `buildJsonChatRequest`, `mapJsonChatSseFrame`, `createFetchSseTransport` | universal | none yet |
| `@jini-ai/chat/browser/session-store` | Persist embed/session state through browser storage ports. | `createBrowserSessionStore` | browser | none yet |
| `@jini-ai/chat/browser/page-actions` | Parse and consume queued navigation/page actions once before execution. | `isQueuedPageAction`, `isPageActionDirective`, `extractPageActions` | browser | none yet |

## admin · `@jini-ai/admin`

state · [README](packages/admin/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/admin` | Framework-free admin panel/route/transport contracts; same owner as core. | `AdminPanel`, `resolvePanels`, `buildNav` | universal | none yet |
| `@jini-ai/admin/core` | Panel registry, navigation, route matching, permission display rules and HTTP transport. | `AdminPanel`, `resolvePanels`, `buildNav`, `createHttpTransport` | universal | Tovu: admin |
| `@jini-ai/admin/browser` | Browser navigation, internal-link interception and shell History API wiring. | `installInternalLinkInterceptor`, `navigate`, `readRoutePath` | browser | none yet |
| `@jini-ai/admin/react` | Admin React hooks, primitives and screens; shared controls use ui-kit. | `AdminShell`, `Sidebar`, `ConfirmButton` | browser | Tovu: admin; Jini: user-management |
| `@jini-ai/admin/react/shell` | Session-gated admin shell with derived panels, navigation and assistant slot. | `AdminShell`, `useAdminShellSession` | browser | none yet |
| `@jini-ai/admin/react/entities` | Schema-driven entity list/detail/create/edit panels with injected registries. | `EntityList`, `EntityEdit`, `createEntityPanel` | browser | none yet |
| `@jini-ai/admin/browser/shell-navigation` | Query-preserving browser navigation for the admin shell. | `createAdminShellNavigation` | browser | Tovu: admin |
| `@jini-ai/admin/core/module` | Declare composable modules, required ports, routes and controller ownership. | `adminPort`, `defineAdminModule`, `createAdmin` | universal | Tovu: admin; Jini: user-management |
| `@jini-ai/admin/react/bind-react` | Bind module pages/tab views to a React renderer. | `bindReact` | browser | Tovu: admin |
| `@jini-ai/admin/react/use-controller` | Subscribe React to a module controller without reimplementing its state. | `useController` | browser | none yet |
| `@jini-ai/admin/react/overlays` | Owned overlay controller and portal host. | `createOverlayController`, `OverlayHost` | browser | Tovu: admin |
| `@jini-ai/admin/media` | Media library module, controllers and injected asset/provider ports. | `mediaModule`, `mediaApiToken`, `mediaProvidersToken` | universal | Tovu: admin |
| `@jini-ai/admin/media/react` | React media library page bound to the media module. | `media`, `useMediaPorts` | browser | Tovu: admin |
| `@jini-ai/admin/media/adapters/http` | Adapt host HTTP transport to the media API. | `createHttpMediaApi` | universal | Tovu: admin |
| `@jini-ai/admin/media/adapters/memory` | In-memory media assets/providers for fixtures and previews. | `createMemoryMediaApi`, `createMemoryMediaProviders` | universal | none yet |
| `@jini-ai/admin/media/conformance` | Media API conformance scenarios; explicit validation helper. | `runMediaApiConformance` | universal | none yet |
| `@jini-ai/admin/contracts/*` | Focused framework-free editor/menu/domain contracts; wildcard import family. | `credentialManagementToken`, `mediaPickerToken`, `playgroundRenderTargetToken` | universal | Tovu: admin |
| `@jini-ai/admin/security` | Credential/access-token/root-key module and controllers; host owns secure operations. | `securityModule`, `securityMessagesEn`, `createAccessTokensController` | universal | none yet |
| `@jini-ai/admin/security/react` | React security panels over injected security ports. | `security`, `useSecurityPorts` | browser | none yet |
| `@jini-ai/admin/security/adapters/http` | HTTP adapters for tokens, other credentials and root keys. | `createHttpSecurityApi`, `createHttpOtherCredentials`, `createHttpRootKey` | universal | none yet |
| `@jini-ai/admin/security/adapters/memory` | In-memory security APIs for fixtures and previews. | `createMemorySecurityApi`, `createMemoryOtherCredentials`, `createMemoryRootKey` | universal | none yet |
| `@jini-ai/admin/security/conformance` | Security API conformance scenarios; explicit validation helper. | `runSecurityApiConformance` | universal | none yet |
| `@jini-ai/admin/playground` | Playground target/state controller and module with mount-readiness rules. | `playgroundModule`, `createPlaygroundController`, `canMountPlayground` | universal | none yet |
| `@jini-ai/admin/playground/react` | React playground module view with injected target ports. | `playground`, `usePlaygroundPorts` | browser | none yet |
| `@jini-ai/admin/playground/adapters/http` | Advertise the playground's HTTP support contract. | `playgroundHttpSupport` | universal | none yet |
| `@jini-ai/admin/playground/adapters/memory` | In-memory playground target adapter. | `createMemoryPlaygroundTargets` | universal | none yet |
| `@jini-ai/admin/playground/conformance` | Playground API conformance scenarios; explicit validation helper. | `runPlaygroundApiConformance` | universal | none yet |
| `@jini-ai/admin/source-control` | Source-control module, provider/credential models and controller. | `sourceControlModule`, `createSourceControlController`, `sourceControlApiToken` | universal | none yet |
| `@jini-ai/admin/source-control/react` | React repository/source-control settings module. | `sourceControl`, `useSourceControlPorts` | browser | none yet |
| `@jini-ai/admin/source-control/adapters/http` | Adapt host HTTP transport to source-control operations. | `createHttpSourceControlApi` | universal | none yet |
| `@jini-ai/admin/source-control/adapters/memory` | In-memory source-control adapter. | `createMemorySourceControlApi` | universal | none yet |
| `@jini-ai/admin/source-control/conformance` | Source-control API conformance scenarios; explicit validation helper. | `runSourceControlApiConformance` | universal | none yet |
| `@jini-ai/admin/agent-plugins` | Agent-plugin administration module, state and activation contracts. | `agentPluginsModule`, `createAgentPluginsController`, `AgentPluginsState` | universal | none yet |
| `@jini-ai/admin/agent-plugins/react` | React plugin list/details/activation views. | `agentPlugins`, `useAgentPluginsPorts` | browser | none yet |
| `@jini-ai/admin/agent-plugins/adapters/http` | HTTP adapter for plugin administration. | `createHttpAgentPluginsApi` | universal | none yet |
| `@jini-ai/admin/agent-plugins/adapters/memory` | In-memory plugin administration adapter. | `createMemoryAgentPluginsApi` | universal | none yet |
| `@jini-ai/admin/agent-plugins/conformance` | Agent-plugin API conformance scenarios; explicit validation helper. | `runAgentPluginsApiConformance` | universal | none yet |

## ui · `@jini-ai/ui`

react-library · [README](packages/ui/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/ui` | Reusable React features: boards/assets/versions/browser chrome, dialogs, menus, dropzones and i18n. | `ResourceBoard`, `AssetGrid`, `TabbedDialog`, `CommandPalette` | browser | Tovu: admin; Jini: admin, chat |
| `@jini-ai/ui/core` | Framework-free feature rules/ports for settings, agents, connectors, media and memory. | `ExecutionPort`, `DetectedAgent`, `resolveInitialActiveTabId` | universal | Tovu: admin |
| `@jini-ai/ui/sketch-editor` | Excalidraw sketch integration with save/export/theme/DOM orchestration. | `SketchEditor`, `SketchScene` | browser | none yet |
| `@jini-ai/ui/lexical-rich-text-editor` | Lexical editor, atomic mention tokens, caret layers and string serialization. | `RichTextInput`, `serializeRichText`, `MentionEntity` | browser | none yet |
| `@jini-ai/ui/html-editor` | Interactive HTML canvas/editor integration and injected editor tools. | `InteractiveHtmlEditor`, `useInteractiveHtmlEditor` | browser | Tovu: admin; Jini: admin |
| `@jini-ai/ui/mcp-ui` | Host official MCP-UI iframes with lifecycle, messaging and tool-call coordination. | `McpUiHost`, `useMcpUiHost` | browser | Jini: chat |
| `@jini-ai/ui/mcp-ui/surfaces` | Build forms/approval cards and bind confirmation answers without React. | `buildFormSurface`, `buildConfirmationSurface`, `buildOutcomeSurface`, `createConfirmationStore` | universal | Tovu: admin, website |
| `@jini-ai/ui/mcp-ui/secret-card` | One shared prepare/form/save/report lifecycle for human-only secret cards. | `defineSecretCardTool` | universal | none yet |
| `@jini-ai/ui/interactive-ui` | Render registered interactive component families with optional Radix/chart peers. | `DEFAULT_INTERACTIVE_UI_REGISTRY`, `NativeDataTable`, `ShadcnDataTable` | browser | Jini: chat |
| `@jini-ai/ui/interactive-ui/manifests` | Framework-free component manifests and prop schemas for tool builders. | `ALL_MANIFESTS`, `InteractiveComponentManifest` | universal | Tovu: website |
| `@jini-ai/ui/a2ui` | React A2UI rendering and interpreter/catalog integration. | `A2uiSurfaceRenderer`, `createA2uiInterpreter`, `buildA2uiCatalogFromRegistry` | browser | Jini: chat |
| `@jini-ai/ui/renderers` | Artifact renderer registry, Markdown/media/code and sandboxed HTML previews. | `RendererRegistry`, `createDefaultRendererRegistry`, `renderMarkdownToSafeHtml` | browser | Tovu: admin |
| `@jini-ai/ui/interactive-ui.css` | Interactive surface styling; no JavaScript exports. | stylesheet | browser | none yet |
| `@jini-ai/ui/settings-dialog.css` | Settings-dialog shell/tab styling; no JavaScript exports. | stylesheet | browser | Tovu: admin |
| `@jini-ai/ui/tabbed-dialog.css` | Generic tabbed-dialog styling; no JavaScript exports. | stylesheet | browser | none yet |
| `@jini-ai/ui/remixicon.css` | Remix icon styling; no JavaScript exports. | stylesheet | browser | none yet |
| `@jini-ai/ui/admin-widgets` | Rich select, info tips, expandable content, image previews and coming-soon widgets. | `Select`, `InfoTip`, `SeeMore`, `ImagePreviewModal` | browser | Tovu: admin; Jini: admin, user-management |
| `@jini-ai/ui/panel-kit` | Focus/dirty/async/serial-write helpers, timestamp formatting and panel infrastructure. | `useFocusTrap`, `useDirtyGuard`, `useSerialWrites`, `formatTimestamp` | browser | Tovu: admin; Jini: commerce, user-management |
| `@jini-ai/ui/fetch-query` | Owned query cache/provider, cached loaders, mutations and invalidation hooks. | `FetchQueryProvider`, `useFetchQuery`, `useFetchMutation`, `useCachedLoader` | browser | Tovu: admin |
| `@jini-ai/ui/tab-strip` | Shared draggable/reorderable/closable tab strip, tabs and drag hooks. | `TabBar`, `TabStrip`, `TabStripItem`, `useTabStripDragReorder` | browser | Tovu: admin |
| `@jini-ai/ui/admin-widgets.css` | Admin widget styling; no JavaScript exports. | stylesheet | browser | Tovu: admin |
| `@jini-ai/ui/theme` | Validate/apply palettes, fonts and density; resolve user/system color scheme. | `AdminTheme`, `validateAdminTheme`, `applyAdminTheme`, `resolveColorScheme` | browser | Jini: admin |
| `@jini-ai/ui/styles/*` | Shared style assets including variables.css and admin.css; wildcard family. | `variables.css`, `admin.css` | browser | none yet |

Retained families exported from `@jini-ai/ui` (root); these are features, not additional package export subpaths.

| Family / source | What it does | Key exports | Runtime | Used by |
|---|---|---|---|---|
| [resource-dashboard](packages/ui/src/features/resource-dashboard/index.ts) | Kanban/grid/row resource lists and run history | `ResourceBoard`, `ResourceRowList` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [asset-grid](packages/ui/src/features/asset-grid/index.ts) | Search/facets, timeline, multi-select and bulk actions | `AssetGrid`, `useAssetGridSelection` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [asset-tree-browser](packages/ui/src/features/asset-tree-browser/index.ts) | Folder navigation, rename, upload and preview | `AssetTreeBrowser`, `useAssetTreeNavigation` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [version-manager](packages/ui/src/features/version-manager/index.ts) | Version selection, preview and guarded restore | `VersionManagerModal`, `VersionRestoreControl` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [browser-chrome](packages/ui/src/features/browser-chrome/index.ts) | Embeddable browser navigation/history and viewport controls | `BrowserViewportControls`, `useBrowserNavigationStack` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [revision-review](packages/ui/src/features/revision-review/index.ts) | Proposed-change diff and revision history | `RevisionDiffCard`, `RevisionHistoryList` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| [iframe-pool](packages/ui/src/features/iframe-pool/index.ts) | Bound mounted iframe count and park/LRU-evict inactive frames | `IframeKeepAliveProvider`, `PooledIframe` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |

## ui · `@jini-ai/ui-kit`

state · [README](packages/ui-kit/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/ui-kit` | Framework-free component contract, agent attrs, guarded confirmation controller and toasts. | `KIT_CONTRACT`, `createConfirmController`, `createToastService`, `needs` | universal | Jini: user-management |
| `@jini-ai/ui-kit/react` | Injectable component facades, provider, overlays, guarded confirmation and toast region. | `KitProvider`, `Button`, `Select`, `ConfirmDialog`, `Tabs`, `Menu` | browser | Tovu: admin; Jini: admin, user-management |
| `@jini-ai/ui-kit/react/native` | Native default implementations of the 16 implemented kit controls. | `nativeKit` | browser | none yet |
| `@jini-ai/ui-kit/react/native/styles.css` | Optional native kit stylesheet in jini.kit layer; no JavaScript exports. | stylesheet | browser | none yet |
| `@jini-ai/ui-kit/react/testing` | Conformance scenarios and React adapter driver; no browser verification implied. | `kitConformanceScenarios`, `runKitConformance`, `reactConformanceDriver` | browser | none yet |

## capability · `@jini-ai/analytics`

analytics · [README](packages/analytics/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/analytics` | Privacy-bounded visitor-hit normalization/ingestion, daily salts and storage ports. | `ingestHit`, `normalizeIngestContext`, `deriveDailySalt`, `LocalBufferSink` | node | Tovu: website |

## capability · `@jini-ai/artifacts`

artifact-store · [README](packages/artifacts/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/artifacts` | Artifact-store port, manifests, publication/regression guards and streaming text suppression. | `ArtifactStore`, `createInMemoryArtifactStore`, `assertArtifactPublicationAllowed`, `createTaggedTextSuppressor` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/artifacts/node` | Find earlier artifact files and evaluate regressions using bounded filesystem reads. | `findPriorArtifactSiblings`, `evaluateArtifactStubGuard` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |

## capability · `@jini-ai/capability-providers`

provider-adapters · [README](packages/capability-providers/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/capability-providers` | Swappable auth/storage/payments/document-store/realtime ports and DI tokens. | `AuthProvider`, `StorageProvider`, `PaymentsProvider`, `DbProvider`, `RealtimeProvider` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/visitor-auth` | Visitor auth provider definitions and public credential-field/catalog metadata. | `planVisitorAuthAuthorization`, `evaluateVisitorAuthCallback`, `validateVisitorAuthIdentityClaims` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/unsafe-reference` | Non-production stubs; auth stores plaintext and payment stubs always succeed. | `createInMemoryAuthProvider`, `createInMemoryStorageProvider`, `createInMemoryPaymentsProvider` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/adapters/ws` | WebSocket realtime pub/sub over injected server/socket interfaces. | `createWebSocketRealtimeProvider` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/adapters/sqlite` | Document-record provider over a borrowed SQLite handle. | `SqliteDbProvider` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/adapters/blob-storage` | Namespace-scoped provider over platform Local/S3 BlobStorage. | `BlobStorageProvider` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/adapters/jwt-auth` | HS256 sessions and scrypt passwords; users remain in process memory. | `JwtAuthProvider` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/capability-providers/adapters/stripe` | Stripe REST charges/refunds with explicit credentials and fetch ports. | `StripePaymentsProvider`, `StripePaymentsProviderError` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |

## capability · `@jini-ai/cms`

content-model · [README](packages/cms/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/cms` | Content kernel contracts and services; same framework-free owner as core. | `executeCommand`, `EventBusPort`, `OutboxPort` | universal | none yet |
| `@jini-ai/cms/core` | Content events/outbox contracts, audited commands, registries and domain ports. | `executeCommand`, `EventBusPort`, `OutboxPort` | universal | Tovu: website; Jini: cms-forms, commerce |
| `@jini-ai/cms/navigation` | Navigation trees, target validation and audited navigation mutations. | `createNavMenuReadModel`, `menuVersionConflictError`, `createMenu` | universal | Tovu: website |
| `@jini-ai/cms/media` | Media/rendition services, blob storage, transforms and journaled garbage collection. | `MediaRecord`, `AssetBlobRecord`, `computeBlobStorageKey` | node | Tovu: website |
| `@jini-ai/cms/settings` | Scoped settings definitions/defaults, revisions, changes and change feeds. | `getEffective`, `InMemorySettingsRepo`, `SettingsRepoPort` | universal | Tovu: admin, website |
| `@jini-ai/cms/workspace` | Workspace validation, creation and lifecycle through host repositories. | `createWorkspace`, `validateWorkspaceNameAndSlug`, `updateWorkspace` | universal | Tovu: website |
| `@jini-ai/cms/entries` | Validate and author/update content entries with explicit content-type/actor context. | `listEntries`, `validateFieldsAgainstSchema`, `selectVisibleEntryFields` | universal | Tovu: website |
| `@jini-ai/cms/content-types` | Define fields, storage/index policy and content-type schema transitions. | `isContentTypeFieldKind`, `isIndexableFieldKind`, `listContentTypes` | universal | Tovu: website |
| `@jini-ai/cms/taxonomy` | Terms, hierarchies and content associations with cycle/scope checks. | `wouldCreateCycle`, `validateContentJoin`, `validateHierarchyAssignment` | universal | Tovu: website |
| `@jini-ai/cms/presentation` | Presentation/theme selection through host settings repositories. | `getPresentationSettings`, `setActiveTheme` | universal | Tovu: website |
| `@jini-ai/cms/core/tools` | CMS-specific tool permission helpers over host authorization. | `requireToolPermission`, `adaptLegacyAuthorize` | universal | none yet |
| `@jini-ai/cms/media/import` | Bound and validate outbound image downloads and sniffed content. | `parseImportUrl`, `buildImportFilename`, `validateImageBytes` | universal | Tovu: website |
| `@jini-ai/cms/http/settings` | Mount settings routes and resumable change feed with host paths/security. | `resolveTargetWorkspaceId`, `resolveUserLayerReadTarget`, `respondToSettingsError` | node | Tovu: website |
| `@jini-ai/cms/trash` | Soft delete, restore and leased purge/sweep using host entity adapters. | `computePurgeAfter`, `createTrashService`, `bindForgetRemovedEntity` | universal | Tovu: website |

## capability · `@jini-ai/cms-forms`

content-model · [README](packages/cms/forms/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/cms-forms` | Validate configurable forms; audited definitions, anonymous submissions and notify subscribers. | `validateSubmissionPayload`, `createFormDefinition`, `submitForm`, `registerFormNotifySubscriber` | universal | Tovu: website |

## capability · `@jini-ai/commerce`

commerce · [README](packages/commerce/README.md) · [source map](packages/commerce/source-map.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/commerce` | Catalog/checkout/webhook inbox/status mapping; commerce remains off in production composition. | `checkout`, `ingestProviderEvent`, `toSiteProducts`, `readCommerceStatus` | universal | Tovu: website |
| `@jini-ai/commerce/repo` | Borrowed Kysely catalog repositories; host owns unchanged commerce tables. | `commerceProductRepoFor`, `commercePriceRepoFor`, `commerceOrderRepoFor` | node | Tovu: website |
| `@jini-ai/commerce/payments` | Payment provider registry, credentials, charges/refunds/webhooks and recovery. | `createPaymentProviderRegistry`, `activateLipay`, `webhookUrlFor` | node | Tovu: website |
| `@jini-ai/commerce/store` | Sample stock/checkout activation; retained host adapters are currently unmounted. | `activateStore` | node | Tovu: website |
| `@jini-ai/commerce/http` | Mount explicitly opted-in raw-byte signed payment webhooks before JSON parsing. | `registerPaymentsWebhookRoute` | node | none yet |
| `@jini-ai/commerce/react` | Unregistered read-only Payments overview with host-injected locale. | `Payments` | browser | none yet |
| `@jini-ai/commerce/tools` | Explicit opt-in read-only commerce status tool contributor. | `contributeCommerceGetStatusTools` | universal | none yet |

## capability · `@jini-ai/devops`

devops · [README](packages/devops/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/devops/source-control` | Trusted provider catalog, repository validation, export preview and commit orchestration. | `repositoryTargetError`, `validateCommitTarget`, `createSourceControlProviderKit` | node | none yet |
| `@jini-ai/devops/static-export` | Export routes/assets through manifest/app/writer ports with bounded failure reports. | `firstExportFailure`, `createExportFetchAdapter` | node | none yet |
| `@jini-ai/devops/static-export/node` | Native loopback-app, artifact-writer and theme-asset inventory adapters. | `createNodeArtifactWriter`, `createNodeAppFactory`, `createNodeAssetSource` | node | none yet |
| `@jini-ai/devops/packaging/electron` | Stage/verify desktop dependencies, reachable imports, archive bytes and freshness. | `treeQuietProblems`, `isBundleInput`, `shellStalenessFailure` | node | none yet |
| `@jini-ai/devops/packaging/electron/typescript` | Parse imports with a host-supplied TypeScript AST module. | `createTypeScriptImportReader` | node | none yet |
| `@jini-ai/devops/agent-jobs` | Run bounded CLI jobs with resume, stdin prompts, raw logs and streamed completion. | `parseCodexRun`, `buildCodexInvocation`, `runAgentJobs` | node | none yet |
| `@jini-ai/devops` | Domain marker only; import the implemented capability subpaths. | none (domain marker) | node | none yet |
| `@jini-ai/devops/deploy` | DeployTarget seam, guarded publish tool and host-owned hosting modules; no vendor. | `DeployTarget`, `DeployTargetToken`, `publishDeploy`, `createDeployPublishToolRegistration` | node | Tovu: website |
| `@jini-ai/devops/checks/published-types` | Check published type surfaces, registry drift, links and captured compiler logs. | `registryDependencies`, `parseDiagnosticBlocks`, `check` | node | none yet |
| `@jini-ai/devops/checks/coverage` | Parse LCOV and assess floors, diffs, inventory and baseline contamination. | `pct`, `toRepoRelative`, `isIntegrationTestFile` | node | none yet |
| `@jini-ai/devops/checks/node` | Explicit filesystem/process/environment/installer adapters for checks. | `createNodeFilesystem`, `createNodeEnvLoader`, `createNodeProcessRunner` | node | none yet |
| `@jini-ai/devops/local-dev` | Load host env files and inspect/coordinate listener ports. | `loadRepoRootEnvFile`, `parseLsofListeners`, `listenersOn` | node | Tovu: website |
| `@jini-ai/devops/deploy/node` | Native guarded, DNS-pinned reachability adapters for deployment. | `createNodeReachabilityPorts` | node | Tovu: website |

## capability · `@jini-ai/memory`

memory-store · [README](packages/memory/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/memory` | Durable indexed Markdown notes, extraction logs, verification scorecards and strict-JSON LLM calls. | `createNoteStore`, `extractFacts`, `enforceVerify`, `callLlmProviderForJson` | node | none yet |

## capability · `@jini-ai/registry`

registry · [README](packages/registry/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/registry` | Resolve versioned registry content via static/GitHub/SQL backends; verify signatures. | `StaticRegistryBackend`, `GithubRegistryBackend`, `DatabaseRegistryBackend`, `verifyRegistrySignature` | node | none yet |
| `@jini-ai/registry/tool-catalog` | Shared descriptor/search query contracts for the tool catalog. | `ToolCatalogEntry`, `ToolCatalogQuery`, `ToolCatalogSearchHit` | universal | Jini: sqlite |
| `@jini-ai/registry/tool-catalog/sqlite` | Atomic tool catalog reseeding and FTS5/BM25 search on a borrowed handle. | `ensureToolCatalogTables`, `reseedToolCatalog`, `getToolCatalogEntry` | node | Jini: server, sqlite |
| `@jini-ai/registry/tool-catalog-builder` | Build/search a catalog using host sources, storage and enrichment policy. | `createLiveToolCatalogQuery`, `listToolCatalogEntries` | universal | Tovu: website |
| `@jini-ai/registry/tool-catalog-builder/sqlite` | Borrowed SQLite storage factory for the catalog builder. | `createSqliteCatalogStoreFactory` | node | Tovu: website |

## capability · `@jini-ai/sandbox`

execution-adapter · [README](packages/sandbox/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/sandbox/core` | Backend-neutral boot/files/commands/process/preview/teardown contracts and categorized errors. | `SandboxProviderPort`, `SandboxSession`, `SandboxOperationError` | universal | none yet |
| `@jini-ai/sandbox/e2b` | Remote E2B microVM adapter, binary files, processes and a Vite starter; optional SDK. | `createE2bSandboxProvider`, `wrapE2bSandbox`, `DEFAULT_VITE_REACT_TEMPLATE` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/sandbox/node-worker` | Bounded per-call worker execution with entry paths, codecs, clocks and resource budgets. | `runInWorkerSandbox`, `renderInWorkerSandbox`, `createNodeWorkerFactory` | node | Tovu: website |

## capability · `@jini-ai/user-management`

user-management · [README](packages/user-management/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/user-management` | Identity records, repositories, grants, permission vocabulary and domain errors. | `PrincipalRecord`, `SessionRecord`, `permissionCatalog` | universal | Tovu: website |
| `@jini-ai/user-management/server` | Authentication, sessions, authorization, administration, hashing, seeding and tool registrations. | `login`, `validateSession`, `buildIdentityRegistrations`, `Argon2PasswordHasher` | node | Tovu: website |
| `@jini-ai/user-management/react` | Login/Users/Members screens and hooks with host session/workspace/API ports. | `Login`, `Users`, `Members`, `useUsers` | browser | Tovu: admin |
| `@jini-ai/user-management/react/testing` | Fake login/users/roles/members ports for fixtures. | `createFakeLoginPort`, `createFakeUsersPort`, `createFakeRolesPort` | browser | none yet |
| `@jini-ai/user-management/admin` | Composable roles/policies administration module and controller rules. | `rolesModule`, `rolesApiToken`, `createRolesController` | universal | none yet |
| `@jini-ai/user-management/admin/react` | Lazy roles/users/members/auth module views using ui-kit. | `rolesKitNeeds`, `roles`, `usersKitNeeds` | browser | none yet |
| `@jini-ai/user-management/admin/adapters/http` | HTTP adapters for roles, users, members and authentication. | `createHttpRolesApi`, `createHttpUsersApi`, `createHttpMembersApi` | universal | none yet |
| `@jini-ai/user-management/admin/adapters/memory` | In-memory identity admin APIs and safety fixtures. | `createMemoryRolesApi`, `createMemoryUsersSafety`, `createMemoryUsersApi` | universal | none yet |
| `@jini-ai/user-management/admin/conformance` | Roles/users/members/auth API conformance scenarios. | `runRolesApiConformance`, `runUsersApiConformance`, `runMembersApiConformance` | universal | none yet |

## capability · `@jini-ai/vibecoding`

authoring · [README](packages/vibecoding/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/vibecoding` | Validated conversational edits, whole-artifact checks and undo snapshots; same owner as core. | `EditTarget`, `applyEdits`, `createEditHistory` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/vibecoding/core` | EditTarget port, edit application, correction feedback and bounded edit history. | `EditTarget`, `applyEdits`, `createEditHistory` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/vibecoding/html` | Address tagged regions of one HTML document with an injected parser/store. | `createHtmlRegionTarget`, `isValidRegionHandle` | universal | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/vibecoding/html/node` | parse5-backed region parser and whole-document validation for Node hosts. | `createParse5RegionParser`, `isValidRegionHandle` | node | none yet · **AVAILABLE, unused: keep (owner 10-07)** |
| `@jini-ai/vibecoding/react` | Subscribable edit sessions, tool registrations and parts/preview/workbench components. | `createVibecodingSession`, `createVibecodingToolRegistrations`, `PartsViewer`, `VibecodingWorkbench` | browser | none yet · **AVAILABLE, unused: keep (owner 10-07)** |

## integration · `@jini-ai/integrations`

vendor-integration-gateway · [README](packages/integrations/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/integrations/media-providers` | Generate images/video/audio through vendor gateway, policy, staging and task stores. | `renderStub`, `createCapabilityRegistry`, `createSqliteMediaTaskStore` | node | Tovu: website |
| `@jini-ai/integrations/media-providers/catalog` | Browser-safe provider/model capability catalog with no vendor dispatch. | `findProvider`, `findMediaModel`, `modelsForSurface` | universal | Tovu: admin, website |
| `@jini-ai/integrations/credentialed-http` | Bind credentials to permitted origins and send audited/redacted guarded requests. | `makeCredentialedRequest`, `buildAuthorizationHeader`, `resolveRequestTarget` | node | Tovu: website |
| `@jini-ai/integrations/webhooks` | Manage subscriptions, signed deliveries, independent retries and envelope storage ports. | `createSubscription`, `enqueueDelivery`, `processDueDeliveries`, `signPayload` | node | Tovu: website |

## integration · `@jini-ai/mcp`

protocol-adapter · [README](packages/mcp/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/mcp` | Serve MCP tools/resources; config/token storage and external-agent install planning. | `createMcpToolServer`, `RUN_TOOLS`, `readMcpConfig`, `planAgentInstall` | node | Tovu: desktop, website |
| `@jini-ai/mcp/tools/ask-choice` | Ask human choices with schema, select/question builders and bound answer tickets. | `createAskChoiceTool`, `createAskChoiceAnswerTicketStore` | universal | Tovu: website |
| `@jini-ai/mcp/federation` | Admit federated servers; sessions, trust, fingerprints, reload and call orchestration. | `connectMcpHttpSession`, `buildFederatedMcpRegistrations` | node | Tovu: website |
| `@jini-ai/mcp/federation/approvals` | Human confirmation, remembered approvals, revocation and safe destructive-call rules. | `buildFederatedCallConfirmSpec`, `createFederatedCallConfirmer`, `rosterRefusalFor` | node | Tovu: website |
| `@jini-ai/mcp/federation/stdio` | Launch stdio sessions with child environment, CWD and trusted toolchain resolution. | `resolveStdioChildCwd`, `keepStderrTail`, `createStderrTail` | node | Tovu: website |
| `@jini-ai/mcp/federation/testing` | In-memory approvals/sessions and scripted transports; some production hosts use memory repos. | `InMemoryMcpSession`, `InMemoryExternalMcpToolApprovalRepo`, `createInMemoryConversationToolApprovalStore` | universal | Tovu: website |
| `@jini-ai/mcp/bin` | Explicit stdio serve entry for one run; importing the root never launches it. | `serve` | node | none yet |

## integration · `@jini-ai/oauth`

protocol-client · [README](packages/oauth/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/oauth` | OAuth discovery/registration, code+PKCE/device grants, refresh and token/cache orchestration. | `createPkcePair`, `beginAuthorizationCode`, `refreshAccessToken`, `discoverAuthorizationServer` | node | Tovu: website; Jini: agent-runtime |
| `@jini-ai/oauth/testing` | In-memory pending-state, registration and token stores. | `createPendingAuthorizationStore`, `createMemoryClientRegistrationCache`, `createMemoryTokenStore` | node | none yet |
| `@jini-ai/oauth/discovery-policy` | Enforce exact issuer/origin binding on advertised OAuth endpoints. | `createIssuerBoundDiscoveryPolicy` | node | none yet |
| `@jini-ai/oauth/dns-pinned-transport` | Validate resolved/literal IPs and pin guarded OAuth connections through host dispatcher ports. | `createDnsPinnedOAuthTransport` | node | none yet |

## tooling · `@jini-ai/agent-plugins`

plugin-packaging · [README](packages/agent-plugins/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/agent-plugins` | Validate portable Agent Plugins manifests and expose standard path/schema constants. | `isMcpManifest`, `isPluginManifest`, `validatePluginManifest` | universal | none yet |
| `@jini-ai/agent-plugins/ui-ux-design/*` | Bundled installable plugin JSON/Markdown/static skill assets; no callable exports. | `plugin.json`, `mcp.json`, `skills/*/SKILL.md` | universal | none yet |
| `@jini-ai/agent-plugins/lifecycle` | Install/activate/uninstall plugins with locks, bundles, digests, trust and MCP provisioning ports. | `createAgentPluginLifecycle`, `createAgentPluginActivations`, `createAgentPluginLayout` | node | Tovu: website; Jini: admin |
| `@jini-ai/agent-plugins/lifecycle/node` | Native filesystem/process effects for plugin lifecycle. | `createNodeAgentPluginEffects` | node | Tovu: website |
| `@jini-ai/agent-plugins/lifecycle/yauzl` | ZIP archive reader over a host-supplied optional yauzl module. | `createYauzlAgentPluginArchiveReader` | node | Tovu: website |
| `@jini-ai/agent-plugins/manifest` | Strict plugin/MCP manifest parsing and namespace metadata readers. | `parseAgentPluginManifest`, `parseAgentPluginMcpConfig`, `readAgentPluginExtension` | universal | none yet |
| `@jini-ai/agent-plugins/persistent-state` | Locked plugin-owned memory/data paths and Layout B migration; state survives uninstall by default. | `pluginStatePaths`, `createPluginMemory`, `migratePluginLayout` | node | Tovu: website |

## tooling · `@jini-ai/diagnostics`

diagnostics · [README](packages/diagnostics/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/diagnostics` | Collect logs and build one redacted diagnostics ZIP with machine/app manifest. | `buildDiagnosticsZip`, `redactText`, `collectLogSources` | node | none yet |
| `@jini-ai/diagnostics/redaction/secrets-only` | Apply secret-only telemetry policy over core's canonical secret shapes. | `redactSecretShapes`, `SECRET_PATTERNS` | universal | Tovu: website; Jini: chat |
| `@jini-ai/diagnostics/observability` | Resolve runtime telemetry configuration and track requests/spans through ports. | `createObservabilityPort`, `resolveObservabilityConfig`, `createNoopObservabilityPort` | universal | Tovu: website |
| `@jini-ai/diagnostics/observability/node` | AsyncLocalStorage span scope for Node request tracing. | `createAsyncLocalSpanScope` | node | none yet |
| `@jini-ai/diagnostics/web-evidence` | Capture bounded page structure, network/storage/cookie evidence with trusted host URLs. | `collectPageStructure`, `collectPageEvidence`, `normalizeSitePath` | universal | Tovu: website |
| `@jini-ai/diagnostics/web-evidence/playwright` | Adapt injected Playwright browser operations to web evidence capture. | `openPlaywrightSiteEvidenceBrowser` | node | Tovu: website |
| `@jini-ai/diagnostics/domain-dns` | Bounded public DNS/TLS/domain diagnostics over explicit resolver/network ports. | `readPublicDomain`, `readPublicDnsName`, `createDomainDnsChecks` | node | Tovu: website |

## tooling · `@jini-ai/plugins`

plugin-packaging · [README](packages/plugins/README.md)

| Entry point | What it does | Key exports / assets | Runtime | Used by |
|---|---|---|---|---|
| `@jini-ai/plugins/glue` | Validate host attachment vocabulary and gate/dispatch contributed capabilities; host loader is not implemented. | `validateGlueManifest`, `resolveCallSiteDispatch`, `buildGlueCapabilityGate` | universal | none yet |
