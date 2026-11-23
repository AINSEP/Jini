---
"@jini-ai/core": patch
---

Add five type-only contracts. `./contracts/site/core-public-page-security-headers` (`PublicThemeResources`) and `./contracts/site/core-theme-slots` (`ThemeSlotDescriptor`) carry host-neutral theme shapes. `./contracts/site/lifecycle-host-tools` (`ProviderStatusRow`, `ProviderStatusPorts`, `ProviderSettingFieldProjection`, `PluginMaturity`), `./contracts/site/analytics` (`DeviceClass`, `HitKind`, `NormalizedHit`, `IngestBeacon`, `IngestContext`, `UtmParams`) and `./contracts/site/host-node` (`PluginDiscoveryRecord`, `PluginPackageFiles`, `PluginInstallerPort` and their manifest closure) are additive copies of the declarations in `@jini-ai/agent-plugins/lifecycle/host-tools`, `@jini-ai/analytics` and `@jini-ai/plugins/host/node`; those packages keep their identical declarations and exports until the paired cutover.
