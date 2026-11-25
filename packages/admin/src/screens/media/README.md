# screens/media

Pieces of a host's Media admin screen, moved here one at a time as each one stops depending on
host-only modules. Not the same thing as `../../media/` (the reusable media domain: providers tab,
formatters, HTML-attribute rules); this folder holds screen-level hooks the host's Media screen
composes. Why the move happens piecewise: `ADS-memory/reports/jini-port/extraction-plan.md`.

## Wiring

- `hooks/media-port.hooks` declares `MediaPort` (types only); the host binds the real API client
  in its own dependencies module and passes the port into every media hook.

**Needs injected:** `openLightboxDialog` / `closeLightboxDialog` for the edit dialog's native
`<dialog>` lifecycle, passed as required args to `useEditMediaModal`. The host binds them at its
call site from its `AdminKitValues` (e.g. `useAdminKitValues()` under its `<AdminKitProvider>`);
the hook itself never reads the kit.

**Provides:**
- `hooks/use-edit-media-modal.hooks` — `useEditMediaModal({ open, onClose, openLightboxDialog, closeLightboxDialog }, _optional = {})` returning
  `EditMediaModalController` (`dialogRef`, `handleNativeCancel`, `handleBackdropClick`).
- `hooks/use-media-card-metadata.hooks` — `useMediaCardMetadata({ item }, { locale?, viewerTimeZone?, formatters? })`
  returning the card's size/upload-date line. `item` is the structural slice
  `MediaCardMetadataSource` (`byteSize?: number | null; createdAt: string`); `formatters`
  (`MediaMetadataFormatters`) is optional and defaults to `@jini-ai/core/text`'s `formatByteSize`
  plus `../../media/rules`'s `formatUploadDate`. The date is the viewer's calendar day in `viewerTimeZone`
  (IANA zone the host injects; omitted, UTC).
- `hooks/use-media-card-details.hooks` — `useMediaCardDetails<Item>({ onToggleEdit }, { matchMedia? })`
  returning `{ isPhone, openDetails }`; `Item` is whatever the host's edit action takes, passed through
  untouched. `matchMedia` defaults to `window.matchMedia` (absent on the server → desktop card).

- `grid-size` — `MEDIA_GRID_SIZES`, `MediaGridSize`, `parseMediaGridSize({ value })` (pure; unknown values
  fall back to `medium`).
- `hooks/use-media-grid-size.hooks` — `useMediaGridSize({ storageKey }, _optional = {})` returning
  `[size, setSize]`. **Needs injected:** `storageKey`, the browser-storage key the choice is remembered
  under. It is an owner default, so the host keeps the literal and passes it at its call site
  (`useMediaGridSize({ storageKey: HOST_MEDIA_GRID_SIZE_STORAGE_KEY })`). Unavailable storage only means
  the choice lasts for the visit.

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
kit), host modules (`@/…`, `#src/…`), or a host copy of the media wire DTO — `AdminMedia` now lives in
`@jini-ai/core/contracts/site/cms-admin-media` and is imported from there; older hooks here still
declare the structural slice they read (or a type parameter for a pass-through).
