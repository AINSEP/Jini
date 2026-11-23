# screens/media

Pieces of a host's Media admin screen, moved here one at a time as each one stops depending on
host-only modules. Not the same thing as `../../media/` (the reusable media domain: providers tab,
formatters, HTML-attribute rules); this folder holds screen-level hooks the host's Media screen
composes. Why the move happens piecewise: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

**Needs injected:** the host's `AdminKit` (via `<AdminKitProvider>`), specifically
`AdminKitValues.openLightboxDialog` / `closeLightboxDialog` for the edit dialog's native
`<dialog>` lifecycle.

**Provides:**
- `hooks/use-edit-media-modal.hooks` — `useEditMediaModal(open, onClose)` returning
  `EditMediaModalController` (`dialogRef`, `handleNativeCancel`, `handleBackdropClick`).

```tsx
import { AdminKitProvider } from "@jini-ai/admin/react/kit";
import { useEditMediaModal } from "@jini-ai/admin/screens/media/hooks/use-edit-media-modal.hooks";

// once, at the host root: the kit's `values` carry openLightboxDialog / closeLightboxDialog
<AdminKitProvider kit={adminKit}>{app}</AdminKitProvider>

function EditMediaModal({ item, onCancel }) {
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useEditMediaModal(item !== null, onCancel);
  return <dialog ref={dialogRef} onCancel={handleNativeCancel} onClick={handleBackdropClick}>…</dialog>;
}
```

**Must never import:** `@jini-ai/ui` / `@jini-ai/ui-kit` at runtime (UI pieces arrive through the
kit), host modules (`@/…`, `#src/…`), or the host's media wire DTO (`AdminMedia` from the host's
`media-api.types`), which stays with the host until a neutral type exists.
