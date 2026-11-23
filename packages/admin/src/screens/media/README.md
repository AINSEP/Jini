# screens/media

Pieces of a host's Media admin screen, moved here one at a time as each one stops depending on
host-only modules. Not the same thing as `../../media/` (the reusable media domain: providers tab,
formatters, HTML-attribute rules); this folder holds screen-level hooks the host's Media screen
composes. Why the move happens piecewise: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

**Needs injected:** `openLightboxDialog` / `closeLightboxDialog` for the edit dialog's native
`<dialog>` lifecycle, passed as required args to `useEditMediaModal`. The host binds them at its
call site from its `AdminKitValues` (e.g. `useAdminKitValues()` under its `<AdminKitProvider>`);
the hook itself never reads the kit.

**Provides:**
- `hooks/use-edit-media-modal.hooks` — `useEditMediaModal({ open, onClose, openLightboxDialog, closeLightboxDialog }, _optional = {})` returning
  `EditMediaModalController` (`dialogRef`, `handleNativeCancel`, `handleBackdropClick`).
- `hooks/use-media-card-metadata.hooks` — `useMediaCardMetadata({ item }, { locale?, formatters? })`
  returning the card's size/upload-date line. `item` is the structural slice
  `MediaCardMetadataSource` (`byteSize?: number | null; createdAt: string`); `formatters`
  (`MediaMetadataFormatters`) is optional and defaults to `@jini-ai/core/text`'s `formatByteSize`
  plus `../../media/rules`'s `formatUploadDate`.
- `hooks/use-media-card-details.hooks` — `useMediaCardDetails<Item>({ onToggleEdit }, { matchMedia? })`
  returning `{ isPhone, openDetails }`; `Item` is whatever the host's edit action takes, passed through
  untouched. `matchMedia` defaults to `window.matchMedia` (absent on the server → desktop card).

The card hooks need nothing injected; the host passes its own media item (its wire DTO is
structurally assignable to the slices above, so no host type crosses into this package):

```tsx
import { useMediaCardMetadata } from "@jini-ai/admin/screens/media/hooks/use-media-card-metadata.hooks";
import { useMediaCardDetails } from "@jini-ai/admin/screens/media/hooks/use-media-card-details.hooks";

const metadata = useMediaCardMetadata({ item: hostMediaItem }, { locale });
const { isPhone, openDetails } = useMediaCardDetails({ onToggleEdit: (item: HostMedia) => openEditor(item) });
```

```tsx
import { useAdminKitValues } from "@jini-ai/admin/react/kit";
import { useEditMediaModal } from "@jini-ai/admin/screens/media/hooks/use-edit-media-modal.hooks";

function EditMediaModal({ item, onCancel }) {
  // The host binds the dialog helpers from its own kit and passes them in.
  const { openLightboxDialog, closeLightboxDialog } = useAdminKitValues();
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useEditMediaModal({
    open: item !== null, onClose: onCancel, openLightboxDialog, closeLightboxDialog,
  });
  return <dialog ref={dialogRef} onCancel={handleNativeCancel} onClick={handleBackdropClick}>…</dialog>;
}
```

**Must never import:** `@jini-ai/ui` / `@jini-ai/ui-kit` at runtime (UI pieces arrive through the
kit), host modules (`@/…`, `#src/…`), or the host's media wire DTO (`AdminMedia` from the host's
`media-api.types`), which stays with the host until a neutral type exists — a hook here declares
the structural slice it reads (or a type parameter for a pass-through) instead.
