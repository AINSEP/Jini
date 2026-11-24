# AI Assistant admin routes

Server-framework-neutral `defineJsonRoute` specs for the AI Assistant admin section: the public
assistant settings (`GET`/`PUT .../assistant/settings`), the workspace's site credential and the
calling admin's own execution credential (`GET`/`PUT`/`DELETE .../site-credential` and
`.../execution-credential`), the "Execution mode" probes (`POST .../execution/test-agent`,
`.../execution/detect-agents`, `.../execution/test-connection`, `.../execution/models`) and the
visitor-tools admin pair (`GET`/`PUT .../visitor-tools`).
`get-chat-attachment.ts` is the one non-JSON route here: a core `ServerRoute` factory
(`createChatAttachmentReadRoute`) for `GET /api/attachments/:ref`, which streams a staged chat
attachment's bytes back to its uploader (sniffed type, forced download for HTML, `Range`).
`execution-request-fields.ts` is the shared body parsing for the BYOK probe routes and
`execution-shared.ts` the probes' shared authorization, request reading and verdict logic
(`resolveTestAgentOutcome`). Which key a probe sends, and the endpoint pin for a stored,
write-only key, is the HOST's credential chokepoint, injected as `resolveProbeCredential`.

## Wiring

- **Needs injected** — each spec's own small deps type (`AssistantGetSettingsRouteDeps`,
  `AssistantPutSettingsRouteDeps`, `AssistantGetSiteCredentialRouteDeps`,
  `AssistantPutSiteCredentialRouteDeps`, `AssistantDeleteSiteCredentialRouteDeps`,
  `AssistantGetExecutionCredentialRouteDeps`, `AssistantPutExecutionCredentialRouteDeps`,
  `AssistantDeleteExecutionCredentialRouteDeps`, `AssistantTestAgentRouteDeps`,
  `AssistantDetectAgentsRouteDeps`, `AssistantTestConnectionRouteDeps`,
  `AssistantListModelsRouteDeps`, `VisitorToolsListRouteDeps`, `VisitorToolsConfigureRouteDeps`):
  the host's settings/credential read and write functions already bound to the workspace, the
  permission name, the agent detector and probes (already bound to the host's DNS/transport seams),
  the stored-credential chokepoint (`resolveProbeCredential`, keyed by the SESSION principal the
  spec passes) and the visitor-tools management port. Plus the host's `JsonRoutePorts`:
  `workspace` (404 on a foreign workspace), `authenticate`, `authorize` (403) and `onError`
  (redacted 500).
- **Chat attachment read** (`ChatAttachmentReadRouteDeps`) — `readAttachment` (the host's
  owner-scoped reader, bound to its upload directory), `ownerIdOf` (the session principal from the
  request locals; throws when the session gate did not run), `sniffContentType`, `parseRangeHeader`
  (the host binds `@jini-ai/http-kit/range`'s), the host media route's `disallowedInlineContentTypes`
  and `svgContentSecurityPolicy`, and `failureResponse` (the host's redacted admin 500 as a web
  `Response`). The host mounts it through `@jini-ai/http-kit/node-bridge`'s `createNodeDispatcher`
  behind its session gate on the `/api/attachments` prefix; a host whose previous route answered
  through Express's `res.send` also keeps that ETag/304 behaviour in its mount.
- **Provides** — the route specs, `toExecutionTabAgent` (the detected-agent wire projection),
  `resolveTestAgentOutcome` (pure CLI-check verdict) and the shared helpers in `shared.ts` and
  `execution-shared.ts`.
- **Bound by** — the host's AI Assistant composition modules (the execution-probe module mounts the
  four probes; the settings module mounts settings, credentials and visitor tools; the assistant
  module mounts the chat attachment read through a small binding module beside it). The host's
  registrar deps slices and registrar types stay host-side in those modules: they are Express- and
  host-`RouteDeps`-shaped composition, not part of the route contract.
- **Never imports** — a server framework, `@jini-ai/agent-runtime` implementations (the detector is
  injected; only a structural detected-agent type is used), or any host service, error class,
  environment-variable name or product copy.

Why the boundary sits here: [DR-005](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
