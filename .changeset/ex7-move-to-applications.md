---
"@jini-ai/devops": patch
---

Add `@jini-ai/devops/packaging/electron/move-to-applications`: the macOS "Move to Applications" prompt policy (`movePromptSkipReason`, `decideMoveConflict`, `compareVersions`, `bundlePathFromExecPath`, `applicationsTargetPath`, `readBundleVersion`, `readDeclinedVersion`/`recordDeclinedVersion`, `runMoveToApplicationsPrompt`). The host injects Electron's calls, its prompt copy (`MovePromptMessages`, `appName`), the decline-file path, a durable JSON store port (`DeclinedVersionStore`) and a text reader (`ReadTextFile`).
