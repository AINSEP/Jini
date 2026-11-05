# Memory Regression — Browser Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test runner, routes, selectors, and CI setup.

## When to Use

Browser-based SPA memory regression testing. Any frontend framework (Vue, React, Angular, Svelte, Solid, vanilla JS). Requires Chromium — CDP is not available in Firefox/WebKit.

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| JS Heap Used | `Performance.getMetrics` → `JSHeapUsedSize` | Object/closure retention |
| DOM Node Count | `Performance.getMetrics` → `Nodes` | Detached DOM trees |
| Event Listener Count | `Performance.getMetrics` → `JSEventListeners` | Unremoved listeners |
| Document Count | `Performance.getMetrics` → `Documents` | Iframe/window leaks |
| Browser Process RSS | OS-level `ps` on browser PID tree | Native/GPU/image memory |

## Prerequisites

- Playwright with Chromium (CDP requires it)
- Add skip guard: `test.skip(browserName !== 'chromium', 'Requires CDP')`
- CDP session: `const client = await page.context().newCDPSession(page)`
- Enable metrics: `await client.send('Performance.enable')`

## Platform Gotchas

1. **Use SPA navigation, not `page.goto()` for component leak detection.** Full document navigation destroys/recreates the page, hiding component-level leaks. Use in-app clicks/router navigation. Reserve `page.goto()` for document/window leak tests only.

2. **`HeapProfiler.collectGarbage` is reliable** on Chromium — unlike `System.gc()` on JVM. Always call before measurement.

3. **Heap snapshots can be 100+ MB.** Stream to disk, never accumulate in memory:
   ```javascript
   // Pattern fragment: stream snapshot to disk for diagnosis
   const stream = fs.createWriteStream('diagnosis.heapsnapshot');
   client.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => stream.write(chunk));
   await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
   stream.end();
   ```

4. **DOM `Nodes` count is total, not detached.** A growing count indicates leaks, but stable-high may just be a large page. Compare growth across iterations, not absolute value.

5. **Browser RSS is multi-process.** Chromium spawns renderer, GPU, and utility processes. Measuring only the main PID misses most memory. You must recursively walk the process tree (not just direct children). Only available for locally-launched browsers (`browser.process()` returns null for remote grids). Consider this metric advisory/secondary — JS heap metrics via CDP are more reliable for leak detection.

6. **Warmup is essential.** Chromium internal caches, JIT, lazy module loading all allocate on first use. Allow 2-3 warmup iterations before baseline.

7. **Viewport size affects memory.** Larger viewports = more pixels = more GPU/compositor memory. Fix viewport in tests for consistent results.

## Key API Surface

```javascript
// Pattern fragment: measurement helpers (adapt to your test runner)
async function getMetric(client, name) {
  const { metrics } = await client.send('Performance.getMetrics');
  return metrics.find(m => m.name === name).value;
}

// Core measurement points:
await client.send('HeapProfiler.collectGarbage');     // force GC
const heapUsed = await getMetric(client, 'JSHeapUsedSize');  // bytes
const nodeCount = await getMetric(client, 'Nodes');           // count
const listenerCount = await getMetric(client, 'JSEventListeners'); // count
```

## Measurement Recipe (Pseudocode)

```
setup CDP session on Chromium page
navigate to app

WARMUP: repeat user flow 2-3x (stabilize caches/JIT)
CLEANUP: collectGarbage
BASELINE: read JSHeapUsedSize, Nodes, JSEventListeners

STRESS: repeat leak-suspected flow N times (use in-app navigation)
CLEANUP: collectGarbage
AFTER: read same metrics

ASSERT: (after - baseline) < budget for each metric
ON FAILURE: capture heap snapshot, diff against baseline, report top retainers
```

## Anti-Patterns (Things Agents Must Avoid)

- Using `page.goto()` in a loop to test SPA component leaks (hides them)
- Measuring before warmup (false baseline inflation)
- Accumulating heap snapshot chunks in a JS array (OOMs the test runner)
- Asserting RSS on remote browser grids (cannot access process PID)
- Using `performance.memory` (deprecated, bucketed precision, security-limited)
- Not consuming/closing resources in test teardown (test itself leaks)

## Common Browser Leak Sources

- `ResizeObserver` / `IntersectionObserver` / `MutationObserver` not disconnected
- `addEventListener` on `window`/`document` without corresponding removal
- Detached DOM trees held by JS references after removal
- Web Workers created but never terminated
- Canvas 2D contexts exceeding browser limit
- WebSocket/EventSource connections not closed
- IndexedDB/Cache API storing unbounded data
- Third-party libs (charts, maps) without `.destroy()` cleanup

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| JSHeapUsedSize growing linearly | Heap snapshot diff → find retained objects by type |
| Nodes growing but heap stable | Detached DOM nodes → check unmount cleanup |
| JSEventListeners growing | Find listener registration sites without removal |
| RSS growing but heap stable | Native/GPU leak → check images, canvas, WebGL, workers |

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Target flow (which routes/interactions to repeat)
- [ ] Selectors for navigation (data-testid or similar)
- [ ] Test runner (Playwright Test, Vitest, custom)
- [ ] Warmup iteration count
- [ ] Stress iteration count
- [ ] Budget per metric (heap MB, node count, listener count)
- [ ] Whether this is diagnostic-only or promoted gate
