# Feature Slice Drop-In Template (DDD / Vertical Slice)

Use this structure when a feature should be portable as a unit, with specs/tests/types co-located and runtime logic separated from framework-specific wiring.

## Template Structure

```text
/features/<feature-name>/
├── README.md
├── __specs__/
│   ├── <feature>.spec.md
│   ├── <feature>.api.spec.ts
│   ├── <feature>.state.spec.ts
│   ├── <feature>.ui.spec.ts
│   ├── <feature>.orchestrator.spec.ts
│   ├── <feature>.errors.spec.md
│   ├── <feature>.behavior.spec.md
│   ├── <feature>.traceability.spec.md
│   └── spec-manifest.md
├── __tests__/
│   └── typescript/
│       ├── api/
│       ├── contracts/
│       ├── logic/
│       └── react/
│           ├── hooks/
│           └── orchestrators/
├── __types__/
│   └── typescript/
│       ├── <feature>.types.ts
│       └── logic/
├── typescript/
│   ├── api/
│   ├── logic/
│   └── react/
│       ├── hooks/
│       ├── orchestrators/
│       ├── state/
│       │   ├── adapters/
│       │   └── <state-manager>/
│       └── views/
│           └── components/
└── <optional-other-runtimes>/
    ├── javascript/
    └── flutter/
```

## Why This Works

- `__specs__/`: keeps feature contracts at the top and reusable across implementations.
- `__tests__/`: mirrors architecture boundaries so failures point to the right layer.
- `__types__/`: keeps shared type contracts stable and framework-agnostic.
- `typescript/api` and `typescript/logic`: pure runtime logic reusable across React/Vue/Angular/Preact.
- `typescript/react/*`: framework-specific wiring isolated from reusable core logic.
- Runtime folders (`typescript/`, `javascript/`, `flutter/`) enable multi-platform parity without changing spec contracts.

## Weaknesses

- Higher ceremony for small/simple features.
- Potential duplication between `__types__` and runtime-layer types if ownership is unclear.
- Specs/tests can drift from code if traceability checks are not enforced.
- Mirrored trees can become noisy without naming conventions and pruning.
- Multiple runtime folders increase maintenance burden when feature velocity is high.

## Improvements

- Define explicit ownership:
  - `__types__` = shared contracts
  - runtime folders = implementation-only types
- Enforce naming and traceability:
  - map test file names to spec requirement IDs
  - fail CI when traceability/spec manifest drift is detected
- Add a small "feature boundary contract" checklist in `README.md`:
  - imports allowed
  - forbidden cross-layer dependencies
  - approved state adapter boundary
- Add generation scaffolds for new slices to reduce boilerplate.
- Add lifecycle policy:
  - archive stale specs/tests
  - merge/split overly large slices

## Recommended Use

Choose this template when:

- The feature should be movable/droppable as a unit.
- You need architecture-aware test organization.
- You expect framework/runtime expansion over time.

Avoid for:

- One-off, tiny CRUD surfaces with no reuse horizon.
