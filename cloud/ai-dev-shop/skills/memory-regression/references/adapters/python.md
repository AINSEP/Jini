# Memory Regression — Python Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test runner, app factory, endpoints, and CI config.

## When to Use

Python backend services, CLI tools, Celery/background workers, data pipelines. Any framework (Django, FastAPI, Flask, Starlette, aiohttp).

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| RSS | `psutil.Process().memory_info().rss` | Total process memory |
| Tracemalloc | `tracemalloc.take_snapshot()` | Python object allocation sites |
| Object Count | `len(gc.get_objects())` | Live tracked objects |
| Uncollectable | `gc.garbage` after `gc.collect()` | Cycles that resist collection |
| FD Count | `psutil.Process().num_fds()` (Unix) | File descriptor leaks |

## Prerequisites

- `tracemalloc` and `gc` are stdlib (no install)
- `pip install psutil` for RSS and FD monitoring
- `pip install objgraph` for reference graph diagnosis
- `pip install memray` for deep allocation profiling
- `gc.collect()` is reliable for Python's managed heap

## Platform Gotchas

1. **`gc.collect()` is reliable for Python objects but misses C extension memory.** Libraries like numpy, PIL, or database drivers may allocate via `malloc` — invisible to Python's GC and tracemalloc. Monitor RSS alongside heap metrics.

2. **Tracemalloc measures allocations, not retained objects.** Use `snapshot.compare_to(baseline, 'lineno')` to diff — this shows what GREW, not what's biggest. Keep tracemalloc running continuously from baseline through final snapshot (do NOT stop/restart between snapshots — that invalidates the diff):
   ```python
   # Pattern fragment: correct tracemalloc diffing
   tracemalloc.start()  # start ONCE, before baseline
   baseline_snap = tracemalloc.take_snapshot()
   # ... stress phase (tracemalloc stays running) ...
   after_snap = tracemalloc.take_snapshot()
   tracemalloc.stop()  # stop AFTER final snapshot
   growth = after_snap.compare_to(baseline_snap, 'lineno')[:15]
   ```

3. **PEP 442 (Python 3.4+): cycles with `__del__` ARE generally collectable.** The old "cycles + finalizers = permanent leak" rule is outdated. Modern leaks come from: C extensions holding opaque references, exceptions inside `__del__`, object resurrection in finalizers, and daemon threads holding refs.

4. **`gc.DEBUG_SAVEALL` poisons later tests.** It saves unreachable objects into `gc.garbage` instead of collecting them. Always `gc.garbage.clear()` after inspection and reset `gc.set_debug(0)`.

5. **Django with `DEBUG=True` caches ALL SQL queries.** `connection.queries` grows unbounded. Always test with `DEBUG=False` or clear queries between iterations.

6. **Mutable default arguments accumulate silently.** `def f(cache={})` — the dict persists across calls. Classic Python gotcha that shows up as object count growth.

## Key API Surface

```python
# Pattern fragment: measurement mechanics
import gc
import tracemalloc
import psutil
import os

# Force GC (reliable for Python managed heap)
gc.collect()
gc.collect()  # second pass for weak-ref callbacks

# RSS measurement
process = psutil.Process(os.getpid())
rss_mb = process.memory_info().rss / 1024 / 1024

# Object count
live_objects = len(gc.get_objects())

# FD count (Unix)
fd_count = process.num_fds()

# Tracemalloc for allocation tracking
tracemalloc.start(25)  # 25 frames for full stack traces
snap = tracemalloc.take_snapshot()
tracemalloc.stop()
```

```python
# Pattern fragment: objgraph for diagnosis
import objgraph

objgraph.growth()  # prime baseline
# ... stress ...
gc.collect()
growth = objgraph.growth(limit=20)
# Returns: [(typename, count, delta), ...]

# Find what retains the top leaker
leakers = objgraph.by_type(growth[0][0])
objgraph.show_backrefs(leakers[-1], max_depth=5, filename='leak.png')
```

## Measurement Recipe (Pseudocode)

```
create test client (app.test_client, TestClient, httpx, etc.)

WARMUP: send N requests
CLEANUP: gc.collect() twice
BASELINE: tracemalloc.take_snapshot() + get_rss_mb() + len(gc.get_objects())

STRESS: send M requests
CLEANUP: gc.collect() twice
AFTER: take_snapshot() + same measurements

ASSERT: RSS growth < budget
ASSERT: object count growth < threshold
DIFF: after_snapshot.compare_to(baseline_snapshot, 'lineno') for top growth sites
ON FAILURE: objgraph.growth() + show_backrefs for diagnosis
```

## Anti-Patterns (Things Agents Must Avoid)

- Using `tracemalloc.statistics('lineno')` without diffing against baseline (shows framework startup, not leak)
- Testing with Django `DEBUG=True` (SQL query cache grows unbounded)
- Leaving `gc.set_debug(gc.DEBUG_SAVEALL)` on (poisons later tests)
- Relying on RSS alone (allocator retention is not a leak)
- Assuming `__del__` cycles can't be collected (outdated since Python 3.4)
- Ignoring C extension memory (invisible to gc/tracemalloc)

## Common Python Leak Sources

- **C extension opaque references:** Native libraries holding Python objects via `Py_INCREF` without release
- **Module-level mutable containers growing:** Global dicts/lists accumulating per-request
- **Mutable default arguments:** `def f(items=[])` persists across calls
- **Unclosed generators/coroutines:** `async for` abandoned without `.aclose()`
- **Django ORM query caching:** `DEBUG=True` or custom middleware storing queries
- **Logging handlers retaining records:** Custom handlers that store log record references
- **Thread-local data without cleanup:** `threading.local()` values living for thread lifetime
- **Large objects in exception tracebacks:** `sys.exc_info()` retaining frame locals
- **Celery task result accumulation:** Result backend storing all results without TTL
- **Connection pool growth without eviction:** SQLAlchemy/Redis pools that never shrink

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| RSS growing, object count stable | C extension / native leak → use `memray` or `valgrind` on Python process |
| Object count growing | `objgraph.growth()` → identify accumulating type → `show_backrefs` |
| Tracemalloc shows specific file:line | Direct pointer to allocation site growing |
| `gc.garbage` non-empty | Finalizer issue → inspect types, check for resurrection or `__del__` exceptions |
| FD count growing | `psutil.Process().open_files()` / `connections()` to identify |

## CI Configuration

```bash
PYTHONTRACEMALLOC=25 pytest tests/memory/ -v --tb=short
# Use 25 frames (not 1) to get useful stack traces for diagnosis
# Note: tracemalloc.start(N) in code will NOT increase the limit if PYTHONTRACEMALLOC already started with fewer frames

# Constrain process memory (Linux) to surface leaks faster
# ulimit -v 524288  # 512 MB virtual memory limit
```

## Deep Diagnosis Tools

```bash
# Memray: full allocation profiling with flamegraphs
memray run -o output.bin pytest tests/memory/
memray flamegraph output.bin -o flamegraph.html
memray stats output.bin
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] App factory / test client mechanism
- [ ] Target endpoints and payloads
- [ ] Test runner (pytest, unittest, custom)
- [ ] Whether Django DEBUG is off
- [ ] Warmup and stress iteration counts
- [ ] Budget per metric (RSS MB, object count, FD count)
- [ ] Whether C extension memory is a concern
- [ ] Whether this is diagnostic-only or promoted gate
