# Memory Regression — Programmer Antipatterns

Universal prevention checklist. Load this reference when implementing state-heavy, long-lived, or subscription-heavy components on ANY platform.

## Universal Antipatterns (All Platforms)

### 1. Uncleared Subscriptions and Listeners

**Pattern:** Registering event listeners, observers, pub/sub subscriptions, or reactive watchers without corresponding cleanup on teardown/dispose.

**Why it leaks:** The subscription holds a reference to the callback, which holds a reference to the component/object scope. Even after the component is logically destroyed, the subscription root keeps the entire closure alive.

**Prevention:** Every subscribe must have a corresponding unsubscribe in the teardown/dispose/unmount lifecycle. Use deterministic cleanup patterns (dispose bags, AbortControllers, scope-bound subscriptions).

### 2. Timers and Intervals Without Cancellation

**Pattern:** `setTimeout`, `setInterval`, `Timer.scheduledTimer`, `ScheduledExecutorService`, or equivalent without cancellation on teardown.

**Why it leaks:** The timer runtime holds a reference to the callback closure. Long intervals or forgotten timeouts accumulate, each retaining its captured scope.

**Prevention:** Store handles. Cancel on teardown. Prefer framework-managed lifecycle timers over raw platform timers.

### 3. Closures Capturing Large Scopes

**Pattern:** A small callback captures a reference to a large parent scope (full component state, large data array, DOM tree, request context) even though it only needs a small piece.

**Why it leaks:** GC cannot reclaim any part of the captured scope while the closure lives. One leaked closure can retain megabytes.

**Prevention:** Extract only the needed values into the closure. Avoid capturing `this`/`self` when only a single field is needed. In hot paths, null out references after use.

### 4. Unbounded Caches, Queues, and Buffers

**Pattern:** In-memory caches, event queues, log buffers, undo stacks, or history arrays that grow without bound.

**Why it leaks:** Growth is linear with usage. Under sustained use, these structures consume all available memory.

**Prevention:** Set explicit capacity limits. Use LRU eviction, ring buffers, or time-based expiry. Monitor size in diagnostics.

### 5. Global/Static State Accumulation

**Pattern:** Appending to module-level arrays, static maps, singleton registries, or global stores without eviction.

**Why it leaks:** Global state is never garbage collected. Each addition is permanent for the process lifetime.

**Prevention:** Avoid global mutable collections. If unavoidable, implement eviction policy. Prefer request-scoped or component-scoped state.

### 6. Circular References Preventing Collection

**Pattern:** Object A references Object B which references Object A. In environments with reference-counting GC (ObjC without ARC cycle detection, some native runtimes), this prevents collection.

**Why it leaks:** Reference counts never reach zero without a cycle collector. In Python (3.4+, PEP 442), the cycle collector CAN handle cycles even with `__del__` finalizers, but cycles involving C extensions, objects that resurrect themselves in `__del__`, or exceptions raised in finalizers may still leak or delay collection. In ObjC/native runtimes without cycle detection, the leak is permanent.

**Prevention:** Use weak references for back-pointers. Break cycles on teardown. In Python, prefer `weakref` for back-references and avoid complex logic in `__del__`. In ObjC/Swift, use `weak`/`unowned` for delegate patterns.

### 7. Detached Resources Without Release

**Pattern:** Creating expensive resources (DOM nodes, views, database connections, file handles, GPU textures, threads) that become unreachable without explicit release.

**Why it leaks:** Many resources require explicit close/release/destroy — GC alone won't reclaim them even if the object becomes unreachable.

**Prevention:** Use RAII/try-with-resources/using patterns. Pair every acquire with release in the same scope or lifecycle. Use connection pools with max-idle eviction.

### 8. Retained Request/Session/Context Objects

**Pattern:** Storing per-request data (user context, parsed body, temp files) in structures that outlive the request.

**Why it leaks:** Each request adds data; none is ever removed. Under load, accumulation is rapid.

**Prevention:** Scope data to request lifetime. Use request-scoped containers. Clear temp references on response completion.

### 9. Background Tasks and Workers Without Supervision

**Pattern:** Spawning background threads, goroutines, workers, or async tasks that are never joined, cancelled, or supervised.

**Why it leaks:** Each task retains its stack, closure, and any resources it holds. Orphaned tasks accumulate.

**Prevention:** Track spawned tasks. Cancel on parent teardown. Use structured concurrency (task groups, supervisors, cancellation tokens).

### 10. Unresolved Promises and Futures

**Pattern:** Creating a Promise/Future that waits on a callback, event, or stream that never fires/closes, without a timeout or cancellation mechanism.

**Why it leaks:** The external root keeping the Promise alive (event emitter, timer, I/O handle) retains the resolver/rejector closures and everything they capture. A truly unreachable pending Promise CAN be collected, but the common case is that the event source (listener registration, open socket, active timer) acts as a GC root holding the entire closure tree alive indefinitely.

**Prevention:** Always pair external event-driven Promises with a timeout (`Promise.race` with a rejection timer). Ensure source event emitters are guaranteed to resolve, reject, or be destroyed. Use AbortController/CancellationToken to cancel pending operations on teardown. Remove the event listener registration that's acting as the GC root.

### 11. Framework Keep-Alive / Caching Misuse

**Pattern:** Using framework caching mechanisms (Vue `<keep-alive>`, React memo without cleanup, Android Fragment backstack, iOS view controller cache) beyond intended scope.

**Why it leaks:** Frameworks retain cached components in memory. Unlimited cache = unlimited memory.

**Prevention:** Set explicit cache limits. Evict on memory pressure. Use caching only for genuinely revisited components.

## Platform-Specific Gotchas (Brief)

| Platform | Common Trap |
|---|---|
| Browser/SPA | Detached DOM trees from removed-but-referenced nodes; ResizeObserver/IntersectionObserver not disconnected |
| Node.js | Streams not destroyed; EventEmitter listeners stacking; unhandled promise chains holding context |
| Python | C extension opaque refs bypassing cycle collector; mutable default args accumulating; generator/coroutine not closed; exceptions in `__del__` delaying cleanup |
| Go | Goroutines blocked on channel forever; sync.Pool misuse; slice header retaining large backing array |
| JVM | ClassLoader leaks; ThreadLocal not removed; soft/weak reference abuse; connection pool exhaustion |
| iOS | Retain cycles in closures (self capture); NotificationCenter observers not removed; Core Data faults |
| Android | Activity/Context leaks in static refs; unregistered BroadcastReceivers; retained Bitmap references in unbounded caches |
| GPU/Native | Textures/buffers not freed; shader programs accumulated; render target not released between frames |

## How to Use This Reference

1. Before implementation: scan the list for patterns that apply to your current work
2. During code review: check teardown/dispose paths for corresponding cleanup
3. On memory regression failure: compare the leaked resource class against this list to identify probable cause
