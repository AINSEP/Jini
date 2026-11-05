---
name: memory-regression
version: 1.0.0
last_updated: 2026-06-12
description: Detect and prevent memory/resource leaks across web, backend, and mobile platforms using abstract bounded-growth assertions. Covers automated CI gating, diagnostic workflows, and programmer prevention patterns. Platform-agnostic core with adapter references per runtime.
steward: qa-e2e
activation: conditional
---

# Skill: Memory Regression

Automated detection and prevention of memory and resource leaks across all platforms. Uses a universal bounded-growth abstraction that applies regardless of framework, language, or runtime.

## When to Use

- Spec declares a memory budget or "no memory leaks" requirement
- Bug report references RAM growth, OOM, or resource exhaustion
- Heavy component added (chart library, map, infinite scroll, real-time feed, large dataset)
- Long-running service introduced or modified (background workers, event processors, connection pools)
- Production signals indicate an escaped regression (OOM restarts, RSS slope, FD exhaustion)
- Programmer is working on state-heavy, long-lived, or subscription-heavy components (load antipatterns pre-check)

## Agent Activation

| Agent | Activation Context | Loads |
|---|---|---|
| QA/e2e | Browser/mobile memory regression tests | SKILL.md + matching adapter |
| Performance Engineering | Backend service memory under load | SKILL.md + matching adapter |
| Programmer | Pre-implementation leak prevention | SKILL.md + `references/antipatterns.md` |
| Software Architect | Structural review of skill changes | Required reviewer, not executor |

## Core Abstraction — Universal Bounded-Growth Assertion

The fundamental pattern works identically across all platforms and resource types:

```
1. Establish harness (launch app/service/device, connect profiling)
2. Warmup phase (allow caches, JIT, lazy init to stabilize)
3. Measure baseline AFTER warmup and forced cleanup
4. Apply repeatable stress workload N times
5. Force cleanup/GC where possible
6. Measure again
7. Assert: (post - baseline) < budget
8. If gate fails → route to diagnosis phase
```

### Forced Cleanup/GC Caveat

Step 5 ("Force cleanup/GC where possible") varies by platform:
- **Chromium/Node.js:** `HeapProfiler.collectGarbage` / `global.gc()` with `--expose-gc` — reliable
- **Go:** `runtime.GC()` — reliable but does not guarantee finalizer completion
- **JVM:** `System.gc()` — advisory only, JVM may ignore. Mitigate with `-XX:+ExplicitGCInvokesConcurrent`, call twice with 100ms pause
- **Python:** `gc.collect()` — reliable for cycle collection, not for C extension memory
- **iOS:** ARC — no GC to force. Objects deallocate on last reference release. Use autoreleasepool draining + short idle pause
- **Android (ART):** `System.gc()` is best-effort (ART usually honors it). Call twice with 200ms pause for concurrent collector
- **Native/GPU:** No GC — must explicitly release resources, then measure

When forced GC is unavailable or unreliable, increase iteration count and allow longer idle settle time between stress and measurement. Accept higher variance in these environments.

### Resource Classes

"Memory" is shorthand for any finite system resource tied to lifecycle events:

| Class | Examples |
|---|---|
| Heap objects | JS objects, Java instances, Python objects, Go allocations |
| Native memory | C/C++ allocations, mmap regions, image buffers |
| File descriptors | Open files, sockets, pipes, database connections |
| GPU resources | Textures, framebuffers, shader programs, render targets |
| OS handles | Threads, processes, workers, timers, event listeners |
| Framework resources | DOM nodes, views, controllers, subscriptions, observers |

### Workload Classes

| Class | Shape | Example |
|---|---|---|
| Interaction loop | Repeat user action cycle N times | Navigate Home→Dashboard→Home ×50 |
| Request/load loop | Sustained concurrent requests over duration | 1k RPS for 5 minutes |
| Lifecycle loop | Repeat create/destroy cycle N times | Mount/unmount component ×100 |
| Idle soak | Hold steady state for extended duration | Run service idle for 2 hours |

## Gate Phase — CI Regression Detection

### Prescribed CI Execution Strategy

| Trigger | Test Type | Blocking? |
|---|---|---|
| PR labeled `memory` or `performance` | Lightweight smoke (10-20 iterations, 1 resource class) | Yes, if promoted |
| PR touching high-risk paths (configurable) | Lightweight smoke | Yes, if promoted |
| Nightly build | Full soak (50+ iterations, all resource classes) | Advisory until promoted |
| Release candidate | Full soak + multi-workload-class | Yes |

### Assertions

All assertions follow the form: `resource_metric_after_cleanup - baseline < budget`

Metrics to assert (select per platform):
- Heap used (bytes) after forced GC
- Resident Set Size (RSS) or equivalent
- Resource handle count (FDs, sockets, connections)
- Detached/orphaned framework objects (DOM nodes, views)
- GPU memory allocated

### When NOT to Gate (Reliability Criteria)

Do not use as a blocking merge gate when:
- Instrumentation is missing or incomplete for the target resource
- Measurement variance is too high for reliable gating (σ > 5% of budget = not promotable; σ > 15% = not even useful as diagnostic)
- Test runs are too short to distinguish warmup/caching from leaks (< 10 iterations)
- Cleanup/GC is nondeterministic and cannot be forced on the platform
- CI environment is shared/noisy with unpredictable resource contention

Variance zones:
- **σ < 5% of budget:** Eligible for blocking gate (see promotion criteria)
- **5-15%:** Diagnostic/advisory only — useful signal but too noisy to block
- **> 15%:** Unreliable — fix measurement stability before using as any signal

In these conditions: collect diagnostics, report as advisory, and require test stabilization before promoting to a blocking gate.

### Gating Promotion Criteria

A memory regression test is diagnostic-only (non-blocking, advisory) until ALL of:

1. **Deterministic:** Passes consistently on main branch (≥10 consecutive green runs)
2. **Bounded variance:** Resource delta standard deviation < 5% of budget across runs
3. **Regression-sensitive:** Fails on a known injected or historical leak (prove it catches real issues)
4. **Time-bounded:** Executes within CI time budget (default: < 5 minutes)
5. **Low flake rate:** No unexplained failures in last 20 relevant CI runs
6. **Actionable failure:** Failure message points to next diagnostic step, not just "over budget"

Once all criteria are met, promote to blocking merge gate.

## Diagnosis Phase — Check → Diagnose Workflow

When the gate fails (or when invoked for investigation), follow this workflow:

```
1. Identify the RESOURCE CLASS that grew (heap? FDs? native? GPU?)
2. Identify the GROWTH SHAPE (linear? stepwise? sudden spike?)
3. Map growth shape to likely root cause (see failure-shape-diagnosis.md)
4. Capture detailed snapshot/profile for the specific resource class
5. Diff snapshots: baseline vs post-stress
6. Identify retaining references / unclosed handles / leaked allocations
7. Report: what leaked, where, probable cause, suggested fix
```

### Snapshot Strategy

| Phase | Purpose |
|---|---|
| Snapshot A | Baseline after warmup + cleanup |
| Snapshot B | After 50% of stress iterations |
| Snapshot C | After 100% of stress iterations + cleanup |
| Diff B→C | Isolates what is retained per-iteration (true leak) vs one-time growth |

## Escaped Regression Signals (Production)

When these production signals appear, they indicate a memory regression escaped pre-merge testing. Use this skill to reproduce locally and create a regression gate:

- Container OOM kills or restart loops
- Monotonically rising RSS/heap over hours (not stabilizing after warmup)
- File descriptor or connection pool exhaustion under normal load
- GC pause time growing steadily
- Worker/thread count growing without bound
- Memory SLO violations or budget alerts

This section defines WHAT to watch for. It does NOT prescribe how to configure monitoring, alerting, or incident response — those belong in observability/SRE skills.

## Platform Adapters

The core abstraction above is platform-agnostic. For concrete tooling, commands, and runtime-specific patterns, load ONLY the adapter matching the target platform.

**Instruction to agents:** Identify the target platform first. Load ONLY the corresponding adapter reference. Do not load all adapters — irrelevant platform context wastes tokens and dilutes focus.

### Reference Pattern Notice

Adapter files are **field guides**, not copy-paste test suites. Snippets are intentionally partial — they demonstrate measurement mechanics, platform gotchas, and key API surfaces. Agents MUST adapt patterns to the target repository's actual test runner, app startup, routes/endpoints, lifecycle hooks, cleanup APIs, and CI budget.

Before writing a runnable test from these patterns, identify:
1. The project-specific workload to repeat (route, endpoint, interaction)
2. The resource metric to measure (heap, RSS, handles, DOM nodes, etc.)
3. The warmup and cleanup strategy for this platform
4. The allowed growth budget (start permissive, tighten after baseline data)
5. Whether the result is diagnostic-only or eligible for CI gating

If no tests exist in the target project yet, first establish a basic passing test using the project's existing conventions before injecting memory regression patterns.

### Available Adapters

| Platform | Adapter File |
|---|---|
| Browser (any SPA framework) | `references/adapters/browser.md` |
| Node.js | `references/adapters/node.md` |
| Go | `references/adapters/go.md` |
| Python | `references/adapters/python.md` |
| JVM (Java/Kotlin/Scala) | `references/adapters/jvm.md` |
| iOS (Swift/ObjC) | `references/adapters/ios.md` |
| Android (Kotlin/Java) | `references/adapters/android.md` |
| GPU / Native (C/C++/Rust/Vulkan/Metal/OpenGL) | `references/adapters/gpu-native.md` |

When a planned adapter is needed but not yet written, agents should use the core abstraction from this SKILL.md and apply platform documentation directly. The core pattern (warmup → baseline → stress → cleanup → measure → assert) applies regardless of whether a detailed adapter exists.

## Related References

| Reference | Purpose |
|---|---|
| `references/antipatterns.md` | Programmer prevention checklist — load before implementation |
| `references/failure-shape-diagnosis.md` | Growth pattern → root cause mapping |
| `references/gating-promotion-criteria.md` | Detailed promotion workflow |
