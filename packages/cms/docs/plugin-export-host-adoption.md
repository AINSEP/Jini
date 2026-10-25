# Plugin export host adoption

The universal `@jini-ai/cms/widgets` entry must stay free of `parse5` and `widgets/html` runtime
dependencies, so plugin template filling lives only in the node-only `@jini-ai/cms/widgets/html` entry.

Port contract: `ResolveHtmlPageEmbedsDeps.pluginExports` is an optional `PluginExportsPort`:
`resolve({ config, workspaceId }, optional?)` returns an admitted `PluginExportTemplate` or `undefined`.
Site enablement, aliases, schema validation, contained file reads and public host values stay with the
host. Template filling, version checks and fragment validation stay in the CMS HTML implementation.

Wiring, from the host's node composition root:

```ts
import { resolveHtmlPageEmbeds } from '@jini-ai/cms/widgets/html';

const resolved = await resolveHtmlPageEmbeds({
  deps: { ...deps, pluginExports: admissionPort },
  input: { workspaceId, html },
});
```

Pass the `plugin-export` IR props to `substituteHtmlEmbeds` so canonical attribution and consent stamps
survive substitution. Without a port, or when admission or template validation refuses an occurrence,
substitution removes the marker and keeps its wrapper and authored fallback HTML. The universal
`HTML_EMBED_RESOLVERS.plugin` entry always returns no IR, which gives the same fallback.
