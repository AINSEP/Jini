---
"@jini-ai/admin": minor
"@jini-ai/mcp": minor
---

Add email and storage bindings, register the Providers screen, and expose injected media upload and metadata controllers alongside the external MCP controller. Add the Settings screen and external MCP panel with required injected collaborators.

Add the legacy media screen with required view, hook, and host-service collaborators, retaining its grid, upload, metadata, lightbox, and deep-link composition.

Add email and storage bindings, register the Providers screen, and expose injected media upload and metadata controllers alongside the external MCP controller. Compose the required External MCP hook inside bindProviders so hosts can bind the Providers screen without a local controller hook.

Add the injected Agent Plugins and Plugins screens, including list actions, revision-bound updates, folder-install gating, and overlays. Preserve the Providers locale boundary and inert future tabs.
