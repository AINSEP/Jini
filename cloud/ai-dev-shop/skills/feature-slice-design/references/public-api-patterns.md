# Public API Patterns

Rules and examples for FSD slice public APIs (barrel exports via index.ts).

## Core Rule

Every slice must have an `index.ts` at its root. This is the only import path external consumers may use.

## Correct Pattern

```typescript
// features/add-to-cart/index.ts
export { AddToCartButton } from "./ui/AddToCartButton";
export { useAddToCart } from "./model/use-add-to-cart";
export type { CartItem } from "./model/types";
```

Consumers import:
```typescript
import { AddToCartButton, useAddToCart } from "@/features/add-to-cart";
```

## Anti-Patterns

### Wildcard Re-Export (Prohibited)

```typescript
// BAD — exposes internals, hurts discoverability
export * from "./ui/AddToCartButton";
export * from "./model";
```

### Internal Path Import (Prohibited)

```typescript
// BAD — bypasses public API, creates fragile coupling
import { cartReducer } from "@/features/add-to-cart/model/store";
```

### Self-Import (Creates Circular Dependency)

```typescript
// BAD — inside features/add-to-cart/model/use-add-to-cart.ts
import { CartItem } from "@/features/add-to-cart"; // circular!

// GOOD — use relative path within the same slice
import { CartItem } from "../model/types";
```

## Shared Layer Exception

For `shared/ui` and `shared/lib` (collections of unrelated utilities), a single barrel file causes bundle bloat because tree-shaking cannot eliminate unused re-exports reliably.

Use per-component index files:

```
shared/ui/
├── button/
│   ├── Button.tsx
│   └── index.ts       # export { Button } from "./Button"
├── input/
│   ├── Input.tsx
│   └── index.ts
└── modal/
    ├── Modal.tsx
    └── index.ts
```

Import as:
```typescript
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
```

## Type-Only Exports

Export types explicitly when external consumers need them:

```typescript
// entities/user/index.ts
export { UserAvatar } from "./ui/UserAvatar";
export { useUser } from "./model/use-user";
export type { User, UserRole } from "./model/types";
```

## What NOT to Export

- Internal state management details (store shape, reducers, selectors)
- Internal helper functions that are implementation details
- Test utilities (keep in `__tests__/` or co-located test files)
- Segment-internal types that are not part of the public contract

## Path Aliases

Configure aliases in tsconfig.json to enforce clean imports:

```json
{
  "compilerOptions": {
    "paths": {
      "@/app/*": ["src/app/*"],
      "@/pages/*": ["src/pages/*"],
      "@/widgets/*": ["src/widgets/*"],
      "@/features/*": ["src/features/*"],
      "@/entities/*": ["src/entities/*"],
      "@/shared/*": ["src/shared/*"]
    }
  }
}
```

## Entity Cross-Reference (@x Pattern)

When entity A's data model inherently references entity B (e.g., a Post needs to display its Author), the **provider** entity exposes a narrow API specifically for the **consumer** entity.

Direction: the entity that **provides** data owns the `@x/` folder. The file is named after the **consumer** that needs it.

Example: `entities/post` needs Author data from `entities/user`. The **provider** (user) exposes a narrow contract for the **consumer** (post):

```
entities/
├── user/
│   ├── @x/
│   │   └── post.ts    # narrow API that user exposes ONLY for post's consumption
│   ├── ui/
│   ├── model/
│   └── index.ts       # does NOT export @x contents
└── post/
    ├── ui/
    ├── model/          # imports from @/entities/user/@x/post
    └── index.ts
```

Rules for `@x`:
- Last resort only — prefer composing from above (widgets/pages pass data as props), extracting shared types to `shared`, or restructuring slices
- The provider entity owns the `@x/` folder; the file is named after the consumer
- The `@x` file exposes only what the named consumer needs — minimal surface
- The main `index.ts` does NOT re-export `@x` contents
- Document why the cross-reference is necessary and why alternatives don't work

## Enforcement Checklist

Before handoff, verify:
- [ ] Every slice has an `index.ts`
- [ ] All cross-slice imports use the public API path (not internal paths)
- [ ] No wildcard re-exports exist
- [ ] `shared/ui` uses per-component index files (not one giant barrel)
- [ ] Types that consumers need are explicitly exported with `export type`
