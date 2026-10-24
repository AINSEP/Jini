# @jini-ai/ui-kit

## 0.6.11

## 0.6.10

## 0.1.5 — 2026-10-22

- 2026-10-22: Complexity refactors, coverage.

## 0.1.4 — 2026-10-13

- Break facade/native import cycles: native dialogs pick the provider's Button through a context-only lookup (`NativeButton` fallback; `nativeActions` still forces native), and `ToastRegion` creates its Toast elements. No API change.

## 0.1.2

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.1.1).

## 0.1.1 — 2026-10-05

- Native menu items step by their position among enabled items (from the render closure) instead of re-querying the menu ref. Same order as `focus()`; arrow keys skip a disabled item. Behavior unchanged.

## 0.1.0

- First published release.
