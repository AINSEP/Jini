/** Owner-directed (2026-08-24): "Custom Media API" — the local/self-hosted-friendly, no-vendor-
 *  lock-in option — should always be the first card on this tab, not wherever the configured-
 *  first/alphabetical sort (`sortProvidersByConfigured`) happens to place it. Passed straight
 *  through to `MediaProvidersTab`'s `pinnedProviderIds` prop. */
export const PINNED_MEDIA_PROVIDER_IDS: readonly string[] = ["custom-image"];
