# Memory Regression — iOS Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's test target, app structure, and CI pipeline.

## When to Use

iOS/macOS native apps. Swift, Objective-C, SwiftUI, UIKit. Both device and simulator testing.

## Primary Signals

| Metric | API | What It Catches |
|---|---|---|
| Resident Memory | `mach_task_basic_info.resident_size` | Total process memory |
| Metal Allocated | `MTLDevice.currentAllocatedSize` | GPU resource retention |
| XCTMemoryMetric | Xcode performance tests | Automated regression baselines |
| Weak reference nil | `weak var` after scope exit | Retain cycle detection |

## Prerequisites

- ARC (Automatic Reference Counting) — no GC. Objects dealloc when refcount hits zero
- Use `autoreleasepool {}` to eagerly drain between iterations
- No way to "force GC" — allow short idle pause for deferred deallocation
- XCTest / XCUITest for automated measurement

## Platform Gotchas

1. **ARC is not GC.** Objects are freed immediately when the last strong reference drops. If an object isn't freed, it's a retain cycle — not "GC hasn't run yet." This makes measurement more deterministic than GC platforms, but retain cycles are silent and permanent.

2. **Retain cycles are the #1 iOS leak.** Closures capture `self` strongly by default. Always use `[weak self]` or `[unowned self]` in escaping closures on view controllers and view models.

3. **`autoreleasepool` must be explicit in loops.** Without it, autoreleased objects from each iteration accumulate until the enclosing pool drains (end of run loop):
   ```swift
   // Pattern fragment: explicit pool draining per iteration
   for _ in 0..<iterations {
       autoreleasepool {
           performLeakSuspectedFlow()
       }
   }
   ```

4. **Simulator vs device variance.** Simulators run on Mac hardware with different memory characteristics. Real device testing gives production-accurate numbers but is slower/harder in CI.

5. **MetricKit data is 24h delayed.** Production memory metrics arrive in daily payloads, not real-time. Useful for trend detection, not gating.

6. **`mach_task_basic_info` requires correct type casting.** The API is C-based and requires careful pointer rebinding in Swift.

7. **`WKWebView` runs out-of-process.** Its memory is NOT reflected in your app's RSS — it lives in a separate WebContent process. Leaks manifest as: retained `WKScriptMessageHandler` (strong reference cycle via `WKUserContentController`), un-removed message handlers, and web views not properly deallocated. Remove each handler by name via `configuration.userContentController.removeScriptMessageHandler(forName:)` before releasing the view, or use a weak proxy object as the message handler to break the retain cycle.

## Key API Surface

```swift
// Pattern fragment: resident memory measurement
import Darwin

func getResidentMemoryMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(
        MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size
    )
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    guard result == KERN_SUCCESS else { return 0 }
    return Double(info.resident_size) / 1024 / 1024
}
```

```swift
// Pattern fragment: retain cycle detection
weak var weakRef: HeavyViewController?
autoreleasepool {
    let vc = HeavyViewController()
    weakRef = vc
    vc.loadViewIfNeeded()
    vc.performWork()
    // vc should dealloc when this scope exits
}
// If weakRef is still non-nil → retain cycle
XCTAssertNil(weakRef, "Retain cycle detected")
```

```swift
// Pattern fragment: XCTMemoryMetric for automated baselines
func testMemoryPerformance() {
    let app = XCUIApplication()
    app.launch()
    measure(metrics: [XCTMemoryMetric()]) {
        // perform one iteration of the flow
        app.buttons["openView"].tap()
        app.buttons["closeView"].tap()
    }
}
```

## Measurement Recipe (Pseudocode)

```
launch app (XCUIApplication or unit test target)

WARMUP: repeat flow 3-5x (image caches, lazy init)
DRAIN: autoreleasepool + Thread.sleep(0.2)
BASELINE: getResidentMemoryMB()

STRESS: repeat flow N times (each in autoreleasepool)
DRAIN: Thread.sleep(0.5) for deferred deallocation
AFTER: getResidentMemoryMB()

ASSERT: growth < budget
RETAIN CYCLE CHECK: weak var pattern on key view controllers
ON FAILURE: Instruments Allocations trace or Xcode Memory Graph
```

## Anti-Patterns (Things Agents Must Avoid)

- Not using `autoreleasepool` in loops (deferred deallocation inflates measurement)
- Using `unowned` when the reference might outlive the object (crash, not leak, but still wrong)
- Testing on simulator and applying budgets to device (different memory characteristics)
- Asserting immediately without brief settle pause (deferred dealloc needs runloop time)
- Ignoring Metal/GPU memory in graphics-heavy apps (use `device.currentAllocatedSize`)

## Common iOS Leak Sources

- **Strong self in closures:** `{ self.doThing() }` in escaping closures retains the object
- **Delegate strong references:** Delegates must be `weak var delegate: Protocol?`
- **NotificationCenter observers:** Block-based observers must be removed (token-based auto-removal requires storing the token)
- **Timer retain cycles:** `Timer.scheduledTimer(target:)` retains target until invalidation
- **URLSession with delegate:** Retains delegate — call `finishTasksAndInvalidate()`
- **Combine subscriptions:** `AnyCancellable` stored in a set that outlives expected scope
- **SwiftUI @StateObject leaks:** ObservableObject retained beyond view lifecycle in deep navigation
- **Core Data fault retention:** Fetched objects retained while context lives
- **Image cache unbounded:** `UIImage(named:)` system cache + custom caches together
- **WKWebView message handlers:** `WKUserContentController` retains `WKScriptMessageHandler` strongly — use a weak proxy wrapper or remove handlers before releasing the web view

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| Resident memory growing per iteration | Instruments → Allocations → Generations |
| Weak reference not nil after scope exit | Retain cycle → Xcode Memory Graph Debugger |
| Metal allocated growing | GPU resource not released → check texture/buffer lifecycle |
| Memory spike on specific interaction | Not a leak — likely unbounded single allocation |

## CI Tools

```bash
# Run memory tests on simulator
xcodebuild test -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:MyAppTests/MemoryRegressionTests

# Instruments from CLI (for deeper analysis)
xcrun xctrace record --template 'Allocations' \
  --launch <bundle-id> --time-limit 120s --output alloc.trace
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Test type (XCTest unit, XCUITest UI, performance measure)
- [ ] App launch mechanism
- [ ] Target flow (selectors, accessibility identifiers)
- [ ] Whether to test retain cycles (weak var pattern) or RSS growth (or both)
- [ ] Iteration count and settle pause duration
- [ ] Budget (resident MB or XCTMemoryMetric baseline)
- [ ] Simulator vs device CI target
- [ ] Whether this is diagnostic-only or promoted gate
