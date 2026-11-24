---
"@jini-ai/core": patch
"@jini-ai/capability-providers": patch
"@jini-ai/cms": patch
"@jini-ai/agent-plugins": patch
"@jini-ai/integrations": patch
"@jini-ai/devops": patch
"@jini-ai/platform": patch
"@jini-ai/diagnostics": patch
"@jini-ai/commerce": patch
"@jini-ai/agentic": patch
---

K4 seam split (ex6-fnd-shared-a): new type-only core contracts under `@jini-ai/core/contracts/site/*` — `capability-providers-comments`, `seo-content-analysis`, `ui-sections`, `admin-surfaces-connections`, `api-connections-hosted-mcp`, `media-providers-catalog`, `core-custom-credential-categories`, `packaging-electron`, `platform-process`, `fs-durable-json`, `diagnostics-domain-dns`, `web-evidence-playwright`, `web-evidence-capture-budget`, `commerce`, `skills-install`. Core now owns those declarations; capability-providers, cms, agent-plugins, integrations, devops, platform, diagnostics, commerce and agentic import them from core and keep their runtime values. Their public entries still export the moved names as deprecated type-only re-exports, so this is not a breaking change; the re-exports are removed at the next major. `@jini-ai/diagnostics/redaction/secrets-only` also exports `scanTextForSecrets` and `SecretScanHit`, moved from a host so the text scanner shares the redaction pattern catalog.
