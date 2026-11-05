# Testing Placement

Where automated tests live in an FSD project. Both major approaches are valid — pick one per project and stay consistent.

## Option A: Co-located Tests

Tests live next to the code they exercise, inside the slice.

```text
src/features/add-to-cart/
├── ui/
│   ├── AddToCartButton.tsx
│   └── AddToCartButton.test.tsx
├── model/
│   ├── use-add-to-cart.ts
│   └── use-add-to-cart.test.ts
├── api/
│   ├── cart-api.ts
│   └── cart-api.test.ts
└── index.ts
```

**Tradeoffs:**
- Slice is a self-contained unit — move or delete it and tests travel with it
- Easy to see which code has test coverage at a glance
- Test files may affect bundlers if not properly excluded
- Some teams find production and test code mixed together harder to navigate

## Option B: Mirrored Test Tree

A separate `tests/` directory at the project root mirrors the FSD structure.

```text
src/
├── features/add-to-cart/
│   ├── ui/AddToCartButton.tsx
│   ├── model/use-add-to-cart.ts
│   └── index.ts
tests/
├── features/add-to-cart/
│   ├── ui/AddToCartButton.test.tsx
│   └── model/use-add-to-cart.test.ts
```

**Tradeoffs:**
- Clean separation between production and test code
- No risk of test files leaking into production bundles
- Requires maintaining parallel folder structures (can drift)
- Harder to notice missing test coverage when reading slice code

## Rules That Always Apply (Regardless of Placement)

1. **Integration tests respect public APIs.** Tests that exercise a slice from the outside must import through `index.ts` — never reach into internal paths. This validates the same contract that consumers use.

2. **Unit tests may import internals.** Tests co-located within a slice (or in the mirror) may import internal modules directly — they're testing implementation details intentionally.

3. **Test utilities belong in shared.** Generic test helpers (mocks, fixtures, custom matchers) go in `shared/lib/testing` or a project-level test utilities directory — not inside a business slice.

4. **No cross-slice test dependencies.** A feature's tests should not import another feature's internals. If tests need data from another slice, use the public API or create fixtures.

## Test Types and Their Natural Home

| Test type | Scope | Where it typically lives |
|-----------|-------|--------------------------|
| Unit test | Single function/component | Next to the file or in mirror |
| Slice integration test | Whole slice via public API | At the slice root or in mirror at slice level |
| Widget/page composition test | Multiple slices composed | At the widget/page level |
| E2E test | Full application flow | Separate `e2e/` directory (outside FSD structure) |

## Configuration

Whichever approach you choose, configure:
- Build tools to exclude test files from production bundles
- Test runner to find tests in the chosen location pattern
- Coverage tools to map test files back to source correctly
