# `src/checks`

Repository and build checks exposed through `@jini-ai/devops/checks/*`. Each check takes its
inputs and effects as arguments; the host binds the real filesystem, process and libraries.

| file | entry | what |
|---|---|---|
| `node.ts` | `./checks/node` | Node adapters (filesystem, process runner, env loader, npm installer) and the re-exports of the Node-only checks below. |
| `bundle-mount-smoke.ts` | `./checks/node` | Post-build mount smoke: executes a built self-mounting bundle per scenario in a fresh host-supplied DOM. |
| `hardwiring.ts`, `hardwiring-node.ts` | `./checks/node` | Hardwiring inspector and its Node runner. |
| `env-access.ts` | `./checks/env-access` | `process.env`/`import.meta.env` access inspector. |
| `memory-soak.ts` | `./checks/memory-soak` | Memory soak check. |
| `coverage/`, `published-types/` | `./checks/coverage`, `./checks/published-types` | Coverage policies; published type-surface checks. |

## Wiring

Post-build smoke: the host supplies `createDom` (e.g. jsdom), the mount id, page HTML and
scenarios; Jini executes the built bundle per scenario in a fresh DOM and fails on any load or
post-mount error.

```js
import { checkBundleMounts, runBundleCheckCli, isEntryPoint } from '@jini-ai/devops/checks/node';
import { JSDOM } from 'jsdom';

// A NEW DOM per call; `dispose` runs in a finally on every exit, pass or fail.
const createDom = ({ html, url }) => {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  return { window: dom.window, onConsoleError: (listener) => dom.virtualConsole.on('jsdomError', listener), dispose: () => dom.window.close() };
};
const check = ({ bundleSource }) => checkBundleMounts(
  { bundleSource, scenarios, createDom, mountId: 'app-root', pageHtml: '', url: 'http://localhost/' },
  { log: console.log, label: 'check-bundle-mounts' },
);
if (isEntryPoint({ moduleUrl: import.meta.url, argv1: process.argv[1] })) {
  await runBundleCheckCli({ bundlePath, readText: (file) => readFileSync(file, 'utf8'), check, error: console.error, exit: process.exit });
}
```

- `createDom`, `mountId`, `pageHtml`, `url`, `scenarios` are required; `wait` (settle-wait port,
  default a real timer), `settleMs` (default 150), `log`, `label` are optional.
- A scenario's `seed({ storage })` runs before the bundle; `verify({ storage, document, navigationAttempts })`
  after the mount check. `fail({ message })` inside either reports a check failure.
- The CLI never touches `process` itself: `readText`, `error` and `exit` are required arguments.
- Live consumer: the original host's site-chat `scripts/check-bundle-mounts.mjs` (scenarios, storage
  keys and mount id stay there).
