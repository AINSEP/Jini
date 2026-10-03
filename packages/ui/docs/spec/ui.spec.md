Spec ID: SPEC-JINI-UI-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:8b761d6c852c3856433c7a1285a41b864605a5e920012d8a14cc88f25c5db0af
spec_mode: reverse_spec


# UI contract: @jini-ai/ui

## Composition and component inputs

React components use one props object; event callbacks retain their currently declared signatures. Consumer data, actions, slots and labels are explicit inputs. Do not assume importing a component installs its CSS, a router, credentials, native dialogs or backend.

| Surface | Required inputs and events | Optional slots/customization |
|---|---|---|
| Select | value, options `{value,label}[]`, onChange(value) | Placeholder/id/aria-label/aria-labelledby/disabled, translation, agentHandle, replaceable dropdown hook |
| InfoTip | label | agentHandle and replaceable controller; portal bubble is visual, trigger's aria-label carries the content |
| SeeMore | children | lines (2), more/less labels, classes, toggleAriaLabel, agentHandle, replaceable clamp hook |
| ImagePreviewModal | open, src, alt, onClose() | closeLabel (`Close preview`), agentHandle, replaceable modal hook |
| ComingSoonPanel | label, children | note; children remain mounted but inert |
| ComingSoonNotice | kicker, label, description | note and agentHandle; no navigation or locale lookup |
| TabbedDialog / SettingsDialogShell | tabs with id/label/panel | tab icons, active tab/control callback, close callback, welcome/sidebar/fullscreen options, labels, chromeExtra, dialogAriaLabelledBy, className |
| Root primitives | Component's exported props: labels/content/value/choices/actions | Icon size/name, status/tone, class/style, children and component-specific chrome; see `src/react/components/` |
| Settings tabs | Preferences/config/catalogs and update callbacks in exported props | Corresponding host ports, labels, catalogs and optional capabilities; shell owns no tab persistence |
| Assets and resources | Asset/file/resource DTOs and action/data ports | Toolbar/card/body/row composition; consumers own statuses, ids, selection side effects and downloads |
| ViewerShell/version manager/HTML viewer | File/preview/version data and host action callbacks | Viewport controls, file actions, comment side panel/dock, markdown split/code/media bodies; version transport and clipboard ports |
| List-detail, mention, schedule, palette/launcher, revisions, dropzone | Items/configuration/selection and declared callback/port inputs | Render callbacks and labels; scheduling/navigation/history/import semantics remain consumer-owned |
| SketchEditor | scene, fileName, onSceneChange(scene,options?), onSave(scene?) | Engine port, export/clear/open callbacks, save state, theme hook and DOM/menu/tooltip/localization overrides |
| RichTextInput | placeholder, value, knownMentions, text+mention change callback, trigger callback, submit callback, popoverOpen, popover-key handler | ref handle, pasted files, combobox/listbox metadata, custom triggers, mention colors and namespace |
| InteractiveHtmlEditor | html, onChange(html) | ref flush handle, protection predicate, canvas CSS/wrapper/style assets, embed placeholders and className |
| McpUiHost | HTML, sandboxProxyUrl and title | tool/link/size/event callbacks, host context/info, session key, timeout, wrapper class/height controls |
| Interactive providers | Props accepted by each exported manifest's Zod schema | Table row callback, button/form callbacks and chart/field presentation; caller must validate wire props before direct rendering |
| A2uiSurfaceRenderer | interpreter, surfaceId, registry | fallback ReactNode; implements five basic types plus registry components |
| ArtifactView | file, renderer registry | hints, srcDocOptions, annotation, className, slots.renderers keyed by renderer id |
| SrcDocSandbox | html | document options, title/class, message callback |

The root feature inventory is in `api.spec.md`; family members use their exported `*Props`/controller/port types. Editors and renderers are separate entry points, not root components. Settings-specific shell is a thin generic-shell wrapper with settings label defaults.

## Slots and data boundaries

- TabbedDialog renders each tab's panel as supplied and only mounts the active panel. chromeExtra sits beside fullscreen/close controls. Labels customize generic chrome; tab title/subtitle/label remain consumer data.
- ArtifactView calls a matching renderer slot with `{file,match}` before its built-in renderer switch. Annotation wraps either slot output or built-in output when enabled. File manifest and content are independent inputs; missing match renders the fallback UI.
- Source-config optional port methods control the visibility of refresh/trust/edit/test actions. Similar optional execution/install/location capabilities determine their controls; a missing method is not a failed attempt.
- Sketch engine DI replaces the actual Excalidraw canvas/menu/export engine. save/export callbacks own persistence. Editor DOM overrides are editor-specific display adapters, not a global translation service.
- HTML editor's initial HTML, protection predicate, canvas styling and embed-descriptor callback are mount-time inputs. Remount to switch documents/configuration. onChange reports edited output; await handle.flush before a save that must include an open RTE session. Canvas decorations/styles/wrapper are display aids and excluded from saved content.
- RichTextInput is plain text with atomic mention nodes, not a block rich-text editor. Host manages suggestion/popover state and supplies mention identity/category vocabulary. Imperative ref methods are the supported text/mention insertion interface.
- A2UI fallback is used without a root. Missing/cyclic/unsupported nodes get visible placeholders. Dynamic template lists are unimplemented. Registry components receive props and an onRowClick shim; other provider action callbacks are not universally translated to interpreter actions.

## Theme contract

`/theme` exposes AdminTheme data and application functions; `styles/variables.css` defines the common token contract. Theme data supplies name, font stacks, light/dark palettes, optional radius and density. The ten palette keys are primary, primaryInk, bg, surface, text, muted, border, danger, success, warning. Neutral defaults use system fonts, radius 8px and density 1.

| Variables / attribute | Meaning |
|---|---|
| `--jini-theme-light-*`, `--jini-theme-dark-*` | Applied palette values; primaryInk becomes primary-ink |
| `--jini-bg`, `--jini-surface`, `--jini-text`, `--jini-muted`, `--jini-border`, `--jini-primary`, `--jini-primary-ink`, `--jini-danger`, `--jini-success`, `--jini-warning` | Resolved active palette from variables stylesheet |
| `--jini-font-body`, `--jini-font-heading`, `--jini-font-mono` | Applied font stacks; UI/display aliases are derived |
| `--jini-radius`, `--jini-density` | Base corner radius and spacing multiplier; CSS derives radius/space scales |
| `--jini-bg-panel/subtle/elevated`, border/text/accent/neutral/link/status aliases | Derived colors for component states |
| shadow, radius, space, font-size/weight, line, duration/easing, z-index tokens | Shared scales declared in `src/styles/variables.css` |
| `data-admin-theme` | Applied theme name/scope; cleanup restores previous name |
| `data-color-scheme="light"|"dark"` | Consumer-selected palette; no automatic system listener |
| `--see-more-lines` | Per-instance text-clamp count |
| `--jini-mcpui-*` | Separate self-contained MCP surface token family; tokens are embedded into generated HTML |
| `--rich-text-mention-color` | Inline mention-color property supplied by the Lexical mention-color hook |

Theme target/document are injected. Body-portaled menus/tooltips inherit from the body/root, so a narrowly scoped theme does not automatically reach those portals; consumers choose the scope. Font loading uses stylesheet URLs. Validation excludes arbitrary CSS fragments; it does not measure contrast or certify font availability.

MCP generated documents embed their own tokens and default force-light setting; host DOM tokens do not cross the sandbox. Interactive-provider styles use the optional `/interactive-ui.css`; root primitives/feature chrome can also require consumer styling beyond the exported admin/widget/dialog sheets.

## Accessibility and keyboard behavior

| Surface | Implemented semantics / consumer obligation |
|---|---|
| Select | Combobox trigger with expanded/controls/active-descendant; listbox options with selected state; keyboard/search/focus dismissal controller. Caller supplies an accessible name. |
| InfoTip | Focusable trigger with label, hover/focus show and Escape hide. Bubble is aria-hidden/presentation to avoid duplicate announcement. |
| SeeMore | Native button with aria-expanded/controls; generated content id; toggle only if overflow. Supply translated labels if source copy is unsuitable. |
| Image preview | Native dialog with alt-based name, alt text, named close button and native cancel path. Host must preserve native-dialog support. |
| Coming soon | Status/note copy and inert child controls; inert is not authorization. |
| TabbedDialog | Modal mode uses role dialog/aria-modal; inline uses region without aria-modal. Named close/fullscreen/sidebar controls, pressed states, sidebar name. Host must ensure ids are unique when mounting multiple instances; default sidebar id is fixed. Shell does not supply a general focus trap. |
| Spinner/skeleton | Spinner role status, polite live region; skeletons aria-hidden. Provide descriptive loading labels for user-facing loads. |
| Focus trap | Most recently active container traps Tab boundaries, excluding hidden/disabled/inert descendants. Host manages initial focus, restore focus and modal background behavior. |
| RichTextInput | Supports host combobox active-id/expanded/listbox association; navigation/submit callbacks honor editor keyboard handling and atomic mentions. Host owns suggestion list semantics. |
| MCP fields | Native labelled input/select/group markup; hint associations, required/disabled states and status region. Caller owns readable labels, meaningful action copy and server-side validation. |
| MCP/artifact frames | MCP title labels its wrapper; its client-generated iframe has no title attribute. SrcDocSandbox supplies an iframe title. Consumer must inspect iframe content accessibility separately. |
| Interactive UI | Native/shadcn field controls and semantic data tables; charts have provider-defined presentation. Schema validity does not imply accessible labels, contrast or chart descriptions. |

No package-wide WCAG certification, automatic focus restoration, automatic async announcement for every component or automatic contrast enforcement is promised. Native roles and module-specific behavior above are source evidence, not a guarantee for arbitrary host slots/HTML.

## Evidence and review limits

Contracts are grounded in component/props source, exported styles and existing widget, editor, renderer, theme and hook tests. Tests were read as evidence; no tests, builds, browser processes or visual/accessibility audits were executed for this specification. Refresh against the completed API wave before treating legacy signatures or inferred return descriptions as a stabilized API.
