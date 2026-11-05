# Verification Examples

Load this only when you want examples of what counts as valid evidence.

## Test Claim

```text
Command: npm test
Result: pass
Evidence: 34 passed, 0 failed, exit 0
```

Not enough:

```text
Should pass now.
```

## Build Claim

```text
Command: npm run build
Result: fail
Evidence: TypeScript compile error in src/app.ts:42, exit 1
```

Even if lint passed, the build claim is still false.

## Delegated Work Claim

```text
Command: git diff --stat
Result: pass
Evidence: expected files changed and verification commands were run
```

Do not trust an agent status message by itself.

## Requirement Claim

Use a short checklist tied to the requirement and report any gap explicitly.
