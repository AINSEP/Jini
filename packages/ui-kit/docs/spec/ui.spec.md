Spec ID: SPEC-JINI-UI-KIT-UI
Version: 1.0.0
Last Edited: 2026-10-03
Hash: sha256:d216284ad80f3e37d8d728888a5edece24bbf0c4a64bc8567518e5b05f683be4
spec_mode: implementation_spec

# UI-kit UI contract

## Implemented surface and focus targets

| Component | Required target and semantics |
|---|---|
| Button, IconButton | Button; disabled/pending blocks action; IconButton has accessible label |
| TextField | Labelled input with controlled value |
| TextArea | Labelled textarea with controlled value |
| Select | Labelled HTMLSelectElement, visible or synchronized in an adapter |
| Checkbox | Labelled checkbox input |
| Switch | Labelled checkbox input with switch role |
| Dialog | Titled dialog; close action; pending blocks dismissal; opener restoration |
| ConfirmDialog | Alertdialog; initial cancel focus; guarded actions; consequence label |
| Tabs | Active tab receives attrs; tablist/tab/labelled panel semantics and roving focus |
| Menu | Trigger receives attrs; menu/menuitem semantics and roving focus |
| Toast | Status or alert root; optional dismiss button; ToastRegion is a polite live region |
| Tooltip | Focusable trigger receives attrs and described-by association |
| Notice | Status or alert root |
| Spinner | Labelled status root |
| Badge | Text root |

Opaque attrs must reach the documented target, not a decorative wrapper. They can carry data-agent-* and aria-* metadata. Structural attrs and state remain semantically correct when native implementations add ids, values, roles, disabled, variant, or state attributes. Ref forwarding is required for native control targets and cancel-first confirmation focus.

## Parts and styling

kitSpec.parts and kitParts are the canonical part inventory. Native CSS is opt-in through `@jini-ai/ui-kit/react/native/styles.css`, scoped under `@layer jini.kit`, and keyed on data-jini-part. It does not reset the host page. Variables include --jini-kit-fg, --jini-kit-bg, --jini-kit-danger, --jini-kit-warning, and --jini-kit-focus. Native buttons emit data-jini-variant and data-jini-state; tones select message variants. Spinner motion respects prefers-reduced-motion.

Confirmation parts are confirm.dialog, confirm.title, confirm.body, confirm.actions, confirm.cancel, confirm.confirm. Both actions must remain visible and operable when ready; both must expose disabled state while pending. Cancel comes first. A human-only confirm target publishes no agent metadata. Overrides receive guarded controller bags and must preserve their labels/attrs/ref/handlers. Every component, including ConfirmDialog, is replaceable.

## Overlay and browser limits

Dialog and confirmation frames live in the resolved overlay container. Native dialogs use browser showModal when available. ToastRegion portals into the overlay and must be explicitly mounted by the host. Tooltip and Menu are local in-tree composites in v1.

The current browser-only scenario data tags native Escape and modal initial focus. The default React driver reports these skipped; includeBrowser requires an external real browser driver. Native dialog top-layer behavior, actual focus trapping, and geometry need further browser validation. Source-level semantics and jsdom results are not evidence of browser accessibility completion; no Playwright coverage is claimed in these docs.

## Planned components

Link, Icon, RadioGroup, Field, Card, Table, Popover, Combobox, Stack, Grid, ShellLayout, Sidebar, NavItem, PageHeader, Section, EmptyState, and OverlayHost are planned entries only. Their parts and behavior are not yet contracted. The existing Overlay utility and provider overlay root do not implement a planned OverlayHost component. Vue/Angular adapters, UI-library adapters, and motif loading remain deferred.

## Handoff

Inputs: kit.spec.ts, native component hooks/markup/CSS, confirmation guard and provider. Output: v1 semantics, parts, customization obligations, browser limitations. Risk: replacement libraries must be verified against conformance and real browsers. Next assignee: adapter or consumer migration owner.
