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
