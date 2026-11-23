---
"@jini-ai/core": patch
---

Add five additive type contracts copied from their owning packages, which keep their identical declarations until the paired cutover: `./contracts/site/protocol-mcp-ui` (`UIResourceUri`, `UIResource`), `./contracts/site/secrets-credential-sets` (`SecretsVaultService` as a port interface over the platform class's public methods, with `VaultPutInput`, `VaultCopyInput`, `VaultRotateOptions`), `./contracts/site/devops-deploy` (`ArtifactStorePort`, `ArtifactUpload`, `DeployTargetCredential`), `./contracts/site/cms-media` (`MediaRepoPort`, `TransformParams`, `ImageCodecPort` and their closure) and `./contracts/site/daemon-tool-audit` (`ToolAttemptAuditSink`, `ToolAttemptEvent`, `ToolGapEntry`).
