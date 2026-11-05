# Memory Regression — Gating Promotion Criteria

Defines the explicit path from diagnostic-only memory test to blocking merge gate. A memory regression test should NOT block merges until it meets ALL criteria below.

## Promotion Lifecycle

```
[New Test] → [Diagnostic Only] → [Candidate Gate] → [Blocking Gate]
```

### Stage: Diagnostic Only (Default)

- Test runs in CI but does not block merges
- Reports results as advisory comments/artifacts
- Collects baseline data and variance measurements
- May produce warnings without failing the pipeline

### Stage: Candidate Gate

- Test has shown consistent results, team is evaluating promotion
- Runs in shadow mode: would-have-blocked notifications without actual blocking
- Duration: minimum 1 week or 20 relevant CI runs (whichever is longer)

### Stage: Blocking Gate

- Test blocks merges on failure
- Must meet ALL promotion criteria below
- Can be demoted back to Diagnostic if it becomes unreliable

## Promotion Criteria (ALL Required)

### 1. Deterministic Baseline

The test passes consistently on the main/default branch.

- Minimum: 10 consecutive green runs on main
- No unexplained failures during the evaluation period
- Baseline resource measurement is stable (not drifting upward even when "passing")

### 2. Bounded Variance

Resource measurements are predictable enough to set meaningful thresholds.

- Standard deviation of the growth delta (post-stress minus baseline) < 5% of the budget
- No outlier runs > 2σ from mean in evaluation period
- Variance is stable across different CI runner instances (not machine-dependent)

### 3. Regression Sensitivity (Proven Detection)

The test actually catches real leaks, not just noise.

- Validated against at least one KNOWN regression (historical or injected)
- The known regression causes the test to fail reliably (≥9/10 runs)
- The budget threshold is calibrated: tight enough to catch real leaks, loose enough to avoid false positives

### 4. Time Bounded

The test completes within acceptable CI time.

- Default maximum: 5 minutes for smoke, 15 minutes for full soak
- Project may override these defaults
- If test exceeds budget, it remains nightly-only (not PR-blocking)

### 5. Low Flake Rate

The test does not produce false failures.

- Zero unexplained failures in the last 20 relevant CI runs
- Any flake must be root-caused and fixed before re-evaluation
- "Relevant" means runs where the code under test was exercised (not skipped)

### 6. Actionable Failure Message

When the test fails, the engineer knows what to do next.

- Failure output includes: which resource exceeded budget, by how much, growth shape
- Points to the diagnosis phase or specific diagnostic command
- Does not just say "memory over budget" — must say which metric, what the baseline was, what the post-stress measurement was

## Demotion Criteria

A blocking gate should be demoted back to Diagnostic if:

- Flake rate exceeds 5% over a 2-week window
- CI environment changes make measurements unreliable
- Budget threshold requires repeated loosening (signals an unstable baseline)
- Test duration grows past time budget due to app changes
- The team has lost confidence in the test's signal

## Budget Calibration Guidance

> **These are illustrative examples only, not recommended defaults.** Every budget MUST be derived from the specific application's measured baseline and empirical variance. Using these numbers without calibration will produce false positives or mask real leaks.

| Resource | Example Smoke Budget | Example Soak Budget | Notes |
|---|---|---|---|
| JS Heap (browser) | 30-50 MB growth | 10-20 MB growth | Soak is stricter — more iterations amortize one-time costs |
| RSS (server) | 50-100 MB growth | 20-50 MB growth | Account for allocator behavior, not just leaks |
| FD count | +5 handles | +2 handles | Very tight — FD leaks are deterministic |
| DOM nodes | +50-100 nodes | +10-20 nodes | After GC, detached nodes should be near zero |
| GPU memory | +20 MB | +5 MB | Platform-dependent measurement reliability |

To calibrate: run the test 10+ times on a known-good build, compute mean and standard deviation of growth, then set budget = mean + 3σ. Tighten after the test proves stable.
