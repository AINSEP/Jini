---
"@jini-ai/admin": minor
"@jini-ai/cms": minor
"@jini-ai/core": minor
"@jini-ai/diagnostics": minor
"@jini-ai/integrations": minor
"@jini-ai/agentic": minor
"@jini-ai/ui": minor
---

Sites, Workspace and AI Assistant extraction (w3-sites): admin assistant-settings, workspace, sites, webmcp and fs-files screens/hooks with injected host collaborators; cms assistant/workspace route specs, workspace site repo and tools, fs-files custom roots, webmcp settings; core wire contracts (cms-workspace, admin-sites, web-screenshot, workspace tool metadata, assistant DTOs); diagnostics web-evidence published-page, site-path-policy, live-url and Playwright page capture; agentic admin page tools; ui created-site return hook. Breaking for integrations consumers: the PageCapture* types now come from `@jini-ai/core/contracts/site/web-screenshot`.
