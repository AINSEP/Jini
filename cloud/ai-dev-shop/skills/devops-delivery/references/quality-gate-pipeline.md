<!-- Source: Addy Osmani / agent-skills / ci-cd-and-automation -->

# Quality Gate Pipeline

Every gate must pass before code moves forward. No gate can be skipped because the skipped gate becomes the place defects hide.

```text
commit
  |
  v
lint
  |
  v
type check
  |
  v
unit tests
  |
  v
build
  |
  v
integration tests
  |
  v
E2E tests
  |
  v
security audit
  |
  v
bundle size
  |
  v
release candidate
```

## Gate Expectations

| Gate | Purpose |
|---|---|
| Lint | Enforce syntax, formatting, and local code rules |
| Type check | Catch invalid contracts before runtime |
| Unit tests | Verify small deterministic behavior |
| Build | Prove the project can produce deployable artifacts |
| Integration tests | Verify local component and service interactions |
| E2E tests | Verify critical user flows |
| Security audit | Catch known vulnerable dependencies and unsafe patterns |
| Bundle size | Prevent unreviewed performance regressions |

## Feeding CI Failures Back To Agents

Use CI as a precise feedback loop:

1. Paste the failing CI output into the agent context.
2. Ask the agent to explain the failure before editing.
3. Have the agent make the smallest relevant fix.
4. Push the change.
5. Let CI run again and repeat until green.

The failure output is the contract. Do not summarize it loosely when exact logs are available.

## CI Optimization Sequence

Optimize CI in this order:

1. Cache dependencies.
2. Run independent jobs in parallel.
3. Add path filters so unrelated changes skip expensive jobs.
4. Use matrix builds for version and platform coverage.
5. Optimize the test suite by reducing flake, duplication, and unnecessary large tests.
6. Move to larger runners only after workflow design is efficient.
