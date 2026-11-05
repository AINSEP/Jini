# Memory Regression — Failure Shape Diagnosis Matrix

When a memory regression gate fails, the SHAPE of the growth tells you where to look. This matrix maps observable growth patterns to likely root causes and next diagnostic steps.

## Growth Shapes

### Linear Retained Growth After Repeated Interactions

**Shape:** Each iteration adds ~same amount of retained memory. Line goes up steadily.

**Likely causes:**
- Event listeners/subscriptions not cleaned up per cycle
- Detached DOM nodes or orphaned views per navigation
- Per-cycle objects appended to unbounded collection
- Framework cache growing without eviction

**Next step:** Diff heap snapshots between iteration N and iteration N+10. Look for objects with count growing linearly. Check teardown/unmount handlers.

---

### Stepwise Growth (Jumps Then Plateaus)

**Shape:** Memory jumps at specific lifecycle events, then holds steady until next event.

**Likely causes:**
- Large one-time allocations not released (lazy-loaded modules, large datasets pulled into memory)
- Resource pools expanding but never shrinking
- Component cached on first visit, never evicted

**Next step:** Identify which lifecycle event triggers each step. Check if the resource has a release/eviction path. May be acceptable if bounded.

---

### Growth Only Under Concurrency / Load

**Shape:** Memory stable under single-user flow but grows under concurrent requests or parallel operations.

**Likely causes:**
- Per-request allocations not scoped to request lifetime
- Queue/buffer backpressure not applied
- Connection pool growing without max
- Thread/goroutine/worker accumulation

**Next step:** Profile under load with request-scoped tracing. Check pool configurations. Monitor active handle/thread count alongside memory.

---

### RSS Grows While Heap Is Stable

**Shape:** Language-level heap (JS heap, JVM heap, Go heap) stays flat but OS-level RSS/VSZ keeps growing.

**Likely causes:**
- Native/C extensions leaking (image processing, crypto, compression libraries)
- Memory-mapped files or shared memory not unmapped
- GPU texture/buffer leaks
- Runtime allocator fragmentation (memory freed but not returned to OS)
- Child processes or workers spawned but not reaped

**Next step:** Use OS-level tools (pmap, vmmap, /proc/pid/smaps). Check native library usage. Monitor handle counts. Consider allocator tuning.

---

### GC Frequency / Pause Time Growing

**Shape:** GC runs more often and/or takes longer, even if post-GC heap size is stable.

**Likely causes:**
- Allocation churn (creating/discarding many short-lived objects in hot loops)
- Large object graph requiring expensive mark phase
- Finalizers/weak-reference processing backlog
- Memory pressure from non-heap resources triggering more aggressive GC

**Next step:** Enable GC logging/tracing. Profile allocation rate vs retention rate. Look for hot allocation sites. Consider object pooling for churn.

---

### Growth After Background/Foreground Cycles (Mobile)

**Shape:** Memory grows each time app backgrounds and foregrounds, or after screen rotation.

**Likely causes:**
- Activity/ViewController not fully released on background
- Lifecycle observers registered but not removed
- Services or location/sensor listeners retained across lifecycle
- Bitmaps/images loaded fresh each cycle without clearing previous

**Next step:** Use platform memory profiler (Instruments, Android Profiler). Check Activity/ViewController leak detectors. Review lifecycle callback cleanup.

---

### Sudden Spike Then OOM (No Gradual Growth)

**Shape:** Memory is stable, then a single operation causes a massive spike that triggers OOM.

**Likely causes:**
- Loading entire large dataset into memory at once (unbounded query result, full file read)
- Exponential algorithm on unexpectedly large input
- Image/video decoding without streaming
- Recursive structure with unexpected depth

**Next step:** This is usually NOT a leak — it's a capacity issue. Add streaming/pagination, set input size limits, or use memory-bounded algorithms. Gate with input-size assertions rather than iteration-based regression tests.

---

## Quick Reference Table

| Growth Shape | Primary Suspect | Key Diagnostic Tool |
|---|---|---|
| Linear per-iteration | Listener/subscription leak | Heap snapshot diff |
| Stepwise jumps | Cached resources without eviction | Lifecycle event correlation |
| Under load only | Request-scoped retention / queue growth | Concurrent profiling + pool metrics |
| RSS diverges from heap | Native/GPU/mmap leak | OS memory maps (pmap/vmmap) |
| GC pressure growing | Allocation churn | GC logs + allocation profiler |
| Background/foreground cycles | Lifecycle cleanup failure | Platform-specific leak detector |
| Sudden spike → OOM | Unbounded single operation | Input size analysis + streaming |

## Using This Matrix

1. Run the bounded-growth gate test
2. On failure, classify the growth shape from the metrics
3. Match to this matrix for probable cause
4. Follow "next step" for platform-specific deep diagnosis
5. Fix root cause, add regression assertion, verify gate passes
