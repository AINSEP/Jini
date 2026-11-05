# Memory Regression — JVM Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test framework, server setup, and build tool.

## When to Use

JVM-based services and applications. Java, Kotlin, Scala, Clojure. Any framework (Spring Boot, Quarkus, Micronaut, Ktor, Vert.x, Dropwizard).

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| Heap Used | `Runtime.totalMemory() - Runtime.freeMemory()` | Java object retention |
| Heap Pools | `MemoryPoolMXBean` | Per-pool growth (Old Gen, Metaspace) |
| Thread Count | `ThreadMXBean.getThreadCount()` | Thread/executor leaks |
| Direct Buffers | `BufferPoolMXBean` ("direct") | Off-heap ByteBuffer leaks |
| Class Count | `ClassLoadingMXBean` | ClassLoader leaks |
| GC Pause/Frequency | `GarbageCollectorMXBean` | GC pressure indicator |

## Prerequisites

- `System.gc()` is advisory — JVM may ignore it. Use `-XX:+ExplicitGCInvokesConcurrent` to avoid stop-the-world pauses during explicit GC (tradeoff: GC may not complete before your measurement — add 100ms sleep after each call)
- Call twice with 100ms pause for concurrent collector to finish
- Constrain heap with `-Xmx256m` in tests to surface leaks faster
- Add `-XX:+HeapDumpOnOutOfMemoryError` for automatic diagnosis on OOM

## Platform Gotchas

1. **`System.gc()` is a hint, not a command.** Unlike Go's `runtime.GC()`, the JVM can ignore it. Mitigate with double-call + short sleep, and accept ~10% measurement variance:
   ```java
   // Pattern fragment: best-effort GC
   System.gc();
   Thread.sleep(100);
   System.gc();
   Thread.sleep(100);
   ```

2. **Don't use `Thread.activeCount()` for thread leak detection.** It only counts threads in the current thread group — misses executor pools, application threads in other groups. Use ThreadMXBean:
   ```java
   // Pattern fragment: reliable thread counting
   int threads = ManagementFactory.getThreadMXBean().getThreadCount();
   ```

3. **Direct ByteBuffers allocate OFF-HEAP.** `ByteBuffer.allocateDirect()` memory is invisible to `Runtime.totalMemory()`. Monitor separately:
   ```java
   // Pattern fragment: direct buffer monitoring
   long directBytes = ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)
       .stream()
       .filter(pool -> "direct".equals(pool.getName()))
       .mapToLong(BufferPoolMXBean::getMemoryUsed)
       .sum();
   ```

4. **Metaspace grows with class loading.** Dynamic proxies, reflection, OSGi, hot-reload frameworks all load classes. Metaspace only shrinks on full GC. Monitor via `ClassLoadingMXBean.getLoadedClassCount()`.

5. **Old Gen is the leak indicator.** Young Gen churn is normal. If Old Gen (Tenured) usage grows after full GC, that's retained objects — the actual leak signal.

6. **`-Xmx` constrains heap only.** Metaspace, direct buffers, thread stacks, and native memory are all outside `-Xmx`. Total process memory can far exceed heap limit.

## Key API Surface

```java
// Pattern fragment: measurement mechanics
import java.lang.management.*;
import java.util.List;

// Heap used
Runtime rt = Runtime.getRuntime();
long heapUsed = rt.totalMemory() - rt.freeMemory();

// Detailed pool breakdown
MemoryMXBean memBean = ManagementFactory.getMemoryMXBean();
long heapCommitted = memBean.getHeapMemoryUsage().getCommitted();
long nonHeap = memBean.getNonHeapMemoryUsage().getUsed(); // Metaspace + code cache

// Thread count (all groups)
int threads = ManagementFactory.getThreadMXBean().getThreadCount();

// Direct buffer memory
List<BufferPoolMXBean> pools = ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class);
// Filter for "direct" pool → getMemoryUsed()

// Class count
long classes = ManagementFactory.getClassLoadingMXBean().getLoadedClassCount();
```

```bash
# Pattern fragment: CLI diagnosis tools
jcmd <pid> GC.heap_dump /tmp/heap.hprof        # heap dump
jcmd <pid> VM.native_memory baseline            # MUST run this first to establish baseline
# ... stress ...
jcmd <pid> VM.native_memory summary.diff        # shows delta since baseline (requires -XX:NativeMemoryTracking=summary at JVM start)
jcmd <pid> GC.class_histogram                   # object count by class
jcmd <pid> Thread.print                         # thread dump
```

## Measurement Recipe (Pseudocode)

```
start application with -Xmx256m -XX:+ExplicitGCInvokesConcurrent
create test HTTP client

WARMUP: send N requests (JIT compilation, class loading, pool init)
CLEANUP: System.gc() × 2 with 100ms pause
BASELINE: heapUsed, threadCount, directBufferBytes, classCount

STRESS: send M requests
CLEANUP: System.gc() × 2 with 100ms pause
AFTER: same measurements

ASSERT: heap growth < budget
ASSERT: thread growth < threshold
ASSERT: direct buffer growth < budget
ON FAILURE: jcmd heap_dump → Eclipse MAT / VisualVM analysis
```

## Anti-Patterns (Things Agents Must Avoid)

- Using `Thread.activeCount()` (only current thread group, misses executors)
- Measuring heap without calling `System.gc()` first (inflated by garbage)
- Ignoring direct ByteBuffer memory (off-heap, invisible to runtime metrics)
- Single `System.gc()` call (concurrent collector may not finish)
- Treating `Runtime.totalMemory()` as heap used (it's allocated capacity, not usage)
- Testing with default heap size (large heap hides leaks longer)

## Common JVM Leak Sources

- **ClassLoader retention:** References to ClassLoaders prevent unloading entire class hierarchies. Common in hot-reload/OSGi/plugin architectures
- **ThreadLocal not removed:** Values persist for thread lifetime in pools. Must `remove()` in `finally`
- **Connection pool exhaustion:** Connections not returned in exception paths (missing close in finally)
- **Static collections growing:** `static Map<>` accumulating per-request data without eviction
- **Soft/Weak reference abuse:** SoftReferences cause GC thrashing under memory pressure
- **String interning unbounded:** `String.intern()` fills permanent string pool
- **Hibernate first-level cache:** Session cache growing within long transactions
- **ScheduledExecutor tasks:** Retained references to cancelled futures
- **Direct ByteBuffers:** Off-heap allocation collected only when wrapper is GC'd (non-deterministic)
- **Event listeners on long-lived beans:** Spring/CDI beans with listeners that reference short-lived objects

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| Old Gen growing after full GC | Heap dump → Eclipse MAT dominator tree |
| Thread count growing | Thread dump → find blocked/waiting threads |
| Metaspace growing | `jcmd GC.class_histogram` → find accumulating classes |
| Direct buffer growing | `BufferPoolMXBean` → find allocation sites |
| Process RSS >> heap max | `-XX:NativeMemoryTracking=summary` → `jcmd VM.native_memory` |

## JFR (Java Flight Recorder) for Deep Diagnosis

```bash
# Low-overhead continuous profiling
java -XX:StartFlightRecording=duration=60s,filename=test.jfr -jar app.jar
jfr print --events jdk.ObjectAllocationInNewTLAB test.jfr  # allocation sites
jfr print --events jdk.GCPhasePause test.jfr               # GC pauses
```

## CI Configuration

```bash
# Gradle — note: -Dorg.gradle.jvmargs configures the Gradle DAEMON, not the test JVM.
# Use jvmArgs in build.gradle for the test worker, or pass via system property:
./gradlew test --tests '*MemoryRegression*' \
  -DtestJvmArgs="-Xmx256m -XX:+ExplicitGCInvokesConcurrent -XX:+HeapDumpOnOutOfMemoryError"
# In build.gradle.kts:
#   tasks.test { jvmArgs("-Xmx256m", "-XX:+ExplicitGCInvokesConcurrent", "-XX:+HeapDumpOnOutOfMemoryError") }

# Maven
mvn test -Dtest=MemoryRegressionTest \
  -DargLine="-Xmx256m -XX:+ExplicitGCInvokesConcurrent"
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Test framework (JUnit 5, TestNG, Spock)
- [ ] App startup mechanism (Spring @SpringBootTest, httptest, manual)
- [ ] HTTP client (TestRestTemplate, WebTestClient, OkHttp, java.net.http)
- [ ] Target endpoints and request patterns
- [ ] Warmup and stress iteration counts
- [ ] Budget per metric (heap MB, thread count, direct buffer MB)
- [ ] JVM flags for CI (`-Xmx`, `-XX:+ExplicitGCInvokesConcurrent`)
- [ ] Whether to monitor direct buffers and class loading
- [ ] Whether this is diagnostic-only or promoted gate
