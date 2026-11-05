# Writing Plans Examples

Load this only when you want concrete plan patterns.

## Example Task Slice

```text
Task: Add retry logic
Files:
- Modify: src/retry.ts
- Test: tests/retry.test.ts

Step 1: Write failing test
Step 2: Run targeted test and confirm failure
Step 3: Implement minimal change
Step 4: Re-run targeted test
Step 5: Run affected suite
```

## Example Verification Line

```text
Run: npm test -- retry.test.ts
Expected: pass
```
