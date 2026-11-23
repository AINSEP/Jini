# AI Assistant admin routes

Server-framework-neutral `defineJsonRoute` specs for the AI Assistant admin section: the public
assistant settings (`GET`/`PUT .../assistant/settings`), the workspace's site credential and the
calling admin's own execution credential (`GET`/`PUT`/`DELETE .../site-credential` and
`.../execution-credential`), and the per-agent CLI check (`POST .../execution/test-agent`).
`execution-request-fields.ts` is the shared body parsing for the BYOK probe routes.

## Wiring

- **Needs injected** — each spec's own small deps type (`GetAssistantSettingsRouteDeps`,
  `PutAssistantSettingsRouteDeps`, `GetSiteCredentialRouteDeps`, `PutSiteCredentialRouteDeps`,
  `DeleteSiteCredentialRouteDeps`, `GetExecutionCredentialRouteDeps`,
  `PutExecutionCredentialRouteDeps`, `DeleteExecutionCredentialRouteDeps`, `TestAgentRouteDeps`):
  the host's credential/settings services already bound to the workspace, the
  `adminAssistantPermission` name, an error classifier returning `AssistantCredentialErrorKind`,
  the 503 copy naming the deployment's site-key setting, and `detectAgents`. Plus the host's
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
- **Never imports** — a server framework, `@jini-ai/agent-runtime` implementations (the detector is
  injected; only the core `DetectedAgent` type is used), or any host service, error class,
  environment-variable name or product copy.

Why the boundary sits here: [DR-005](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
