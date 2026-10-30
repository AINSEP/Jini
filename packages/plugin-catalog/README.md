# @jini-ai/plugin-catalog

Metadata for independently installed Jini plugins. Read `@jini-ai/plugin-catalog/catalog`
as JSON to display available choices. This package has no dependencies or plugin payloads.
Catalog presence does not authorize installation, activation, or imports. Resolve a selected
package and use the existing Jini installers and loaders.

Each entry records its kind, local id, publisher-qualified identity, npm package name and
version, artifact directory relative to that package, contract id/version, description,
and expected file digests. `version` is the npm version; `pluginVersion` preserves the
inner manifest version. The design agent remains `0.4.6` inside the `0.6.15` npm package.
Provider artifacts use the npm version. Contracts retain their manifest identifiers
(`ai_trace`, `product_analytics`, `observability`, `payments`, `fixture`); the agent contract
identifies the Agent Plugins schema version.

The reviewed source catalog uses `expectedDigests: null` until payloads are built.
These entries are discovery metadata, not verified artifacts. For release, build the
standalone packages first, then run `pnpm --filter @jini-ai/plugin-catalog generate`.
`prepack` repeats generation and refuses missing/stale artifacts or provider integrity
mismatches. Generation only reads manifests and hashes files: it never builds or imports
plugin code. Unpublished tooling reuses `computePluginIntegrity`, including for the agent's
file map. Its `sha256-<hex>` values cover files relative to `path`; provider manifests are
excluded by that existing integrity contract. Agent `plugin.json` is included. This is
not an installer archive digest; hosts retain their existing archive verification.

Only `package.json`, `catalog.json`, this README, LICENSE and NOTICE are published.
Generation scripts, tests, and vendor assets are excluded by the explicit npm file list.
The package follows Jini's fixed Changesets release group.
