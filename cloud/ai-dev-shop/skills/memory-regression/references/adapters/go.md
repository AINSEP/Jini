# Memory Regression — Go Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test structure, server setup, and endpoints.

## When to Use

Go backend services, CLI tools, workers, long-running daemons. Any framework (net/http, Gin, Echo, Fiber, gRPC, custom).

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| HeapAlloc | `runtime.MemStats.HeapAlloc` | Live heap object bytes |
| HeapObjects | `runtime.MemStats.HeapObjects` | Live heap object count |
| Sys | `runtime.MemStats.Sys` | Total OS memory (includes stacks, GC metadata) |
| StackInuse | `runtime.MemStats.StackInuse` | Goroutine stack memory |
| NumGoroutine | `runtime.NumGoroutine()` | Active goroutine count |
| GC pauses | `runtime.MemStats.PauseTotalNs` | GC pressure indicator |

## Prerequisites

- `runtime.GC()` is reliable in Go — always honors the request
- Double GC call improves cleanup stability (finalizers may need a second pass)
- No special flags needed (unlike Node's `--expose-gc`)

## Platform Gotchas

1. **MemStats fields are `uint64` — unsigned subtraction can underflow.** Always cast to `int64` before computing deltas:
   ```go
   // Pattern fragment: safe delta calculation
   func deltaMB(after, before uint64) float64 {
       return float64(int64(after)-int64(before)) / 1024 / 1024
   }
   ```

2. **Always drain and close HTTP response bodies.** Undrained responses leak connections and their buffers:
   ```go
   // Pattern fragment: safe request helper
   func doGet(t *testing.T, client *http.Client, url string) {
       t.Helper()
       resp, err := client.Get(url)
       if err != nil {
           t.Fatalf("GET %s: %v", url, err)
       }
       defer resp.Body.Close()
       io.Copy(io.Discard, resp.Body)
   }
   ```

3. **Slice header retains backing array.** `largeSlice[:10]` keeps the entire backing array in memory. Copy to a new slice if retaining a small subset long-term.

4. **`time.After` in loops creates timer accumulation (Go < 1.23).** Each call allocates a timer that lives until it fires. In hot select loops, use `time.NewTimer` with `Reset()` instead. Note: Go 1.23+ allows unreferenced timers to be garbage-collected, but `time.NewTimer` with `Reset()` remains best practice for clarity and backward compatibility.

5. **`Sys` growth != leak.** The Go runtime may hold freed pages (MADV_FREE) that the OS hasn't reclaimed. `Sys` reflects what Go requested from the OS, not what's actively used. Use `HeapAlloc` for leak detection.

6. **Double `runtime.GC()` for finalizers.** First GC discovers unreachable objects and schedules their finalizers. Finalizers run asynchronously. A subsequent GC reclaims finalized objects. Call GC twice with `runtime.Gosched()` between to allow the finalizer goroutine to execute:
   ```go
   runtime.GC()
   runtime.Gosched() // yield to finalizer goroutine
   runtime.GC()
   ```

## Key API Surface

```go
// Pattern fragment: measurement mechanics
import "runtime"

// Force GC (reliable)
runtime.GC()
runtime.GC()

// Read memory stats
var ms runtime.MemStats
runtime.ReadMemStats(&ms)
// ms.HeapAlloc, ms.HeapObjects, ms.Sys, ms.StackInuse, ms.NumGC, ms.PauseTotalNs

// Goroutine count
count := runtime.NumGoroutine()

// Goroutine dump (on failure, for diagnosis)
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true) // true = all goroutines
t.Logf("Goroutines:\n%s", buf[:n])
```

```go
// Pattern fragment: heap profile for diagnosis
import (
    "fmt"
    "os"
    "runtime"
    "runtime/pprof"
    "time"
)

func captureHeapProfile(label string) {
    runtime.GC()
    f, _ := os.Create(fmt.Sprintf("%s-%d.pprof", label, time.Now().Unix()))
    defer f.Close()
    pprof.WriteHeapProfile(f)
}
// Then: go tool pprof -diff_base baseline.pprof final.pprof
```

## Measurement Recipe (Pseudocode)

```
start test server (httptest.NewServer or equivalent)
create http.Client

WARMUP: doGet N times
CLEANUP: runtime.GC() twice
BASELINE: ReadMemStats → HeapAlloc, NumGoroutine

STRESS: doGet M times (body drained each time)
CLEANUP: runtime.GC() twice + Gosched
AFTER: same measurements

ASSERT: deltaMB(after.HeapAlloc, baseline.HeapAlloc) < budget
ASSERT: deltaMB(after.Sys, baseline.Sys) < budget * 2
ASSERT: goroutine growth < threshold
ON FAILURE: captureHeapProfile + goroutine stack dump
```

## Anti-Patterns (Things Agents Must Avoid)

- Unsigned `uint64` subtraction without `int64` cast (underflow → massive false positive)
- Not closing/draining `resp.Body` (leaks connections + buffers)
- Using `time.After` in select loops (timer accumulation in Go < 1.23; still a clarity issue in 1.23+)
- Measuring `Sys` alone for leak detection (conflates allocator retention with leaks)
- Checking goroutine count immediately after stress (allow Gosched + brief settle for async cleanup)
- Single `runtime.GC()` call when finalizers are involved

## Common Go Leak Sources

- **Goroutines blocked on channels:** `ch <- val` or `<-ch` without context cancellation — each retains its full stack (8KB+)
- **Unclosed response bodies:** Missing `resp.Body.Close()` or undrained body
- **Slice backing array retention:** Small slice referencing huge underlying array
- **sync.Pool with large buffers:** Pooled objects with internal buffers keep memory under low load
- **`time.After` in select loops (Go < 1.23):** Each iteration allocates a non-cancellable timer that cannot be GC'd until it fires. Go 1.23+ mitigates this, but the pattern remains a code smell
- **Global maps without eviction:** Package-level maps growing per-request
- **Context values propagating large objects:** `context.WithValue` chains carrying big payloads
- **CGo memory:** `C.malloc` without `C.free`

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| HeapAlloc growing linearly | `pprof.WriteHeapProfile` → `go tool pprof -diff_base` |
| Goroutine count growing | `runtime.Stack(buf, true)` → find blocked goroutine stacks |
| Sys growing but Heap stable | Possible CGo leak or allocator retention → check with `GODEBUG=madvdontneed=1` |
| NumGC increasing rapidly | Allocation churn → profile allocation sites with `go tool pprof -alloc_space` |

## CI Configuration

```bash
# Constrain memory to surface leaks faster
GOGC=50 GOMEMLIMIT=256MiB go test -v -run TestMemory ./tests/memory/
# GOGC=50: GC at 50% growth (more aggressive)
# GOMEMLIMIT: soft memory limit, triggers GC pressure earlier
```

## HTTP pprof for Live Diagnosis

```go
import _ "net/http/pprof"
// Exposes /debug/pprof/* on the default serve mux
```
```bash
# Diff two snapshots taken apart
curl -o h1.pprof http://localhost:6060/debug/pprof/heap
sleep 60
curl -o h2.pprof http://localhost:6060/debug/pprof/heap
go tool pprof -diff_base h1.pprof h2.pprof
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Server start mechanism (httptest.NewServer, custom, or existing test infra)
- [ ] Target endpoints and request methods/payloads
- [ ] Warmup and stress iteration counts
- [ ] Budget per metric (HeapAlloc MB, goroutine count, Sys MB)
- [ ] Whether to include goroutine leak assertion
- [ ] CI environment variables (GOGC, GOMEMLIMIT)
- [ ] Whether this is diagnostic-only or promoted gate
