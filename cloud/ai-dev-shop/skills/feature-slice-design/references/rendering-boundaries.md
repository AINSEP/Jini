# Rendering Boundaries

How FSD layers relate to server/client rendering boundaries. These concepts are framework-agnostic — they apply whether you're using React Server Components, Nuxt server routes, Astro islands, SvelteKit load functions, or Angular SSR.

## Core Principle

FSD layers are **architectural boundaries**, not runtime boundaries. A layer does not inherently belong to "server" or "client." However, practical patterns emerge:

## Typical Boundary Placement

| Layer | Typical environment | Why |
|-------|--------------------|-----|
| **App** | Both (config is universal; providers may be client-only) | Routing/metadata is server; interactive providers are client |
| **Pages** | Server or universal | Route entry points often handle server data coordination |
| **Widgets** | Either (composition layer) | Static compositions can be server; interactive ones need client |
| **Features** | Client (usually) | User interactions require browser APIs, event handlers, local state |
| **Entities** | Environment-agnostic | Pure types, display components, data shapes work everywhere |
| **Shared** | Environment-agnostic | Utilities, UI primitives, API clients should be portable |

These are tendencies, not rules. A feature with no interactivity can render on the server. An entity with animations may need the client.

## Declaring Boundaries

The interactivity boundary (where server rendering stops and client hydration begins) belongs at the **component level**, not the layer level. Place it where interactivity starts:

- Interactive leaf components declare themselves as client/hydrated
- Static parent compositions remain server-rendered
- Data serialization happens at the boundary crossing

## Framework-Specific Concepts (Generic Mapping)

| Generic concept | React/Next.js | Vue/Nuxt | Svelte/SvelteKit | Astro | Angular |
|----------------|---------------|----------|------------------|-------|---------|
| Server data loader | Server Component / `loader` | `useAsyncData` / server route | `load` function | frontmatter `fetch` | Resolver / SSR |
| Client interactivity marker | `"use client"` | `<ClientOnly>` / `.client.vue` | — (default client) | `client:load` directive | — (default client) |
| Hydration island | Client Component boundary | Islands via Nuxt Islands | — | Component with `client:*` | — |
| Serialization boundary | Props across server→client | `useAsyncData` return | `load` → `data` prop | frontmatter → template | Transfer State |

## Patterns

### Pattern: Server Shell + Client Features

The page/widget renders on the server, fetching data. Interactive features are marked as client components and receive serialized props.

```text
pages/product-detail (server)
  └─ widgets/product-card (server — static composition)
       └─ entities/product/ui/ProductPrice (server — pure display)
       └─ features/add-to-cart/ui/AddToCartButton (client — interactive)
```

### Pattern: Full Client Page

Single-page apps or pages with heavy interactivity render entirely on the client. The framework route shell may still handle metadata/auth on the server.

### Pattern: Islands Architecture

Pages are static HTML. Specific widgets or features opt into hydration independently. Each island is a self-contained interactive unit — naturally maps to FSD features or widgets.

## What NOT to Do

- Don't make an entire FSD layer "always server" or "always client"
- Don't place `"use client"` (or equivalent) at the barrel export (`index.ts`) of a slice — it forces the entire slice to be client-rendered
- Don't pass non-serializable data (functions, class instances) across server→client boundaries
- Don't put server-only secrets or credentials in shared utilities that could be bundled to the client
