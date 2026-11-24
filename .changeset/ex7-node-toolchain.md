---
"@jini-ai/desktop-host": patch
---

`@jini-ai/desktop-host/node-toolchain` adds `prepareNodeToolchainEnvBestEffort` (best-effort toolchain env preparation that reports `NodeToolchainSetupEvent`s to an injected sink and never throws) and `createSiteDiscoveryLanes` (independent rescan and picker-validation cancellation lanes with a before-quit `abortAll`; a synchronously failing discoverer rejects instead of throwing into boot).
