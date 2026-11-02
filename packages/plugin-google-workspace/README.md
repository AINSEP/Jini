# `@jini-ai/plugin-google-workspace`

Portable Agent Plugins payload for Google Workspace: one Google sign-in (the `drive.file`
permission, never the whole Drive), Google Sheets chat tools, three admin panels (connection, file
picker, form destinations) and a push-only `google-sheets` form destination. Installing this package
downloads only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-google-workspace/plugin.json` with the host's package resolver. Its
containing directory holds the payload. Copy that directory beneath the host's bundled-source root,
then use `@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for
`@jini-ai/plugin-slide-design`. Host policy controls activation; installing this npm package grants
no permission. Hosts seed it **disabled**, and each Google product inside it (v1: Sheets) starts off.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0**
and changes only when the plugin content changes. The publisher id stays `tovu/google-workspace`.
The `./google-workspace/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/google-workspace`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts google-workspace`) generates only `google-workspace/`
here. The plugin-local `node:test` suites in `packages/agent-plugins/google-workspace/__tests__` are
not shipped.

## What the payload holds

- `skills/google-workspace/` — what the assistant reads: connecting, products, account actions,
  the Sheets tools, form delivery and every error code.
- `tovu-connections.json`, `tovu-agent-tools.json`, `tovu-admin-surfaces.json`,
  `tovu-form-destinations.json` — contribution contracts read by a host that supports them. Their
  names, keys and the `TOVU_GOOGLE_*` config names they declare are frozen.
- `lib/`, `tools/`, `ui/`, `form-destinations/` — the executable modules those contracts name. They
  import only relative files; the host injects HTTP, credentials and state. The host's executable
  trust gate checks the seeded digest before any module loads.
- `products.json` — the product catalog (id, label, tool prefix, required scopes).

## Host guidance

The skill is host-neutral: it names jobs and this plugin's own tools. Hosts add their exact tool
names, admin paths and OAuth callback route through their own plugin-guidance wiring, not by
editing this payload.

Known debt: the own-client credential card in `extensions.tovu` names Tovu's OAuth callback path in
its hint. Only Tovu consumes that card today.
