Spec ID: SPEC-JINI-UI-KIT-API
Version: 1.0.0
Last Edited: 2026-10-03
Hash: sha256:54f76f0cbdeee7b584e4afb9bb0c5a05446efe351a25db210b467610c0723e81
spec_mode: implementation_spec

# UI-kit public API

## Export boundary

The package exports `.`, `./react`, `./react/native`, `./react/native/styles.css`, and `./react/testing`. Root exports are framework-free; React entries require React/React DOM. Vue is an optional peer for future adapters, not a v1 import path. No runtime dependencies are declared.

`KIT_CONTRACT = { id: '@jini-ai/ui-kit', version: '1.0.0' }`. `kitSpec` is an `as const` component registry with status, tier, since, parts, focus target, portal, safety, behaviors, prop/event names, variants, and states. `implementedComponents` and `kitParts` are frozen lists derived from implemented entries. Public types include `KitComponentName`, `ImplementedComponentName`, `KitPart`, `KitAttrs`, `AgentSpec`, `AgentAttrsPort`, `KitNeeds`, confirmation types, and toast types.

Except React-mandated callbacks, public operations and event/value ports take `(requiredObj, optionalObj = {})`. Empty options may be omitted. The Error constructor is `new KitConfigError({ issues: readonly string[] }, {})`.

## Root functions

| Function | Required; optional | Result |
|---|---|---|
| `needs` | `{ id, components }`; `{ contract? }` | Frozen `KitNeeds`, default contract `^1`; rejects planned entries |
| `assertKitContract` | `{ contract }`; `{}` | `void`, throws on incompatible or unsupported range |
| `planConfirm` | `ConfirmInput`; `{}` | Frozen labels, consequence, variants, disabled/dismissal policy, initial focus, optional agent action specs |
| `createConfirmController` | `{ read, onConfirm, onCancel }`; `{}` | Controller with `requestDismiss`, `confirm`, `isExecuting` |
| `createToastService` | `{}`; `{ scheduler?, durationMs? }` | Instance-local `ToastService` |

`ConfirmInput` requires `open`, `title`, `confirmLabel`; optional `cancelLabel`, `tone: 'default' | 'warning' | 'danger'`, `pending`, `consequence`, `agentHandle`, `agentMayConfirm`. Controller `read({}, {})` supplies current input. Callback ports are `onConfirm({}, {}): void | Promise<void>` and `onCancel({}, {}): void`.

Controller methods: `requestDismiss({ reason }, {}) => boolean`, where reason is `cancel-button | escape | backdrop | close`; `confirm({ actor?: 'human' | 'agent' }, {}) => Promise<boolean>`; `isExecuting({}, {}) => boolean`. A refused request returns false and invokes no action. Agent permission affects actor `agent`; omitted actor follows the human path.

Toast methods: `push({ message, tone?, durationMs? }, { id? }) => string`, `dismiss({ id }, {})`, `snapshot({}, {}) => readonly ToastMessage[]`, `subscribe({ listener }, {}) => unsubscribe`, and `dispose({}, {})`. Scheduler: `schedule({ delayMs, run }, {}) => ticket`, `cancel({ ticket }, {}) => void`.

Contract grammar supports exactly `1.0.0` or a caret form `^major[.minor[.patch]]` whose lower bound is compatible with current contract 1.0.0. It is not a general semver-range parser.

## React kit factories and hooks

| Export | Required; optional | Result |
|---|---|---|
| `createKit` | `{ components?: Partial<ReactKit> }`; `{ id?, contract?, guard? }` | `ResolvedKit` with native defaults |
| `createStrictKit` | `{ components: ReactKit }`; same options | `ResolvedKit`; missing components fail typing and runtime validation |
| `extendKit` | `{ base: ResolvedKit, components: Partial<ReactKit> }`; same options | New kit preserving inherited overrides and options |
| `describeKit` | `{ kit }`; `{}` | `{ id, contract, coverage, fallbacks, violations }` |
| `useKit` | `{}`; `{}` | `KitContextValue`, native defaults when absent |
| `useKitComponent` | `{ name }`; `{}` | Resolved component |
| `useOverlayContainer` | `{}`; `{}` | Provider container, otherwise browser body or null |
| `useToast` | `{}`; `{}` | Provider toast service; throws when unavailable |
| `useConfirmController` | `ConfirmDialogProps`; `{}` | Guarded confirmation view model |

`ResolvedKit` contains id, contract, components, overrides, violations, failed set, guard. `describeKit` reports source `override`, `native`, or `native-guard` per component. Its fallbacks include native defaults. Options default to id `native`, contract `1.0.0`, guard `fallback`. Explicit undefined overrides retain defaults.

`KitProviderProps`: optional `kit`, `agent`, `overlayContainer: HTMLElement`, `needs: readonly KitNeeds[]`, `toast`, `cancelLabel`, `guard`; required `children`. `Overlay` takes `{ children, container: HTMLElement | null }`. `ToastRegion` takes `{ service?, attrs? }`.

## Component prop surface

All component props accept opaque `attrs` and optional `className`. Control refs target the documented native element.

| Component | Props in addition to base props |
|---|---|
| Button | children?, onPress?, disabled?, pending?, variant?, type?, button ref? |
| IconButton | Button props plus required label |
| TextField | label, value, onValueChange; disabled?, required?, placeholder?, type?, input ref? |
| TextArea | TextField props without type; rows?, textarea ref? |
| Select | label, value, onValueChange, options; disabled?, required?, select ref? |
| Checkbox, Switch | label, checked, onCheckedChange; disabled?, input ref? |
| Dialog | open, title, onClose; children?, pending?, closeLabel?, dialog ref? |
| ConfirmDialog facade | ConfirmInput plus onConfirm, onCancel; body?, errorLabel?, actionAccessibleNames? (opt-in concise Cancel/Confirm names; consequence moves to aria-describedby) |
| Tabs | label, value, items, onValueChange |
| Menu | label, items; disabled? |
| Toast | message; tone?, onDismiss?, dismissLabel? |
| Tooltip | content, children; label? |
| Notice, Badge | children; tone? |
| Spinner | label? |

Select options are `{ value, label, disabled? }`. Tabs items are `{ id, label, content, disabled?, attrs? }`. Menu items are `{ id, label, onPress, disabled?, attrs? }`. Button variants: primary, secondary, danger, warning, ghost. Message tones: info, success, warning, danger.

Value events receive `onValueChange({ value }, {})`; checked events receive `onCheckedChange({ checked }, {})`. Button/Menu action, Dialog close, and Toast dismiss ports receive `({}, {})`. Scheduler run and toast subscription listener ports also receive `({}, {})`. Zero-argument host callbacks remain assignable when they need no event data.

The ReactKit ConfirmDialog component receives `ConfirmViewProps = { controller }`, not the facade's raw callbacks. The controller contains open/pending/title/body/consequence/error, titleAttrs/frameAttrs, guarded cancel/confirm Button prop bags, boundaryRef, overlayContainer, agentMayConfirm, requestDismiss, focusInitial, and optional nativeActions. Raw destructive callbacks are absent.

`AgentAttrsPort` is `({ handle }, { role?, label? }) => KitAttrs`; role is button, field, or select. `KitAttrs` includes optional id and data-jini-part plus opaque data-* and aria-* values. Hosts supply agent handles and validation.

The native subpath exports concrete `nativeKit`, not a forwarding alias to another package. Native implementation functions are internal to that entry.

## React testing entry

`kitConformanceScenarios` is serializable scenario data. Each `KitScenario` has id, component, optional safety/browserOnly flags, props, actions, and expectations. Action types are click/cancel/focus/key. Expectations check attributes, focus, disabled/absent/native-select/focusable targets, or call counts. `ConformanceAction` and `ConformanceExpectation` types are exported.

`runKitConformance({ kit }, { driver?, agent?, only?, scenarios?, includeBrowser? })` returns `Promise<readonly KitConformanceResult[]>`; each result is `{ id, status: 'passed' | 'failed' | 'skipped', errors: readonly string[] }`. `only` filters component names. `scenarios` replaces the default data. The exported `reactConformanceDriver` binds React fixtures to a DOM environment and mounts each provider with guard off, so fallback cannot hide a broken override.

`KitConformanceDriver.run({ kit, scenario, agent }, {})` returns `Promise<readonly string[]>`. BrowserOnly cases report skipped unless includeBrowser is true. Setting includeBrowser with the default React driver throws; a real browser driver must be supplied. The default agent test port emits data-agent-element, data-agent-role, and data-agent-label.

## Deferred APIs

Planned spec entries have no facade/component exports. No Vue or Angular entry, library adapter, motif loader, or consumer migration is implemented in v1. Testing entry details follow its scenario data and driver source; browser-only cases require separate browser execution.

## Handoff

Inputs: package manifest and root/React/native source at package version 0.1.0. Output: current API contract 1.0.0. Risk: custom implementations must preserve semantics and attrs beyond TypeScript shape checks. Next assignee: consumer migration owner; use direct imports and provider ports.
