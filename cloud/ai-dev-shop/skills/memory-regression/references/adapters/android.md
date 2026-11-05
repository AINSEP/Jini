# Memory Regression — Android Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test infrastructure, build config, and device setup.

## When to Use

Android apps — Kotlin, Java, Jetpack Compose, XML Views. Native, hybrid, or cross-platform (React Native, Flutter via platform channels).

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| Total PSS | `Debug.getMemoryInfo().totalPss` | Proportional set size (best single Android metric) |
| Java Heap | `Runtime.totalMemory() - Runtime.freeMemory()` | JVM object retention |
| Native Heap | `Debug.getNativeHeapAllocatedSize()` | NDK/JNI allocations |
| Thread Count | `Thread.getAllStackTraces().size()` | Thread/executor leaks |
| Weak reference nil | `WeakReference<Activity>` after finish | Activity/Fragment leak detection |

## Prerequisites

- ART (Android Runtime) with concurrent GC. `System.gc()` is best-effort (usually honored)
- Call twice with 200ms pause for concurrent collector
- Instrumented tests (androidTest) for on-device measurement
- Macrobenchmark module for CI-friendly memory metrics

## Platform Gotchas

1. **`System.gc()` is best-effort on ART but usually works.** Call twice with pause. Accept slightly higher variance than Go/Node:
   ```kotlin
   // Pattern fragment: best-effort GC
   System.gc()
   Thread.sleep(200)
   System.gc()
   Thread.sleep(200)
   ```

2. **Total PSS is the best single metric.** It accounts for shared memory proportionally. More accurate than Java heap alone (which misses native/graphics) or RSS (which over-counts shared pages).

3. **Graphics memory is separate from Java heap.** Image-heavy apps may show stable Java heap but growing graphics memory. Check via `adb shell dumpsys meminfo <package>` → look at Graphics section.

4. **`Bitmap.recycle()` is largely unnecessary on modern Android (API 26+).** The system manages bitmap memory via the hardware renderer. Calling `recycle()` can cause crashes if the bitmap is still referenced. Focus on releasing references instead.

5. **Activity leaks are the #1 Android memory issue.** A single leaked Activity retains its entire view hierarchy (often 10-50 MB). Always verify Activities are collected after `finish()`.

6. **`adb shell dumpsys meminfo` output format varies across OEMs/versions.** Don't parse it with brittle `awk` — use `Debug.getMemoryInfo()` in code or `-c` (CSV) flag for scripts.

## Key API Surface

```kotlin
// Pattern fragment: memory measurement from within the app
import android.os.Debug

fun getTotalPssMB(): Long {
    val memInfo = Debug.MemoryInfo()
    Debug.getMemoryInfo(memInfo)
    return memInfo.totalPss.toLong() / 1024  // PSS is in KB
}

fun getNativeHeapMB(): Long {
    return Debug.getNativeHeapAllocatedSize() / 1024 / 1024
}
```

```kotlin
// Pattern fragment: Activity leak detection
import java.lang.ref.WeakReference

var weakActivity: WeakReference<MyActivity>? = null

// In test: launch activity, capture weak ref, finish it
activityScenario.onActivity { activity ->
    weakActivity = WeakReference(activity)
}
activityScenario.close()

// Force GC and verify collection
System.gc(); Thread.sleep(200); System.gc()
assertNull(weakActivity?.get(),
    "Activity not collected after finish — likely static ref or listener leak")
```

```kotlin
// Pattern fragment: Macrobenchmark memory measurement
@OptIn(ExperimentalMetricApi::class)
rule.measureRepeated(
    packageName = "com.example.app",
    metrics = listOf(MemoryUsageMetric(MemoryUsageMetric.Mode.Max)),
    iterations = 20,
) {
    pressHome()
    startActivityAndWait()
    // ... perform interaction flow ...
}
```

## Measurement Recipe (Pseudocode)

```
launch app on device/emulator (fixed RAM, animations disabled)

WARMUP: repeat flow 5-10x (class loading, image caches, pool init)
CLEANUP: System.gc() × 2 with 200ms pause
BASELINE: getTotalPssMB() + getNativeHeapMB()

STRESS: repeat flow N times
CLEANUP: System.gc() × 2 with 200ms pause
AFTER: same measurements

ASSERT: PSS growth < budget
ASSERT: native heap growth < budget
ACTIVITY LEAK CHECK: WeakReference pattern on finished activities
ON FAILURE: adb dumpsys meminfo or heap dump via adb shell am dumpheap
```

## Anti-Patterns (Things Agents Must Avoid)

- Calling `Bitmap.recycle()` as a prevention pattern (outdated, can crash)
- Parsing `adb shell dumpsys meminfo` with brittle column positions (varies by OEM)
- Using `Thread.activeCount()` instead of `Thread.getAllStackTraces().size()`
- Testing with animations enabled (adds timing variance)
- Measuring immediately after stress without GC pause (inflated by garbage)
- Storing Activity/Context references in ViewModels or static fields

## Common Android Leak Sources

- **Activity/Context in static fields:** Static refs prevent entire Activity + view hierarchy collection
- **Non-static inner classes:** Implicit reference to enclosing Activity instance
- **Unregistered BroadcastReceivers:** Registered in `onCreate` without `unregisterReceiver` in `onDestroy`
- **Handler/Runnable leaks:** Posted delayed messages retain Runnable (and its scope) until delivery
- **WebView context leaks:** WebView retains Activity context — create with application context, destroy explicitly
- **Cursor not closed:** Room/ContentResolver cursors leaking in exception paths
- **LocationManager listeners:** Location updates not removed — retains listener + context
- **ViewModel storing UI references:** ViewModel outlives Activity — any UI reference leaks
- **Compose `remember {}` growing:** Mutable state in remember blocks accumulating across recompositions
- **Compose `LaunchedEffect` without cancellation:** Coroutines launched without proper scope/cancellation

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| PSS growing per navigation cycle | Activity leak → WeakReference test + LeakCanary |
| Native heap growing, Java stable | NDK/JNI leak or graphics buffer retention |
| Graphics memory growing | Image/texture not released → check image loader cache bounds |
| WeakReference not null after finish | Retain path → LeakCanary trace or heap dump |

## LeakCanary (Debug Builds)

```kotlin
// build.gradle.kts — auto-detects retained objects
debugImplementation("com.squareup.leakcanary:leakcanary-android:2.14")

// For instrumented test assertions
androidTestImplementation("com.squareup.leakcanary:leakcanary-android-instrumentation:2.14")

// In test:
LeakAssertions.assertNoLeaks()
```

## ADB Diagnostics

```bash
# Detailed memory breakdown
adb shell dumpsys meminfo <package-name>
# Key sections: Java Heap, Native Heap, Graphics, Total PSS

# Heap dump for offline analysis
adb shell am dumpheap <package-name> /data/local/tmp/heap.hprof
adb pull /data/local/tmp/heap.hprof .
hprof-conv heap.hprof heap-converted.hprof  # convert for MAT/VisualVM
```

## CI Configuration

```bash
# Disable animations for stable measurements
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

# Run instrumented tests
./gradlew connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.example.MemoryRegressionTest

# Or Macrobenchmark
./gradlew :benchmark:connectedBenchmarkAndroidTest
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Test type (instrumented JUnit4, Macrobenchmark, Espresso, UiAutomator)
- [ ] App launch mechanism and target Activity/Flow
- [ ] Whether testing Activity lifecycle leaks (WeakReference pattern)
- [ ] Whether graphics/native memory is a concern
- [ ] Warmup and stress iteration counts
- [ ] Budget per metric (PSS MB, native MB)
- [ ] Device/emulator configuration (fixed RAM, API level)
- [ ] Whether LeakCanary is available in test builds
- [ ] Whether this is diagnostic-only or promoted gate
