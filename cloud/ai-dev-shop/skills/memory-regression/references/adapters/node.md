# Memory Regression — Node.js Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test runner, server setup, endpoints, and CI config.

## When to Use

Node.js backend services, CLI tools, workers, data pipelines. Any framework (Express, Fastify, NestJS, Hono, plain HTTP, Koa).

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| Heap Used | `process.memoryUsage().heapUsed` | JS object retention |
| RSS | `process.memoryUsage().rss` | Total process memory (includes native) |
| External | `process.memoryUsage().external` | C++ bindings, Buffers, native addons |
| Array Buffers | `process.memoryUsage().arrayBuffers` | ArrayBuffer/SharedArrayBuffer |
| Active Handles | `process.getActiveResourcesInfo()` (Node 17+) | Open handles, timers, sockets |
| Event Loop Lag | `perf_hooks.monitorEventLoopDelay` | GC pressure indicator |

## Prerequisites

- Launch with `--expose-gc` to enable `global.gc()` (reliable on V8)
- Node 18+ for global `fetch` (or use `http` module / `undici`)
- Node 17+ for `process.getActiveResourcesInfo()`
- Both `node --expose-gc ./node_modules/.bin/vitest` and `NODE_OPTIONS='--expose-gc'` work on modern Node (18+). Prefer the direct flag for explicitness; `NODE_OPTIONS` is acceptable when you can't control the launch command
- Always verify: `if (typeof global.gc !== 'function') throw new Error('--expose-gc required')`

## Platform Gotchas

1. **`global.gc()` is reliable** — unlike JVM, V8 honors it immediately when `--expose-gc` is set. Always call before measurement.

2. **RSS includes native allocations.** Don't use RSS alone for JS leak detection — it includes V8 internals, C++ bindings, and allocator retention. Use `heapUsed` for JS leaks, RSS as a secondary signal.

3. **Allocator may not return memory to OS.** RSS can stay high after GC because the memory allocator holds freed pages for reuse. This is not a leak — it's allocator behavior. Only flag RSS growth that is monotonically increasing across many cycles.

4. **Always drain HTTP response bodies.** Unconsumed responses keep sockets and buffers alive, polluting both handle counts and memory measurements:
   ```javascript
   // Pattern fragment: proper request helper
   async function request(url, options) {
     const res = await fetch(url, options);
     await res.arrayBuffer(); // drain body to release connection
     if (!res.ok) throw new Error(`${url} returned ${res.status}`);
   }
   ```

5. **Server must be listening before `server.address()`.** Wait for the `listening` event or use a promise-based server start.

6. **EventEmitter MaxListeners warning is a late indicator.** By the time you see it, you've already stacked 11+ listeners. The leak started much earlier.

## Key API Surface

```javascript
// Pattern fragment: measurement helpers

// Force GC (requires --expose-gc)
global.gc();

// Full memory snapshot
const mem = process.memoryUsage();
// mem.heapUsed, mem.rss, mem.external, mem.arrayBuffers

// Active resource tracking (Node 17+)
const handles = process.getActiveResourcesInfo();
// Returns: ['TCPSocketWrap', 'Timeout', 'FSReqCallback', ...]

// Heap snapshot for diagnosis
import v8 from 'v8';
v8.writeHeapSnapshot(); // writes to cwd, returns filename

// Event loop lag (GC pressure indicator)
import { monitorEventLoopDelay } from 'perf_hooks';
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
// ... stress ...
h.disable();
const p99ms = h.percentile(99) / 1e6;
```

## Measurement Recipe (Pseudocode)

```
start server with --expose-gc
create HTTP client

WARMUP: send N requests (fill caches, JIT, lazy init)
CLEANUP: global.gc()
BASELINE: process.memoryUsage() + getActiveResourcesInfo().length

STRESS: send M requests (each with body fully consumed)
CLEANUP: global.gc() + short pause for async cleanup
AFTER: same measurements

ASSERT: heapUsed growth < budget
ASSERT: RSS growth < budget * 2 (note: may reflect allocator retention)
ASSERT: handle count growth < threshold
ON FAILURE: v8.writeHeapSnapshot() for diagnosis
```

## Anti-Patterns (Things Agents Must Avoid)

- Not draining HTTP response bodies (keeps sockets alive)
- Measuring RSS without first calling `global.gc()` (inflated by garbage)
- Forgetting `--expose-gc` flag (global.gc is undefined, test silently skips GC)
- Using `process.memoryUsage().heapTotal` instead of `heapUsed` (total includes unused allocated pages)
- Asserting handle counts without allowing async cleanup time (setTimeout for pending close callbacks)
- Running memory tests with `--inspect` attached (debugger retains references)

## Common Node.js Leak Sources

- **Streams not destroyed:** Readable/Writable that error or stall retain internal buffers
- **EventEmitter listener stacking:** Adding listeners in request handlers without removal
- **Unresolved promises with live event roots:** Event emitter/timer holding resolver closure alive
- **Module-level closures capturing request data:** `require()`-time closures with per-request refs
- **Buffer/string concatenation in loops:** Building large strings without streaming
- **Connection pools without idle eviction:** Pools that grow under spike load, never shrink
- **Timers in request handlers:** `setTimeout`/`setInterval` without `clearTimeout` on abort
- **Unclosed child processes:** `child_process.spawn()` without kill on parent exit
- **require() cache pollution:** Dynamic requires or monkey-patching that accumulates

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| heapUsed growing linearly | `v8.writeHeapSnapshot()` → Chrome DevTools comparison view |
| RSS growing but heap stable | Check `external` + `arrayBuffers`. Likely native addon or Buffer leak |
| Handle count growing | `process.getActiveResourcesInfo()` → identify accumulating type |
| Event loop lag increasing | GC pressure from allocation churn → profile allocation rate |

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Server start mechanism (createServer, app.listen, test helper)
- [ ] Target endpoints and request payloads
- [ ] Test runner (Vitest, Jest, Mocha, node:test)
- [ ] Warmup request count
- [ ] Stress request count
- [ ] Budget per metric (heap MB, RSS MB, handle count)
- [ ] Whether `--expose-gc` is set in CI environment
- [ ] Whether this is diagnostic-only or promoted gate
