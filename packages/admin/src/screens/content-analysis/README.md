# Content analysis card

The post editor's Content analysis card — the admin surface of the `content-analyzer` plugin. It
reads the plugin's preview status, shows the analysis stored on the post's last save, and runs
"Analyze now" over the editor's current (unsaved) title and body.

## Wiring

**Needs injected (all required props of `ContentAnalysisCard`):**

- `port: ContentAnalysisPort` (`hooks/content-analysis-port.hooks.ts`) — `previewStatus` (`GET`)
  and `previewPlugin` (`POST`) on the host's `/plugins/:pluginId/preview` route. A rejection must be
  an `AdminApiError` (`@jini-ai/core/admin-runtime`) so `rules.ts` can map the plugin's codes.
- `useAdminLocale: UseContentAnalysisLocale` — the host's admin-locale hook (`() => string`).
- An `AdminKitProvider` above it (the hook reads `useFetchQuery`/`useFetchMutation` from the kit).

**Provides:** `ContentAnalysisCard`, `ContentAnalysisCardView` (markup for one controller state),
`useContentAnalysis(target, { port, locale })`, `createFakeContentAnalysisPort` (tests), the pure
`rules.ts` and the 21-locale dictionary (`content-analysis-i18n.ts`). Every class is
`jini-*`: feature classes are `jini-content-analysis*`, and the shared shapes are `jini-card`,
`jini-card-title`, `jini-card-lead`, `jini-editor-actions`, `jini-btn-secondary`, `jini-save-error`,
`jini-stat-label|value|meta`, `jini-field-label`, `jini-field-hint`, `jini-status jini-status-*`.
Jini ships no CSS for them; the host stylesheet paints them.

```tsx
const contentAnalysisPort: ContentAnalysisPort = {
  previewStatus: ({ pluginId }) => hostRequest({ path: previewPath(pluginId), method: "GET" }).catch(toAdminApiError),
  previewPlugin: ({ target: { pluginId }, body }) => hostRequest({ path: previewPath(pluginId), method: "POST", body }).catch(toAdminApiError),
};

<ContentAnalysisCard post={post} title={title} bodyJson={bodyJson}
  port={contentAnalysisPort} useAdminLocale={useAdminLocale} />
```

**Must never import:** the host's request client, config, locale hook or styles, or any
`@jini-ai/cms` implementation file. Boundary rationale:
[`DR-005-portable-package-boundaries`](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
