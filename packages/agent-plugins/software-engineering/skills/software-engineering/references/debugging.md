# Debugging

Start with observed behavior, expected behavior and a minimal reproduction. Trace the concrete input through its owner and effect boundary. Redact secrets from evidence. Fix the root cause rather than a downstream symptom.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - Does it happen every time?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form Single Hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Write it down
   - Be specific, not vague

2. **Test Minimally**
   - Make the SMALLEST possible change to test hypothesis
   - One variable at a time
   - Don't fix multiple things at once

3. **Verify Before Continuing**
   - Did it work? Yes → implement the proven correction
   - Didn't work? Form NEW hypothesis
   - DON'T add more fixes on top

4. **When You Don't Know**
   - Say "I don't understand X"
   - Don't pretend to know
   - Ask for help
   - Research more

For a bug, write and run a failing regression test before the fix. Confirm failure comes from the behavior, not setup. Probe external dependencies in isolation and consult current upstream documentation or issues before guessing flags. Never repeat a byte-identical failed invocation except for an evidenced transient capacity signal. The same failure twice without progress ends that loop: report the evidence, hypothesis and missing capability, then continue independent work.

Implement the smallest correction at the owner, preserving validation, permissions, recovery and supported formats. Run the regression and affected existing checks, inspect the diff and report before/after evidence. Missing reproduction tools mean UNVERIFIED. Never hide a failure with a skip, weakened assertion or silent fallback.
