---
"@jini-ai/ui": minor
---

Add `MediaProviderRowsPort`, a per-provider media-providers transport (`patchProvider({ providerId, fields })`,
`removeProvider({ providerId })`) beside the unchanged whole-map `MediaProvidersPort`, plus `MediaProviderFields`,
`AnyMediaProvidersPort` and `createFakeMediaProviderRowsPort`. `useMediaProvidersTab` and `MediaProvidersTab` accept
either port. With the per-provider port a save sends only the changed providers' editable fields and only an explicit
clear becomes a removal: a provider's absence from the local map is never sent as a deletion.
