# AI Assistant admin routes

Server-framework-neutral `defineJsonRoute` specs for the AI Assistant admin section: the public
assistant settings (`GET`/`PUT .../assistant/settings`), the workspace's site credential and the
calling admin's own execution credential (`GET`/`PUT`/`DELETE .../site-credential` and
`.../execution-credential`), the "Execution mode" probes (`POST .../execution/test-agent`,
`.../execution/detect-agents`, `.../execution/test-connection`, `.../execution/models`) and the
visitor-tools admin pair (`GET`/`PUT .../visitor-tools`).
`execution-request-fields.ts` is the shared body parsing for the BYOK probe routes, and
`stored-credential-probe.ts` is their single key/endpoint chokepoint (which key a probe sends, and
the endpoint pin for a stored, write-only key).

## Wiring

- **Needs injected** — each spec's own small deps type (`GetAssistantSettingsRouteDeps`,
  `PutAssistantSettingsRouteDeps`, `GetSiteCredentialRouteDeps`, `PutSiteCredentialRouteDeps`,
  `DeleteSiteCredentialRouteDeps`, `GetExecutionCredentialRouteDeps`,
  `PutExecutionCredentialRouteDeps`, `DeleteExecutionCredentialRouteDeps`, `TestAgentRouteDeps`,
  `DetectAgentsRouteDeps`, `TestConnectionRouteDeps`, `ListModelsRouteDeps`,
  `ListVisitorToolsRouteDeps`, `ConfigureVisitorToolsRouteDeps`):
  the host's credential/settings services already bound to the workspace, the
  `adminAssistantPermission` name, an error classifier returning `AssistantCredentialErrorKind`,
  the 503 copy naming the deployment's site-key setting, and `detectAgents`. The execution probes
  also take the detection snapshot reader + pending sample (`readDetectedAgents`,
  `isDiscoveryPending` — the host's cache is built once, at registration), the two
  stored-credential readers (`resolveStoredSiteCredential`, `resolveStoredAdminCredential` — the
  latter keyed by the SESSION principal the spec passes), the provider probes
  (`testProviderConnection`, `listProviderModels`, already bound to the host's DNS/transport seams;
  the connection probe also to its redirect refusal) and the host's empty-key copy
  (`noServerKeyMessage`). Visitor tools take the management service (`visitorToolsManagement`,
  `undefined` ⇒ redacted 500; it owns `visitor-tools.manage` authorization and revision checks) and
  `visitorToolsErrorKind`, which classifies the host's revision-conflict and policy-validation
  errors. Plus the host's
  `JsonRoutePorts`: `workspace` (404 on a foreign workspace), `authenticate` (supplies
  `AssistantRoutePrincipal`), `authorize` (403) and `onError` (redacted 500).
- **Provides** — the route specs, `resolveTestAgentOutcome` (pure CLI-check verdict) and the
  shared helpers in `shared.ts`.
- **Host wiring**:

  ```ts
  mountJsonRoute({ app, spec: { ...putSiteCredentialRoute, ports: adminPorts }, deps: {
    workspaceId, authorize,
    adminAssistantPermission: "admin.assistant.manage",
    setSiteCredential: ({ patch }) => credentials.set({ workspaceId, ...patch }),
    siteCredentialErrorKind: (e) => (e instanceof MyValidationError ? "validation" : undefined),
    secretStoreUnconfiguredError: "the secret store is not configured — set MY_SITE_KEY",
  } });
  ```
- **Bound by** — the host's AI Assistant composition modules (the execution-probe module mounts the
  four probes; the settings module mounts settings, credentials and visitor tools). The host's
  registrar deps slices and registrar types stay host-side in those modules: they are Express- and
  host-`RouteDeps`-shaped composition, not part of the route contract.
- **Never imports** — a server framework, `@jini-ai/agent-runtime` implementations (the detector is
  injected; only the core `DetectedAgent` type is used), or any host service, error class,
  environment-variable name or product copy.

Why the boundary sits here: [DR-005](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
