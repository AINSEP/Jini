---
"@jini-ai/devops": patch
---

`@jini-ai/devops/deploy` exports the deploy contribution contracts: the parsers `parseDeployTargetsFile`, `parseDeployOpsFile` and `parseDeployConfigsFile`, the module validators `asDeployTargetModule`, `asDeployOpsModule` and `asDeployConfigGeneratorModule`, `isContainedDeployConfigPath`, and the descriptor, registry and module types for deploy targets, deploy ops and deploy config generators. The installed deploy-target ABI types carry a `Plugin` prefix (`PluginDeployTargetModule`, `PluginDeployHostKit`, ...) so they do not collide with the package's own port names.
