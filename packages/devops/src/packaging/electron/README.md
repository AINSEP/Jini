# packaging/electron

Pure packaging policies and staging helpers for an Electron shell, exported from
`@jini-ai/devops/packaging/electron`. Architecture: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

### `treeQuietProblems` (policies.ts)

- **Needs injected:** the live signals the host probed itself — `surface` (the packaged root's
  display name), `watcherRunning`, `gitDirtyPaths`, `movingPaths` (two live snapshots diffed, never
  an absolute mtime age). Optionally `formatters: TreeQuietFormatters` (`watcherRunning`,
  `gitDirty`, `moving`) for host wording; each omitted formatter keeps the neutral default.
- **Provides:** one human-readable problem per fired signal, in signal order; `[]` means quiet for
  that sample only — the host must still byte-verify the finished archive after packaging.
- **Must never import:** process spawning, filesystem probing, host logging/console formatters or
  product copy. The host gathers signals, prints, and owns the exit code.

```ts
import { treeQuietProblems, type TreeQuietFormatters } from '@jini-ai/devops/packaging/electron';

const formatters: TreeQuietFormatters = {
  moving: ({ surface, paths }) => `${surface} is still being written to: ${paths.join(', ')}. Wait for the writer.`,
};
const problems = treeQuietProblems(
  { surface: 'apps/shell', watcherRunning: probeWatcher(), gitDirtyPaths: probeGit(), movingPaths: diffSnapshots() },
  { formatters },
);
if (problems.length > 0) { for (const p of problems) report(p); process.exitCode = 1; }
```

### Move to Applications prompt (move-to-applications.ts)

Exported from its own subpath, `@jini-ai/devops/packaging/electron/move-to-applications`.

- **Needs injected:** `MovePromptEnvironment` (launch facts incl. `appName` and the count of other
  live copies), `MovePromptDeps` (Electron's `ask`/`move`/`openExisting`/`quit`/dialog calls,
  `readExistingVersion`, `recordDeclined`, and the host copy `messages: MovePromptMessages`),
  a `DeclinedVersionStore` (the host's atomic durable JSON helper) plus the decline file path, and
  a `ReadTextFile` for `readBundleVersion`.
- **Provides:** the skip policy, the per-version "Not Now" memory, the `/Applications` clash
  decision (`replace` / `open-existing` / `blocked-by-running-copy`) and the whole prompt flow,
  which never throws on a failed move.
- **Must never import:** `electron`, the filesystem, a durable JSON implementation from another
  package, host console/logging, or product copy, app names and data paths.

```ts
import { movePromptSkipReason, readDeclinedVersion, runMoveToApplicationsPrompt } from '@jini-ai/devops/packaging/electron/move-to-applications';

const store = { readJsonFile, writeJsonFileAtomic };            // host's durable JSON helper
const filePath = path.join(app.getPath('userData'), 'move-decline.json');
const skip = movePromptSkipReason({ appName, platform: process.platform, isPackaged: app.isPackaged, isMas: process.mas === true,
  selftest, unattended, inApplications: app.isInApplicationsFolder(), otherInstancesOpen, currentVersion: app.getVersion(),
  declinedVersion: readDeclinedVersion({ filePath, store }) });
if (skip === null) await runMoveToApplicationsPrompt({ ...electronSeams, messages: HOST_MOVE_COPY, targetPath, currentVersion });
```
