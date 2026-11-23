---
"@jini-ai/devops": minor
---

`@jini-ai/devops/checks/node` adds the post-build mount smoke harness: `runBundleScenario`, `checkBundleMounts`, `runBundleCheckCli`, `isEntryPoint`, `BundleCheckError`, `fail` and `isNavigationError`. The host supplies `createDom` (a fresh DOM per scenario, e.g. jsdom, with `dispose`), the mount id, page HTML, url and scenarios; the built bundle is executed once per scenario, the DOM is disposed on every exit, and any load or post-mount error fails the check. The settle wait and the CLI's file read, stderr and exit are injected.
