# FSD Layer Hierarchy Reference

Detailed descriptions and decision examples for each FSD layer.

## app

The application initialization layer. Not sliced — contains only segments.

**Contains:** routing configuration, global providers (theme, auth, i18n), global styles, store initialization, application entrypoint.

**Rules:**
- Only layer that can compose pages
- Only layer that initializes global side effects
- Should be thin — mostly wiring, not logic

**Example segments:**
```
src/app/
├── routing/        # router config, route guards
├── providers/      # context providers wrapper
├── styles/         # global CSS/theme tokens
└── store/          # global store setup
```

## pages

Full screens or route-level views. Each slice = one route or screen.

**Contains:** page-level layout, composition of widgets and features for a specific route, page-specific data fetching coordination.

**Rules:**
- Each page slice corresponds to one route
- Pages compose widgets and features — they do not contain business logic directly
- A page may import from widgets, features, entities, and shared

**Decision:** If code is route-specific composition → page. If it's reusable across routes → widget or feature.

**Example:**
```
src/pages/
├── home/
│   ├── ui/         # HomePage component
│   └── api/        # page-level data fetching
├── profile/
│   ├── ui/
│   └── model/      # page-local state if needed
└── settings/
    └── ui/
```

## widgets

Self-contained UI blocks that compose entities and features into meaningful sections. Reusable across pages.

**Contains:** UI compositions that combine entity displays with feature actions into a coherent block.

**Rules:**
- Widgets compose entities + features — they are the "glue" layer
- Widgets do not define new business logic; they combine existing slices
- A widget may import from features, entities, and shared

**Decision:** If it combines entity display with feature actions → widget. If it's a standalone action → feature. If it just displays data → entity UI.

**Example:**
```
src/widgets/
├── post-card/
│   └── ui/         # combines entity/post display + feature/like button
├── sidebar-nav/
│   └── ui/
└── comment-thread/
    └── ui/         # combines entity/comment + feature/reply
```

## features

User-facing actions that deliver business value. Think verbs.

**Contains:** the implementation of a specific user action: UI for triggering it, model for its state, API for its backend communication.

**Rules:**
- Features are verbs: "add to cart", "send comment", "toggle theme", "filter results"
- A feature may import from entities and shared — never from other features
- Features own their action logic; they do not own the domain entities they act upon

**Decision:** If it's a user action with business value → feature. If it's a domain object → entity. If it's page-specific composition → page.

**Example:**
```
src/features/
├── add-to-cart/
│   ├── ui/         # AddToCartButton
│   ├── model/      # cart mutation logic
│   └── api/        # POST /cart/items
├── toggle-theme/
│   ├── ui/         # ThemeSwitch
│   └── model/      # theme preference store
└── send-comment/
    ├── ui/         # CommentForm
    ├── model/      # validation, optimistic update
    └── api/        # POST /comments
```

## entities

Business domain objects the project operates on. Think nouns.

**Contains:** the representation, display, and data model of a business concept.

**Rules:**
- Entities are nouns: user, product, order, notification, comment
- An entity may only import from shared — never from features or other entities
- Entities own their data schema, their display components, and their data-fetching shapes
- For entity-to-entity relationships (e.g., a Post has an Author), use the `@x` cross-reference as a last resort

**Decision:** If it's a business concept with its own identity → entity. If it's a utility → shared.

**Example:**
```
src/entities/
├── user/
│   ├── ui/         # UserAvatar, UserBadge
│   ├── model/      # User type, user store
│   └── api/        # GET /users/:id
├── product/
│   ├── ui/         # ProductCard, ProductPrice
│   ├── model/      # Product type
│   └── api/        # product endpoints
└── order/
    ├── ui/         # OrderSummary
    ├── model/      # Order type, status enum
    └── api/
```

## shared

Reusable functionality detached from business specifics. Not sliced — organized by segments or independent modules.

**Contains:** UI kit components, API client setup, utility libraries, configuration, route constants, i18n setup.

**Rules:**
- Nothing in shared knows about the business domain
- Shared is imported by every other layer
- For large shared/ui collections, use per-component index files to avoid bundle bloat
- Shared should never import from any other layer

**Common structure:**
```
src/shared/
├── ui/
│   ├── button/
│   │   └── index.ts
│   ├── input/
│   │   └── index.ts
│   └── modal/
│       └── index.ts
├── api/
│   └── client.ts       # fetch wrapper, interceptors
├── lib/
│   ├── format-date.ts
│   └── debounce.ts
├── config/
│   └── env.ts
└── routes/
    └── paths.ts        # route path constants
```

## Layer Selection Flowchart

```
Is it business-agnostic utility/UI kit? → shared
Is it a domain concept with identity?   → entities
Is it a user action delivering value?   → features
Does it compose entities + features?    → widgets
Is it a full screen/route?              → pages
Is it app-wide initialization/wiring?   → app
```

## Compatibility: `processes` Layer

Some older FSD codebases include a `processes` layer between `pages` and `features` for cross-feature orchestration (multi-step wizards, checkout flows, onboarding sequences).

```text
app → pages → processes → widgets → features → entities → shared
```

**Guidance:**
- If you encounter `processes` in an existing codebase, preserve it — do not remove during refactoring unless the team decides to migrate
- For new projects, do not introduce `processes`. Instead, handle orchestration at the page level, widget level, or in an `app/workflows/` segment — whichever is the natural owner of the flow
- If a flow spans multiple routes, consider an app-level service or a dedicated widget that manages the sequence
