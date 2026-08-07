# Injectable-hook-as-prop pattern on `@jini-ai/admin` — findings

**Date:** 2026-08-06
**Scope:** `packages/admin/src/react/components/{ConfirmDialog,RowMenu,ConfirmButton}`
**Status:** Three components converted. `DataTable.tsx` and `Sidebar.tsx` untouched, both still awaiting an owner decision.

## The pattern

1. Pull a component's local state, refs, and effects out of the component body into a named custom hook (`useConfirmDialog`, `useRowMenu`, `useConfirmButton`).
2. The hook lives in a sibling file inside the component's own directory (`ComponentName/ComponentName.hooks.tsx`), not inline and not in a shared `hooks/` directory.
3. The component takes the hook as a prop, defaulted to the real implementation, so a test can inject a fake without `vi.mock`-ing a module:
   ```tsx
   export function useConfirmDialog(open, pending, onCancel) { /* extracted state */ }
   export function ConfirmDialog({ useDialog = useConfirmDialog, ...props }) {
     const { ... } = useDialog(props.open, props.pending, props.onCancel);
   }
   ```
4. No behavior change. Rendered output, public props (other than the new hook prop itself), and the package's exported surface are unchanged.

## The three conversions

| Component | Relocation commit (pure rename) | Split/wiring commit |
|---|---|---|
| ConfirmDialog | `26420f81` | `dad8890c` (hook extraction itself was `91811601`, done inline before the folder-layout requirement landed) |
| RowMenu | `42885038` | `7a31aa11` |
| ConfirmButton | `ef6056b3` | `248f7f62` |

Each relocation commit is a 100%-similarity, zero-content-diff rename (verified via `git diff --cached --stat -M` showing `0 insertions(+), 0 deletions(-)` before committing) so `git log --follow` traces each component's full history correctly. Doing the `git mv` and the content split in the same commit was tried first on ConfirmDialog and produces the wrong result: git's rename-detection heuristic attributes the *old* file's history to the new hooks file instead of the component, because the hook body is copied more verbatim than what's left in the component. Splitting into two commits avoids that.

Each component: scoped test suite green before and after, unmodified except for one added test exercising the injection seam; `tsc --noEmit` clean; barrel exports (`index.ts`) confirmed unchanged in shape, only the source specifier moved.

## Did the seam buy new test coverage? No, in all three cases.

This is the finding worth being blunt about: in every single case, the component's hard-to-test behavior was **already** fully exercised by the existing test suite, through a different technique, before this refactor touched it.

- **ConfirmDialog.** `dialog.showModal()`/`dialog.close()` are the actual jsdom gap here — jsdom implements neither method. The component already handled this with a `typeof dialog.showModal === 'function'` guard (falls back to toggling the plain `open` attribute). That guard alone was sufficient for all 17 pre-existing tests to exercise the real hook, unmodified, both before and after the split. The one test I added (fake hook, asserts the fake's `titleId` and click handler reach the DOM instead of the real ones) proves the DI wiring itself works — it does not exercise any behavior that wasn't already covered.

- **RowMenu.** I predicted, before reading the file, that this would be the exception — real `getBoundingClientRect`-driven positioning math is exactly the kind of thing jsdom fakes badly. Wrong. `RowMenu.test.tsx` already had a test ("flips above when the trigger sits at the bottom of the viewport", original lines ~193–218) that drives the *real* positioning algorithm end-to-end by `vi.spyOn`-mocking `getBoundingClientRect`, `offsetHeight`/`offsetWidth`, and `window.innerHeight`/`innerWidth` with real numbers. jsdom's zero-sized-rect problem was already solved — with prototype-level spying, not an injectable seam — and it exercises the actual math, which a fake hook by construction cannot. I retracted the prediction once I'd actually read the test file, before writing the extraction.

- **ConfirmButton.** No jsdom gap existed at all. Plain `fireEvent` (click, keydown, mousedown, blur) already drove every armed/disarmed transition through the real hook.

Three for three: the pattern did not unlock coverage that wasn't already reachable. Each new "injection" test I added proves the mechanism is wired correctly, which is a real but narrow thing to prove — not new behavioral coverage.

## The real cost

Each hook's exact call signature is now indirectly part of the package's public API. All three prop types live on exported interfaces re-exported from the barrel (`index.ts`), consumed by Tovu via `dist`:

- `ConfirmDialogProps.useDialog?: typeof useConfirmDialog`
- `RowMenuProps.useRowMenu?: typeof useRowMenu`
- `ConfirmButtonProps.useConfirmButton?: typeof useConfirmButton`

No real caller is expected to ever pass a value for these — they exist to let tests *inside this package* substitute a fake. But because the prop is optional and typed against the hook's own signature, every consumer's editor autocomplete now shows it, and changing a hook's parameter list later is a breaking type change to an exported interface, which was not true before this pattern existed. That is a permanent, if small, widening of the public surface for a testing-only concern.

## Naming inconsistency — flagged, not fixed

ConfirmDialog's prop is `useDialog` (different from the hook's own name, `useConfirmDialog`). RowMenu and ConfirmButton both use the same-name convention (`useRowMenu` prop for `useRowMenu` hook; `useConfirmButton` prop for `useConfirmButton` hook), which is more discoverable — the prop name tells you exactly what it replaces without an extra lookup. ConfirmDialog is the outlier, 1 of 3, because I picked `useDialog` before settling on the better convention on the next two components.

Exact diff to align it (not applied — touches an exported interface, owner's call):

```diff
--- a/packages/admin/src/react/components/ConfirmDialog/ConfirmDialog.tsx
+++ b/packages/admin/src/react/components/ConfirmDialog/ConfirmDialog.tsx
@@ ConfirmDialogProps
-  useDialog?: typeof useConfirmDialog;
+  useConfirmDialog?: typeof useConfirmDialog;
@@ ConfirmDialog
-export function ConfirmDialog({ useDialog = useConfirmDialog, ...props }: ConfirmDialogProps) {
-  const { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick } = useDialog(
+export function ConfirmDialog({ useConfirmDialog: useConfirmDialogState = useConfirmDialog, ...props }: ConfirmDialogProps) {
+  const { titleId, dialogRef, cancelRef, handleNativeCancel, handleBackdropClick } = useConfirmDialogState(
```
```diff
--- a/packages/admin/src/react/__tests__/components/ConfirmDialog.test.tsx
+++ b/packages/admin/src/react/__tests__/components/ConfirmDialog.test.tsx
-    const { onCancel } = renderDialog({ useDialog: useFakeDialog });
+    const { onCancel } = renderDialog({ useConfirmDialog: useFakeDialog });
```

## What the pattern did buy

Not coverage. What it actually bought, in all three cases:

- **Smaller component bodies.** Each component file is now JSX plus prop-shape declarations, with the state machine (refs, effects, handlers) in its own file. ConfirmButton's component file dropped from 132 lines to roughly half that.
- **A named single entry point** for "everything interactive about this component" — `useConfirmDialog`/`useRowMenu`/`useConfirmButton` — that is independently readable and independently a target for future changes, without touching render logic.
- **A provable seam**, not a merely-plausible one. Each component now has one test that demonstrates the injection point is actually wired end-to-end, which forecloses "looks injectable in the source but isn't actually used by the render path" as a class of bug.
- **A repeatable move for when the payoff condition is eventually true.** None of these three happened to have jsdom-unreachable behavior that wasn't already solved another way. A future component that genuinely does (a real network call, a `ResizeObserver`, a timer-driven animation with no existing spy-based workaround) now has a proven pattern to reach for, with two real commits and a report to point at instead of a fresh design discussion.

## Recommendation: don't extend this by default

Do not apply this pattern to `DataTable.tsx` or `Sidebar.tsx` as a uniformity move. Apply it only where both hold: (a) there is genuine local state to extract — not a context read, which this pattern actively fights (see the Sidebar plan below) — and (b) there's a specific reason to expect a payoff beyond restructuring, checked *before* doing the work, the same way RowMenu's predicted payoff was checked and found not to hold.

- **DataTable.tsx** — not inspected as part of this dispatch; still owner-gated regardless. If and when it's unblocked, check first whether its harder-to-test paths (if any — e.g. any measurement, virtualization, or scroll-driven behavior) are already covered by an existing test technique, the same way ConfirmDialog/RowMenu/ConfirmButton turned out to be, before assuming this pattern will pay off there.

- **Sidebar.tsx** — covered in a separate plan already sent to the coordinator. Short version: 3 of its 5 compound sub-components (`Nav`, `Footer`, `RailToggle`) have no local state of their own to extract — they're either zero-hook (`Footer`) or pure `useSidebar()` context consumers, and injecting a fake there means faking the context read itself, which is exactly the design context exists to avoid. The 2 that do have local state (`SidebarRoot`'s tooltip state, `MobileHeader`'s focus-on-open effect) are already fully exercised by the existing 307-line test suite through real interaction — same "already covered" pattern as the three components in this report. `useSidebarRail`/`useNavSections` are already separately extracted as named hooks (the first half of this pattern); adding prop-injectability to them specifically is a live, unresolved question the owner has repeatedly reversed on mid-session — not re-litigated here.
