---
"@jini-ai/admin": patch
---

Move the Media screen's edit-dialog lifecycle hook from the host (A-K2-media-1, 1 file): `@jini-ai/admin/screens/media/hooks/use-edit-media-modal.hooks`. The dialog open/close helpers now come from the host kit (`AdminKitValues.openLightboxDialog`/`closeLightboxDialog`).
