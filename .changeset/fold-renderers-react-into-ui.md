---
"@jini-ai/ui": minor
"@jini-ai/chat": patch
---

Folded `@jini-ai/renderers-react` into `@jini-ai/ui` as an independently-importable, tree-shakeable
`./renderers` subpath, and retired the package.

Real (non-comment) imports of `@jini-ai/renderers-react` anywhere in the repo were exactly 3 files,
2 symbols, all inside `@jini-ai/ui`'s own `features/html-viewer` — `openSandboxedPreviewInNewTab`
and `useSandboxBridge`. `@jini-ai/ui` was already the package's only real consumer, so a standalone
package bought nothing, the same reasoning that folded `@jini-ai/ui-core` into `./core` and
`@jini-ai/composio` into `@jini-ai/admin`. The whole `src/**` tree (registry, renderers, srcDoc
host, annotation-canvas, preview-modal-shell, i18n) moves to `packages/ui/src/renderers/` as one
`git mv`, unchanged in shape; `html-viewer`'s two consumers switch from the package-qualified
import to a relative one, since they're now in the same package.

**The `@jini-ai/renderers-react → @jini-ai/chat` dependency was dropped first, before the move,
not after.** `registry.ts` imported `ArtifactManifest`/`inferLegacyManifest` from `@jini-ai/chat`,
and `types.ts` re-exported five manifest types from there. `@jini-ai/chat` already depends on
`@jini-ai/ui`, so folding renderers-react into `ui` unchanged would have created a real `ui ↔ chat`
package cycle. The five manifest types (`ArtifactManifest`, `ArtifactKind`, `ArtifactRendererId`,
`ArtifactExportKind`, `ArtifactStatus`) are now defined locally in `types.ts`, copied verbatim from
`@jini-ai/chat`'s `src/core/util/types.ts` — a small duplicated-type cost, accepted because a
renderer package must not depend on a chat package.

**`resolveArtifactManifest` no longer infers a legacy manifest from a file's name/extension** — a
real, disclosed API behavior change. It now returns `file.manifest ?? null`. Manifest inference
(guessing kind/renderer from `.md`/`.html`/`.svg`/`.tsx`, etc.) is a caller concern that depends on
a product's own naming conventions, not something a generic renderer registry should do on a
caller's behalf; a caller that still wants that inference should resolve a manifest for the file
itself (see `@jini-ai/chat`'s `inferLegacyManifest`) before handing it to this registry. Verified
zero external callers of `RendererRegistry`/`resolveArtifactManifest`/`createDefaultRendererRegistry`
anywhere in Jini or Tovu before making this change — `@jini-ai/chat`'s own `RendererRegistry` is an
unrelated, locally-defined class in `artifact-types.ts`, and `@jini-ai/artifacts`' own
`resolveArtifactManifest` is an unrelated 3-argument function; both are same-name coincidences, not
real dependents. The four bundled renderers (`HtmlRenderer`, `MarkdownRenderer`, `SvgRenderer`,
`ReactComponentRenderer`) gate `canRender` on a resolvable manifest before falling back to any
`file.kind`/extension heuristic of their own, so this ripples into every test that exercised
default-registry routing via a bare file name with no explicit `manifest` — all updated to attach
one, with the extension-inference-specific assertions flipped to assert the removed behavior no
longer fires. No test was weakened or deleted: every changed assertion now tests the new,
documented contract, or restores a manifest to keep testing what it always meant to test.

**`@jini-ai/renderers-react` is retired, not versioned forward.** It was published (0.1.2), and
`packages/renderers-react` is deleted from this workspace. Deleting the source does not unpublish
anything, so whoever runs the next release should follow up with:

```
npm deprecate @jini-ai/renderers-react "Merged into @jini-ai/ui; import from '@jini-ai/ui/renderers' instead."
```

`@jini-ai/chat`'s dead `@jini-ai/renderers-react` dependency (declared, never imported — its own
`react/artifact-types.ts` defines a local placeholder registry instead, per its
`TODO(renderers-react)` header, left untouched here as out of scope) is removed from its
`package.json`, hence the accompanying patch bump.
