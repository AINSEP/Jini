Spec ID: SPEC-JINI-UI-KIT-BEHAVIOR
Version: 1.0.0
Last Edited: 2026-10-03
Hash: sha256:782897964f3356bc26f737eaa2be50dcd68cd3258d8a7802990211ae09e79cb5
spec_mode: implementation_spec

# UI-kit behavior

## Resolution and requirements

Every implemented component resolves to an injected override or its native default. Missing providers use native defaults. Partial kit creation ignores explicit undefined and preserves defaults. Strict kit creation requires all 16 components. Extension carries forward base overrides; unrelated components keep their native implementation. Requirements validate contract compatibility and implemented status before rendering provider children.

Duplicate package copies share the actual React context object through `Symbol.for('@jini-ai/ui-kit/react/context@1')` on globalThis. Development version skew produces a warning. The host supplies a compatible React runtime.

## Attrs and controls

Opaque attrs are forwarded to the declared focus target, preserving host agent metadata, labels, and part identity. Core control state still governs disabled/value behavior. Button pending or disabled suppresses presses. Text and checked controls are controlled and notify changes through their supplied ports. Select preserves native select semantics through an HTMLSelectElement; a custom adapter may keep a synchronized native select.

Tabs use roving tab focus, skip disabled tabs, and implement left/right/Home/End navigation with labelled panels. Menu uses enabled items for up/down/Home/End navigation; Escape restores trigger focus, Tab closes, and pointer interaction outside closes. Tooltip opens on focus/hover, closes on blur/leave/Escape, and associates its content with the trigger. Notices and toasts expose status/alert roles according to tone. Spinners have an accessible loading label.

## Dialog and confirmation

Native Dialog opens with showModal where supported, associates its title, and restores the connected opener when closed. The non-browser fallback sets an open attribute. Pending Dialog blocks close button, native cancel, and backdrop dismissal.

Confirmation safety is framework-free. Each invocation reads current policy; stale callbacks cannot bypass a subsequent pending/open update. Confirmation sets executing synchronously before invoking the action, preventing duplicate calls in the same render frame. While executing or pending, confirmation and all dismissal reasons are refused. Closed confirmation refuses actions. Agent confirmation is refused when agentMayConfirm is false.

The React facade supplies guarded handlers and prop bags to the chosen view. Default actions use the host's Button override. Cancel receives initial focus. Cancel labels communicate that no action occurs. Confirmation's accessible label includes action, title, and consequence. Danger defaults to "cannot be undone"; warning defaults to "changes access, but is reversible"; a supplied consequence replaces the default. Human-only confirmation withholds its agent handle while leaving human action available.

A rejected async action shows the facade's errorLabel or a generic retry message. Execution clears in finally; the host retains control of open state and closing after success.

## Development guard

When a ConfirmDialog or Button override is used, the development guard inspects committed DOM after effects: frame presence/overlay ownership, alertdialog and title semantics, visible focusable action parts, forwarded attrs, pending disabled state, cancel-first focus, human-only agent metadata, and consequence label. Violations are recorded and logged. Default fallback marks ConfirmDialog failed and renders the native frame with native actions, so a broken Button override cannot break the fallback again. Warn mode retains the override; off mode bypasses checks and fallback. Checks are not run in production.

The guard observes the mounted implementation; a shape-compatible TypeScript component is insufficient evidence of conformance. jsdom cannot prove top-layer, layout, or native browser focus trapping.

## Overlays and toast lifetime

A provider uses its supplied overlayContainer or creates an owned body child and removes it on unmount. Dialog, ConfirmDialog, and ToastRegion render into the resolved overlay. Before a container exists, Overlay renders inline.

A toast service owns a queue, stable snapshots between updates, subscribers, and dismissal timers. Pushing an existing id replaces its prior message/timer. The default duration is 5000 ms; zero or negative duration disables auto-dismissal. Dismissal removes the message and timer. Disposal cancels all timers, clears messages, emits the cleared snapshot, then clears listeners. Services never share a global queue. Providers dispose only services they created. Hosts mount ToastRegion explicitly.

## Conformance evidence

Conformance scenarios are data with a React driver. Default execution skips tagged browser-only cases and reports those skips. This behavior contract does not claim that tests or a browser runner passed; delivery evidence must name actual commands/results separately.

## Handoff

Inputs: root controller/toast rules and React/native implementation. Output: v1 resolution, safety, navigation, overlay, and lifetime behavior. Risks: custom library adapters and browser modal behavior require host/browser validation. Next assignee: consumer migration owner, then browser validation owner.
