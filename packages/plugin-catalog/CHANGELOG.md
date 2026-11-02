## Unreleased (0.6.19)

- Agent entries point at `@jini-ai/agent-plugins/<id>` (packageName `@jini-ai/agent-plugins`, path `<id>`); their digests leave out `__tests__/`. A provider with no `plugin-<id>` package is catalogued from `@jini-ai/provider-plugins`.
- Read agent plugins from the shared layout table (`scripts/lib/agent-plugin-packages.ts`): kind comes from the source, entries are keyed by kind and id, and the package name comes from the row, so a provider and its agent face can ship in one package.
- Refuse, instead of silently merging, two catalog sources that would collapse into one record (same kind and id, or the same publisher identity).
- Describe browser-only providers by their first browser declaration (`browser-provider:<kind>`) and require each declared browser bundle digest; no server contribution is invented.
- Name the catalog's host namespace (`CATALOG_HOST_NAMESPACE = 'tovu'`).

## 0.6.17

### Patch Changes

- Version bump only.

