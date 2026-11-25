# Route classification: public-http + admin-http (Worker J, slug x6-route-classify)

Source: planner `outnow/blocked.json` (151 files in these areas) + `outnow/keep.json` (14 already-agreed STAYS-HOST) + 7 files on disk in neither list (marked in notes). Total 172 non-test .ts files under `apps/website/src/server/inbound/{public-http,admin-http}`. Read-only pass: no repo file touched.

Legend. **K1-CONVERT** = registers Express routes; logic becomes a Jini spec, the Tovu registrar + mount stay host. Tag in brackets: READY = convertible now (no missing Jini edge, only standard host ports/type-only blockers); EDGE x = destination `@jini-ai/cms` depends only on `@jini-ai/core`, so it lacks edge to x (convert in the owner package or add the edge); BLOCKER y = Tovu value import that must move or be injected first. SEC = security-sensitive family. **BLOCKED** = no routes; pure helper held up by another file or a missing edge. Route counts are `app.<verb>(` registrations (plus mount calls where noted).

| file (relative to apps/website/src/server/inbound/) | class | one-line reason |
|---|---|---|
| admin-http/admin-dev-proxy.ts | STAYS-HOST | host glue: reads TOVU_ADMIN_DEV_PROXY_URL / SEA packaging env (host copy, K3) |
| admin-http/admin-json-route-ports.ts | STAYS-HOST | host ports every Jini spec mounts through; K1 template: shared composition, a family conversion never edits it |
| admin-http/admin-raw-route-ports.ts | STAYS-HOST | host raw-route ports (template 9.3); same seam as the JSON ports |
| admin-http/admin-request-facts.ts | STAYS-HOST | host port: request facts over Tovu shared/request-facts + local-admin-request |
| admin-http/admin-static.ts | STAYS-HOST | already agreed STAYS-HOST (rv1124a): serves the built admin SPA |
| admin-http/authorize-guard.ts | STAYS-HOST | already agreed STAYS-HOST (rv1123s): authorize-then-403 host gate |
| admin-http/dev-auth.ts | STAYS-HOST | owner/admin session auth for the admin origin (tovu_session cookie, x-tovu-desktop-owner-signin, boot-session glue); host auth wiring over user-management SEC |
| admin-http/http/api-keys.ts | BLOCKED | BLOCKED (missing edge cms->user-management): api-key response DTOs; owner @jini-ai/user-management admin-http/http (mirrors http/users) or core contracts per template 2.1 SEC |
| admin-http/http/plugin-hook-error.ts | STAYS-HOST | Tovu binding of the Jini PLUGIN_HOOK_FAILED envelope over @tovu/contracts/secret-redaction (host binding) |
| admin-http/http/presentation.ts | BLOCKED | BLOCKED via apps/website/src/features/presentation/index.ts (24 lines) |
| admin-http/http/widgets.ts | STAYS-HOST | Express adapter: res.status().json over cms widget error mapping + dev-auth getAuthedPrincipal + authorize-guard |
| admin-http/local-admin-request.ts | STAYS-HOST | already agreed STAYS-HOST (rv1123s): same-machine request fact |
| admin-http/owner-mfa-routes.ts | K1-CONVERT | (family owner-auth, 2 regs) [EDGE user-management + BLOCKER modules/owner-auth value (ownerMfaDepsFrom)] owner authenticator enroll/confirm/remove; admission/origin/rate-limit are host; owner @jini-ai/user-management (admin-http/owner/mfa-deps exists) SEC |
| admin-http/owner-passkey-routes.ts | K1-CONVERT | (family owner-auth, 2 regs) [EDGE user-management + BLOCKER modules/owner-auth value] owner passkey routes; same shape as owner-mfa SEC |
| admin-http/owner-recovery-routes.ts | K1-CONVERT | (family owner-auth, 2 regs) [EDGE user-management + BLOCKER modules/owner-auth value + local-admin-request] owner recovery routes; x-tovu-desktop-owner-signin literal stays host SEC |
| admin-http/publish-trust-auth.ts | BLOCKED | BLOCKED (missing edge cms->integrations, secrets): destination-side publish-trust gate (app.use /api/admin middleware half stays host; trust grant/keys already in cms/publish/trust) SEC |
| admin-http/routes/agent-plugins/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/agent-plugins/install-response.ts | BLOCKED | BLOCKED (tovu-dep shared/admin-failure.ts + missing edge cms->agent-plugins): pure install-upload response builders; owner @jini-ai/agent-plugins |
| admin-http/routes/analytics/recent-hits.ts | K1-CONVERT | (family analytics, 1 reg) [EDGE analytics + BLOCKER server/error-mapping/respond.ts value] admin recent-hits read; owner @jini-ai/analytics admin-http |
| admin-http/routes/api-keys/create-principal.ts | K1-CONVERT | (family api-keys, 1 reg) [EDGE user-management] POST principals; owner @jini-ai/user-management SEC |
| admin-http/routes/api-keys/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host (api-keys service-deps mapping) |
| admin-http/routes/api-keys/issue.ts | K1-CONVERT | (family api-keys, 1 reg) [EDGE user-management] POST issue api key; owner @jini-ai/user-management SEC |
| admin-http/routes/api-keys/revoke.ts | K1-CONVERT | (family api-keys, 1 reg) [EDGE user-management] POST revoke api key; owner @jini-ai/user-management SEC |
| admin-http/routes/assistant/stored-credential-probe.ts | BLOCKED | BLOCKED via assistant/index.ts + modules/assistant-execution (value): BYOK probe key/URL chokepoint, no routes SEC |
| admin-http/routes/external-mcp/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/external-mcp/guard.ts | STAYS-HOST | Express workspace+authorize gate over host authorize-guard (Express adapter) |
| admin-http/routes/external-mcp/oauth.ts | K1-CONVERT | (family external-mcp, 6 regs) [EDGE oauth+integrations+mcp] operator OAuth start/device poll/sign-in link; minor Tovu copy; owner @jini-ai/oauth or integrations admin-http SEC |
| admin-http/routes/external-mcp/probe.ts | K1-CONVERT | (family external-mcp, 1 reg) [EDGE mcp] POST probe one MCP server; owner @jini-ai/mcp admin-http |
| admin-http/routes/forms/authoring.ts | K1-CONVERT | (family forms, 1 reg) [READY] PUT authoring; only std host deps (route-guards, admin-failure, authorize-guard); cms forms already holds the rest |
| admin-http/routes/forms/create.ts | K1-CONVERT | (family forms, 1 reg) [READY] POST create form; imports only cms/forms* |
| admin-http/routes/forms/delete-submission.ts | K1-CONVERT | (family forms, 1 reg) [READY] DELETE submission; resolve-definition already in cms |
| admin-http/routes/forms/deps.ts | STAYS-HOST | already agreed STAYS-HOST (host bag) |
| admin-http/routes/forms/forms-write-error.ts | STAYS-HOST | Express adapter writing forms/core errors to res (header says so); can disappear once the 3 hand-written routes convert |
| admin-http/routes/fs-files/custom-root.ts | K1-CONVERT | (family fs-files, 3 regs) [READY] GET/PUT/DELETE chat folder root; cms/fs-files modules exist SEC |
| admin-http/routes/fs-files/folder-picker.ts | K1-CONVERT | (family fs-files, 2 regs) [READY (inject isLocalAdminRequest as a dep)] GET/POST native folder picker; host same-machine fact passed as dep SEC |
| admin-http/routes/media/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/media/list.ts | K1-CONVERT | (family media, 1 reg) [BLOCKER features/media/public-urls value] GET media list; public-urls helper must move or be injected |
| admin-http/routes/media/original.ts | K1-CONVERT | (family media, 1 reg) [BLOCKER shared/media-original-writer value + EDGE http-kit range] GET original bytes (raw/stream, template 9.3) |
| admin-http/routes/media/route-guards.ts | STAYS-HOST | Express request guards + failure responses shared by admin media routes (Express adapter) |
| admin-http/routes/media/stored-media-response.ts | BLOCKED | BLOCKED via apps/website/src/features/media/public-urls.ts (27 lines) |
| admin-http/routes/members/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/newsletter/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/plugins/chart-providers.ts | K1-CONVERT | (family plugins, 2 regs) [EDGE ui + BLOCKER assistant/index.ts value] chart provider asset routes (2 verb + 2 use); owner @jini-ai/plugins or ui |
| admin-http/routes/plugins/install.ts | K1-CONVERT | (family plugins, 1 reg) [EDGE plugins (type-only modules/plugins blocker)] POST install / install zip upload (non-JSON, template 9.3); runs plugin code on install |
| admin-http/routes/plugins/local-installer.ts | STAYS-HOST | composition glue over modules/plugins + host-signals (19 lines) |
| admin-http/routes/posts/template-preview-render.ts | BLOCKED | BLOCKED via modules/content (value), platform/routing, features/theme, public-http site render-context (+ edge user-management); stays with preview chain |
| admin-http/routes/posts/template-preview.ts | K1-CONVERT | (family posts, 2 regs) [READY (type-only modules/content blocker; render injected)] GET+POST template preview on one path; 247 lines |
| admin-http/routes/publish-content/blobs-probe.ts | K1-CONVERT | (family publish-content, 1 reg) [READY] POST blobs probe; cms/media + blob-staging + admin-http/limits already in cms |
| admin-http/routes/publish-content/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host (content-publish ports, type-registry) |
| admin-http/routes/publish-content/import-errors.ts | BLOCKED | BLOCKED (missing edge cms->plugins): import error->HTTP map over PluginHookFailedError; owner @jini-ai/plugins or inject mapper |
| admin-http/routes/publish-content/peer-transport.ts | K1-CONVERT | (family publish-content, 3 regs) [READY] peer push plan/confirm/execute; cms peers modules exist; credentialed peer push is publish-trust adjacent SEC |
| admin-http/routes/publish-content/route-helpers.ts | STAYS-HOST | Express glue shared by the publish-content route files (Express adapter) |
| admin-http/routes/settings/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/settings/events.ts | K1-CONVERT | (family settings, 1 reg) [READY (SSE via ServerRoute / http-kit node-bridge, host adapter in old position)] GET settings events SSE stream, 421 lines |
| admin-http/routes/settings/shared.ts | STAYS-HOST | host plumbing for settings registrars incl. @tovu/contracts/assistant-subagents-policy (Tovu product policy) |
| admin-http/routes/sites/sites-home.ts | K1-CONVERT | (family sites, 1 reg) [EDGE platform (fs) + type-only platform/site-dir] PUT sites config |
| admin-http/routes/sites/warm-site-control.ts | STAYS-HOST | dev-host glue: tovu dev warm-site delegation, dev-tls, product-root (Tovu product literals) |
| admin-http/routes/system/custom-credentials.ts | K1-CONVERT | (family system, 2 regs) [EDGE devops+integrations] GET/PUT custom provider credentials; owner @jini-ai/integrations SEC |
| admin-http/routes/system/dockerfile-source.ts | K1-CONVERT | (family system, 2 regs) [EDGE devops] GET/PUT Dockerfile source; owner @jini-ai/devops |
| admin-http/routes/system/mail-providers.ts | K1-CONVERT | (family system, 1 reg) [EDGE integrations+user-management] PUT mail provider credential (K1 STOP leftover); owner @jini-ai/integrations |
| admin-http/routes/system/publish-credentials.ts | K1-CONVERT | (family system, 1 reg) [EDGE devops] GET publish-credential list; owner @jini-ai/devops SEC |
| admin-http/routes/system/publish-site.ts | K1-CONVERT | (family system, 2 regs) [EDGE devops] POST publish to static host + destinations GET; 426 lines; owner @jini-ai/devops |
| admin-http/routes/system/site-imports.ts | K1-CONVERT | (family system, 5 regs) [EDGE devops] site import list/create/upload/owner-setup (owner step is auth-adjacent); owner @jini-ai/devops |
| admin-http/routes/system/site-key.ts | K1-CONVERT | (family system, 6 regs) [EDGE integrations+user-management+platform + BLOCKER platform/db/key-dependent-data, site-dir value] site key generate/reveal/import/start-fresh; ~/.tovu/site-keys path literal; 622 lines; owner @jini-ai/integrations SEC |
| admin-http/routes/system/site-share-password.ts | K1-CONVERT | (family system, 1 reg) [EDGE devops] POST share password; Tovu 'Saved keys' copy; owner @jini-ai/devops SEC |
| admin-http/routes/system/site-shares.ts | K1-CONVERT | (family system, 2 regs) [EDGE devops] share download + artifact upload tokens; .tovu.zip artifact name; owner @jini-ai/devops SEC |
| admin-http/routes/system/sites.ts | STAYS-HOST | internal /internal/dev-warm-site dev route + `tovu serve` host lifecycle (Tovu product + local-site-host) |
| admin-http/routes/taxonomy/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/themes/explore.ts | BLOCKED | BLOCKED via modules/content (value) + features/theme/preview-policy; 577-line Express helpers behind Explore routes, no registrations |
| admin-http/routes/themes/held-back.ts | BLOCKED | BLOCKED via features/theme/held-back-themes + held-back-choice + dev-auth: already mounts 4 routes through mountAdminJsonRoute, spec logic still bound to Tovu feature |
| admin-http/routes/themes/preview.ts | K1-CONVERT | (family themes, 1 reg) [BLOCKER features/sites + theme-preview-host value] GET theme preview card image |
| admin-http/routes/users/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| admin-http/routes/widgets/preview-render.ts | STAYS-HOST | host binding over Jini resolveWidgetPreviewIr using features/theme rendering + public render-document shell |
| public-http/http/members.ts | BLOCKED | BLOCKED (missing edge cms->user-management): public member DTO + MEMBER_SESSION_COOKIE name; owner @jini-ai/user-management SEC |
| public-http/http/site/bare-page.ts | BLOCKED | BLOCKED via public-http/http/site/render/page-body.ts |
| public-http/http/site/form-feedback-policy.ts | STAYS-HOST | already agreed STAYS-HOST (host copy, K3) |
| public-http/http/site/form-wire-policy.ts | STAYS-HOST | already agreed STAYS-HOST (host copy: tovu_form_flash / data-tovu-* wire names, K3) |
| public-http/http/site/handlebars-render.ts | BLOCKED | BLOCKED via render/blocks.ts (-> render/content-html.ts, doc-render-host) |
| public-http/http/site/handlebars-sandbox.ts | BLOCKED | BLOCKED via http/site/worker-sandbox.ts (host theme budgets/paths) |
| public-http/http/site/handlebars-worker.ts | BLOCKED | BLOCKED via handlebars-render.ts |
| public-http/http/site/liquid-render.ts | BLOCKED | BLOCKED via render/blocks.ts (-> render/content-html.ts, doc-render-host) |
| public-http/http/site/liquid-sandbox.ts | BLOCKED | BLOCKED via http/site/worker-sandbox.ts (host theme budgets/paths) |
| public-http/http/site/liquid-worker.ts | BLOCKED | BLOCKED via liquid-render.ts |
| public-http/http/site/render-site.ts | BLOCKED | BLOCKED (missing edge cms->cookie-consent) + features/theme value deps (renderStaticPage, resolveTemplateId); owner @jini-ai/cookie-consent for the script-asset half |
| public-http/http/site/render/blocks.ts | BLOCKED | BLOCKED via render/content-html.ts |
| public-http/http/site/render/components/entry-lists.ts | BLOCKED | BLOCKED via render/template-render-data.ts |
| public-http/http/site/render/components/marketing.ts | STAYS-HOST | Tovu marketing component copy bound to doc-render-host (host copy, K3) |
| public-http/http/site/render/components/registry.ts | STAYS-HOST | Tovu component registry literals (data-tovu-*, TOVU_DOC_NODE_HOST) (host copy, K3) |
| public-http/http/site/render/content-html.ts | STAYS-HOST | binds Tovu doc/widget render hosts (TOVU_DOC_NODE_HOST) + data-tovu-* literals (host copy, K3) |
| public-http/http/site/render/document-shell.ts | BLOCKED | BLOCKED via features/theme/token-aliases.ts |
| public-http/http/site/render/page-body.ts | BLOCKED | BLOCKED via render/content-html.ts |
| public-http/http/site/render/post-body.ts | BLOCKED | BLOCKED via render/page-body.ts |
| public-http/http/site/render/site-assistant-mount.ts | STAYS-HOST | Tovu site-assistant mount markup + product-root path (host copy, K3) |
| public-http/http/site/render/template-render-data.ts | BLOCKED | BLOCKED (missing edge cms->commerce); owner @jini-ai/commerce |
| public-http/http/site/seo-render-context.ts | BLOCKED | BLOCKED via features/seo/index.ts |
| public-http/http/site/site-chat-markup.ts | BLOCKED | BLOCKED (missing edge cms->chat); owner @jini-ai/chat |
| public-http/http/site/worker-sandbox.ts | STAYS-HOST | Tovu theme budgets + worker paths over @jini-ai/sandbox/node-worker (header; host wiring) |
| public-http/middleware/canonical-site-host.ts | STAYS-HOST | Express adapter over cms/public-http/middleware/canonical-site-host |
| public-http/middleware/public-page-security-headers.ts | STAYS-HOST | already agreed STAYS-HOST (Express security-header middleware) |
| public-http/middleware/published-webmcp.ts | STAYS-HOST | host middleware: x-tovu-static-export / tovu-site-assistant-root literals over features/webmcp |
| public-http/middleware/render-theme-override.ts | STAYS-HOST | Express adapter over cms/public-http/middleware/render-theme-override (18 lines) |
| public-http/middleware/site-chat-static.ts | STAYS-HOST | already agreed STAYS-HOST (serves site-chat bundle) |
| public-http/middleware/site-consent.ts | STAYS-HOST | Tovu consent policy + host bindings, no routes (host copy, K3) |
| public-http/middleware/site-cookie-consent.ts | K1-CONVERT | (family consent, 6 regs) [EDGE cookie-consent+platform+diagnostics + BLOCKER modules telemetry-consent, @tovu/contracts secret-redaction] consent POST/context/loader/extension routes + plugin router; X-Tovu-Static-Export literal; 463 lines |
| public-http/middleware/site-serving-gate.ts | STAYS-HOST | host app.use gate keyed to Tovu admin/recovery paths and siteStatusRepo (host Express middleware) |
| public-http/middleware/theme-content-security-headers.ts | STAYS-HOST | Express adapter over cms/public-http/middleware/theme-content-security-headers (22 lines) |
| public-http/middleware/theme-page-preview.ts | STAYS-HOST | Express adapter for theme Explore preview routes over cms/public-http/middleware/theme-page-preview (header) |
| public-http/middleware/theme-preview-refresh.ts | STAYS-HOST | Express adapter over cms createThemePreviewMiddleware + refresh (3 regs wrap Jini modules) |
| public-http/middleware/theme-preview-static.ts | STAYS-HOST | already agreed STAYS-HOST (static theme preview build, data-tovu-slot) |
| public-http/middleware/theme-preview-switcher.ts | STAYS-HOST | Express adapter over cms render-theme-override; tovu_theme_preview cookie + x-tovu-static-export literals (host copy) |
| public-http/middleware/theme-static-assets.ts | STAYS-HOST | Express adapter (app.use /theme-assets) over cms theme-static-assets/theme-asset-dirs + platform fs |
| public-http/routes/agent-plugin-surfaces/export-files.ts | K1-CONVERT | (family agent-plugin-surfaces, 1 reg) [EDGE agent-plugins] GET declared plugin export assets (raw); owner @jini-ai/agent-plugins |
| public-http/routes/commerce/purchase.ts | K1-CONVERT | (family commerce, 5 regs) [EDGE commerce+user-management] member order create/pay/get + return/cancel pages; tovu_member_session cookie; owner @jini-ai/commerce SEC |
| public-http/routes/content/posts/get-by-slug.ts | K1-CONVERT | (family content, 1 reg) [EDGE user-management (members access-resolver)] GET public post by slug with member gating; owner @jini-ai/user-management or members port in cms |
| public-http/routes/mail-feedback.ts | K1-CONVERT | (family mail, 1 reg) [EDGE platform (mail)] POST provider bounce/complaint webhook (unauthenticated, signature checked); owner @jini-ai/platform mail SEC |
| public-http/routes/members/analytics.ts | BLOCKED | BLOCKED (missing edge cms->user-management): member analytics helper (33 lines); owner @jini-ai/user-management SEC |
| public-http/routes/members/complete-sign-in.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] POST sign-in/complete; tovu_session / tovu_member_session cookies; owner @jini-ai/user-management public-http SEC |
| public-http/routes/members/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host (public members bag) |
| public-http/routes/members/oidc-callback.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] GET OIDC callback; owner @jini-ai/user-management (member-login) SEC |
| public-http/routes/members/oidc-deps.ts | STAYS-HOST | host bag: HTTP-only member-login deps (K1 Departures: registrar types stay host) |
| public-http/routes/members/oidc-start.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] GET OIDC start; 35 lines SEC |
| public-http/routes/members/oidc-verify-email.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] POST OIDC verify-email SEC |
| public-http/routes/members/password-sign-in.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] POST password sign-in; 31 lines SEC |
| public-http/routes/members/sign-in.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] POST member sign-in request SEC |
| public-http/routes/members/unlink-identity.ts | K1-CONVERT | (family members, 1 reg) [EDGE user-management] POST unlink OIDC identity SEC |
| public-http/routes/oauth/callback-page.ts | STAYS-HOST | Tovu copy + message types for the shared OAuth popup landing page (host copy, K3) |
| public-http/routes/ops/health.ts | STAYS-HOST | /readyz bound to Tovu readiness-state + deploy-config copy (host ops) |
| public-http/routes/plugin-contributions.ts | STAYS-HOST | Express adapter: thin HTTP binding (app.use /api/p) for the existing plugin host, per-request router |
| public-http/routes/site-assistant-confirm.ts | K1-CONVERT | (family site-assistant, 1 reg) [BLOCKER assistant/site/visitor-{confirmations,executor,request-origin} value] POST visitor confirm; waits on the Tovu assistant area |
| public-http/routes/site-share.ts | STAYS-HOST | already agreed STAYS-HOST (/_share token download, tovu.zip) |
| public-http/routes/site/analytics-ingest.ts | K1-CONVERT | (family site/analytics, 1 reg) [EDGE analytics] POST /_analytics/e beacon; owner @jini-ai/analytics public-http |
| public-http/routes/site/chat-comparison-html.ts | STAYS-HOST | Tovu chat comparison page markup/copy, sibling of agreed chat-comparison.ts (host copy) |
| public-http/routes/site/chat-comparison.ts | STAYS-HOST | already agreed STAYS-HOST |
| public-http/routes/site/comments-submit.ts | STAYS-HOST | Express adapter over cms/comments/express createCommentSubmitHandler; pure helpers commentFormReturnTo/isSameOriginCommentPost could move into cms/comments/express as a MOVE-candidate slice |
| public-http/routes/site/feed.ts | K1-CONVERT | (family site-seo, 1 reg) [READY (type-only modules/seo)] GET feed (raw XML, template 9.3); 35 lines |
| public-http/routes/site/forms-admission.ts | STAYS-HOST | already agreed STAYS-HOST |
| public-http/routes/site/forms-multipart.ts | STAYS-HOST | already agreed STAYS-HOST (Express adapter over platform multipart) |
| public-http/routes/site/forms-submit.ts | STAYS-HOST | already agreed STAYS-HOST (tovu_form_flash cookie; wraps cms/forms/express) |
| public-http/routes/site/llms.ts | K1-CONVERT | (family site-seo, 1 reg) [READY (type-only modules/seo)] GET /llms.txt (raw text); 52 lines |
| public-http/routes/site/media-rendition.ts | K1-CONVERT | (family site/media, 2 regs) [EDGE http-kit+user-management + BLOCKER shared/media-original-writer value] GET /m/:asset/:transform/:file + original (raw stream); 702 lines |
| public-http/routes/site/member-pages.ts | STAYS-HOST | member sign-in/forgot pages HTML copy (host copy, K3) over user-management access-resolver SEC |
| public-http/routes/site/newsletter-confirm.ts | K1-CONVERT | (family site/newsletter, 1 reg) [EDGE user-management] GET confirm; owner @jini-ai/user-management newsletter public-http |
| public-http/routes/site/newsletter-deps.ts | STAYS-HOST | host bag for the 2 public newsletter routes |
| public-http/routes/site/newsletter-unsubscribe.ts | K1-CONVERT | (family site/newsletter, 2 regs) [EDGE user-management] GET+POST unsubscribe; owner @jini-ai/user-management |
| public-http/routes/site/pages.ts | STAYS-HOST | registrar facade composing the page handlers over RouteDeps (18 lines) |
| public-http/routes/site/pages/extra-head.ts | BLOCKED | BLOCKED via platform/routing/index.ts (+ RouteDeps) |
| public-http/routes/site/pages/handlers/home.ts | K1-CONVERT | (family site/pages, 1 reg) [EDGE user-management + BLOCKER platform/routing value] GET / (HTML raw); 182 lines |
| public-http/routes/site/pages/handlers/listing.ts | K1-CONVERT | (family site/pages, 2 regs) [BLOCKER platform/routing value] GET /page/N and /_more listing (regex paths) |
| public-http/routes/site/pages/handlers/marketing.ts | BLOCKED | BLOCKED via platform/routing, features/theme/theme-page-eligibility, site-assistant-mount.ts (+ edge user-management) |
| public-http/routes/site/pages/handlers/post-not-found.ts | BLOCKED | BLOCKED via platform/routing + RouteDeps (site/pages chain) |
| public-http/routes/site/pages/handlers/post.ts | BLOCKED | BLOCKED via platform/routing + site-assistant-mount.ts (+ edge user-management) |
| public-http/routes/site/pages/handlers/slug-routes.ts | K1-CONVERT | (family site/pages, 2 regs) [EDGE user-management + BLOCKER platform/routing value] GET /:slug + nested regex slug route |
| public-http/routes/site/pages/handlers/virtual-page.ts | BLOCKED | BLOCKED via RouteDeps (site/pages chain) |
| public-http/routes/site/pages/listing/listing-batch.ts | BLOCKED | BLOCKED via RouteDeps (site/pages chain) |
| public-http/routes/site/pages/pre-consent-cache.ts | BLOCKED | BLOCKED (missing edge cms->cookie-consent): G7-8 pre-consent cache policy; request-cookie dep |
| public-http/routes/site/pages/render-context/content-marker-ports.ts | BLOCKED | BLOCKED via features/widgets/deps.ts |
| public-http/routes/site/pages/render-context/deps.ts | STAYS-HOST | host bag, K1 Departures: registrar types stay host |
| public-http/routes/site/pages/render-context/media-metadata.ts | BLOCKED | BLOCKED via features/theme/index.ts |
| public-http/routes/site/pages/render-context/member-access.ts | BLOCKED | BLOCKED (missing edge cms->user-management); owner @jini-ai/user-management or members port in cms |
| public-http/routes/site/pages/render-context/post-previews.ts | BLOCKED | BLOCKED via platform/routing (+ edge user-management) |
| public-http/routes/site/pages/render-context/site-title.ts | BLOCKED | BLOCKED via RouteDeps (host settings read) |
| public-http/routes/site/pages/render-context/static-menus.ts | BLOCKED | BLOCKED via platform/routing/index.ts |
| public-http/routes/site/pages/render-context/widgets.ts | BLOCKED | BLOCKED via assistant/public-assistant-settings + public-assistant-availability (Tovu assistant) |
| public-http/routes/site/pages/request-policy.ts | STAYS-HOST | product cookie/header names (x-tovu-static-export, tovu_form_flash, tovu_member_session) (host copy, K3) |
| public-http/routes/site/pages/response.ts | STAYS-HOST | per-visitor response assembly welded to agreed host files form-feedback-policy/form-wire-policy and features/plugin-runtime widget partials |
| public-http/routes/site/pages/static-tier.ts | BLOCKED | BLOCKED via modules/collection-list-warnings (composition) (+ edge user-management) |
| public-http/routes/site/pages/template-render.ts | BLOCKED | BLOCKED via platform/routing (+ edge user-management) |
| public-http/routes/site/products.ts | K1-CONVERT | (family site/products, 2 regs) [READY] GET /products + /products/:id (HTML raw); imports only cms product-checkout/render-context |
| public-http/routes/site/robots.ts | K1-CONVERT | (family site-seo, 1 reg) [READY (type-only modules/seo)] GET /robots.txt (raw text); 39 lines |
| public-http/routes/site/search.ts | K1-CONVERT | (family site/search, 1 reg) [EDGE search (type-only modules/site-search)] GET /api/search; owner @jini-ai/search http-query |
| public-http/routes/site/sitemap.ts | K1-CONVERT | (family site-seo, 1 reg) [READY (type-only modules/seo)] GET /sitemap.xml (raw XML); 29 lines |
| public-http/visitor-analytics.ts | BLOCKED | BLOCKED (missing edge cms->analytics); owner @jini-ai/analytics |

## Summary counts

| class | admin-http | public-http | total |
|---|---|---|---|
| K1-CONVERT | 33 | 26 | 59 |
| STAYS-HOST | 30 | 38 | 68 |
| BLOCKED | 10 | 35 | 45 |
| MOVE-candidate | 0 | 0 | 0 |
| **all** | 73 | 99 | 172 |

K1-CONVERT readiness: {"EDGE +SEC":21,"EDGE":19,"READY":11,"READY +SEC":3,"BLOCKER":5}. Registrations covered by K1-CONVERT files: 101.

MOVE-candidate: none outright. Everything with routes is K1-CONVERT; the only direct-move slice found is `public-http/routes/site/comments-submit.ts` pure helpers (`commentFormReturnTo`, `isSameOriginCommentPost`) into `cms/comments/express`.

## Top 5 next K1 conversion targets (non-SEC, READY)

1. **admin forms** (authoring, create, delete-submission): 3 files, 3 regs, all READY. Finishes the family: Tovu is left with `deps.ts` (agreed host bag) and `forms-write-error.ts` (adapter, deletable after).
2. **public site SEO text routes** (feed, llms, robots, sitemap): 4 files, 4 regs, each 29-52 lines, raw text/XML via `mountPublicRawRoute`; only blocker is a type-only `modules/seo` import, replaced by a narrow per-route deps type.
3. **public site/products**: 1 file, 2 regs (`GET /products`, `/products/:id`), HTML raw; imports only cms `product-checkout` / `render-context`.
4. **admin publish-content/blobs-probe**: 1 file, 1 reg (`POST .../publish-content/blobs/probe`), JSON with `maxBodyBytes`; cms media/blob-staging/limits already present. (Family not finishable: `import-errors.ts` needs plugins edge, `peer-transport.ts` is SEC-adjacent.)
5. **admin posts/template-preview**: 1 file, 2 regs (GET+POST one path), 247 lines; inject the render function as a dep since `template-preview-render.ts` stays BLOCKED. Runner-up: `settings/events` (1 reg, SSE via http-kit node-bridge, 421 lines, harder).

Not ranked (SEC or edge-gated): members (9 files, 8 regs; owner @jini-ai/user-management), api-keys (3 regs), owner-auth (6 regs), fs-files (5 regs, READY but custom roots are SEC), system/* (about 30 regs, all need cms->devops / integrations edge or owner-package placement), commerce purchase (5 regs).
