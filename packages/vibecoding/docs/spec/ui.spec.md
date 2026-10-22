Spec ID: SPEC-JINI-VIBECODING-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a7febd07648273374b7bc46a45298b7ac0ee221684388043ba768e33d5f9173d
spec_mode: reverse_spec


# UI contract: vibecoding

All components are exported only from `@jini-ai/vibecoding/react`; consumers provide React/ReactDOM and a bounded-height layout. Components use one props object, as required by React; they do not implement a second optional-args object.

## Components and props

| Component | Required props | Optional props / observable behavior |
|---|---|---|
| `PartsViewer` | `parts: readonly PartRef[]` | `selectedId?: PartId \| null`, `onSelect?: (id: PartId) => void`, `content?: string`, `contentLoading?: boolean`, `className`, `style: CSSProperties` |
| `DocumentPreview` | `html: string` | `title` defaults to `Live preview`; `className`, `style` |
| `VibecodingWorkbench` | `session: VibecodingSession` | `documentHtml`, `className`, `style`; composes viewer, preview and undo/redo toolbar |

PartsViewer shall render an `Artifact parts` labelled list with native buttons; label falls back to ID, kind is shown only when supplied, selection uses `aria-current`. Content shall be rendered as escaped text in `<pre>`. Empty/unselected/loading states shall show `No parts yet.`, `Select a part to inspect its content.`, and `Loading…` respectively.

DocumentPreview shall use iframe `srcDoc`, a title and `sandbox="allow-scripts"` without same-origin permission. Changes to HTML shall navigate/update the frame through React. This is a static HTML preview, not a build/run service. No CSP, network prohibition or content sanitization is supplied.

Workbench shall subscribe/refresh through the hook, fetch selected content lazily, and reflect session cache changes. It shall disable undo/redo based on history booleans and show lastError as text. Whole-document HTML takes precedence over selected content. Selection is per viewer, not shared session state.

## Composition, theming and accessibility limits

No named slots, render-prop customization or theme variables are exported. Compose the three components/hook separately for custom layouts. `className` and shallow-merged root `style` are available; internal layout/colors use fixed inline styles (220px part list, white preview, hardcoded selected/error colors).

Native buttons provide keyboard activation; list labeling, `aria-current` and iframe title provide accessible names/state. There is no tree/listbox keyboard pattern, roving focus, loading live region or error `role="alert"`. The package does not claim full accessibility conformance. Root styles do not recolor every internal element; consumers needing complete themes must supply their own composition.

Known promise-handling limit: toolbar click handlers discard undo/redo promises without catching rejection. Session lastError updates, but a rejected action can also become an unhandled promise rejection.

Evidence: `src/react/components/*.tsx`, hook/session source and component tests, read only.
