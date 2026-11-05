# Framework Integration Patterns

How FSD co-exists with file-based routing frameworks. The core principle: framework routing files act as **thin route shells** (controllers), while business logic and UI composition live inside the FSD layer structure.

## The Routing Collision Problem

File-based routing frameworks reserve directory names that FSD also uses:
- Next.js reserves `app/` — collides with FSD's `app` layer
- Nuxt reserves `pages/` — collides with FSD's `pages` layer
- Astro reserves `src/pages/` — same collision
- SvelteKit reserves `src/routes/` — less collision but constrains structure
- Remix/React Router reserves `app/routes/` — similar pattern

## Resolution Strategies

Choose one per project. All are valid; tradeoffs differ.

### Strategy A: Thin Route Shell (External Router + FSD in `src/`)

Framework routing at the project root (or framework-required location) contains only thin re-exports. All FSD code lives under `src/`.

```text
app/                    # Framework routing (Next.js/Remix)
├── layout.tsx          # Metadata, providers
└── page.tsx            # Thin: imports from src/pages/home
src/                    # FSD root
├── app/                # FSD app layer (providers, global config)
├── pages/              # FSD pages layer
├── widgets/
├── features/
├── entities/
└── shared/
```

**Tradeoff:** Cleanest separation; requires understanding that the framework's `app/` and FSD's `src/app/` serve different purposes. For Next.js specifically, `create-next-app` defaults to `src/app/` — you must move FSD's app layer to a different name or move Next.js routing to the root.

### Strategy B: Prefix/Rename FSD Layers

Rename FSD layers that collide with framework directories.

```text
src/
├── pages/              # Framework routing (Astro requires this)
├── _pages/             # FSD pages layer (renamed)
├── _app/               # FSD app layer (renamed)
├── widgets/
├── features/
├── entities/
└── shared/
```

Alternative names: `views/` for pages, `core/` or `bootstrap/` for app.

**Tradeoff:** Avoids filesystem conflicts entirely; deviates from canonical FSD naming. Document your naming map.

### Strategy C: Framework-as-Controller

Treat the framework's routing directory as the FSD `pages` and `app` layer combined. FSD business layers live alongside.

```text
app/                    # Acts as both framework routing AND FSD pages/app
├── routes/
│   └── _index.tsx      # Route + page composition in one file
├── providers/          # App-level providers
src/
├── widgets/
├── features/
├── entities/
└── shared/
```

**Tradeoff:** Feels native to the framework; fewer directories. Mixes routing concerns with composition — harder to enforce pure FSD boundaries.

## The Thin Route Shell Pattern

Regardless of strategy, framework route files should be thin controllers:

**What belongs in the route file:**
- Framework routing metadata (params, layouts, middleware)
- Server data loading (loaders, server functions, async data)
- Mutation handlers (actions, form handlers)
- Serialization / response shaping
- Delegation to FSD page components

**What does NOT belong in the route file:**
- Business logic
- Complex UI composition
- Direct imports from entity/feature internals
- State management setup

## Framework-Specific Notes

### Next.js App Router

```tsx
// app/products/[id]/page.tsx — thin route shell
import { ProductDetailPage } from "@/pages/product-detail";

export const metadata = { title: "Product" };

export default async function Page({ params }: { params: { id: string } }) {
  return <ProductDetailPage productId={params.id} />;
}
```

The `src/app/` collision: if using `create-next-app` with `src/`, Next.js puts routing in `src/app/`. Options:
- Move Next.js routing to root `app/` (set `appDir` in next.config)
- Rename FSD app layer to `src/bootstrap/` or `src/init/`
- Accept the namespace sharing and separate by convention (routing files vs FSD segments)

### Nuxt

```vue
<!-- pages/index.vue — thin route shell -->
<script setup lang="ts">
import { HomePage } from "@/pages/home";
definePageMeta({ layout: "default" });
</script>
<template><HomePage /></template>
```

Nuxt's auto-import system can bypass FSD boundaries silently. For strict FSD enforcement, disable auto-imports for FSD modules or use explicit imports exclusively.

### SvelteKit

```svelte
<!-- src/routes/+page.svelte — thin route shell -->
<script lang="ts">
  import { HomePage } from "@/pages/home";
  export let data; // from +page.server.ts
</script>
<HomePage {data} />
```

SvelteKit's `+page.server.ts` naturally separates server logic from UI — aligns well with FSD's page-level data coordination.

### Astro

```astro
---
// src/pages/index.astro — thin route shell
import { HomePage } from "@/_pages/home";
const data = await fetchSomeData();
---
<HomePage data={data} client:load />
```

Astro hydration directives (`client:load`, `client:visible`, etc.) are applied at the `.astro` boundary where you instantiate the component — they cannot be passed down as props through non-Astro components. Plan your hydration boundaries at the route shell or layout level.

### Remix / React Router v7

```tsx
// app/routes/_index.tsx — thin route shell
import { HomePage } from "@/pages/home";

export async function loader() {
  return { message: "Hello" };
}

export default function IndexRoute() {
  const data = useLoaderData<typeof loader>();
  return <HomePage data={data} />;
}
```

Loaders and actions must be exported from route files. If the logic is complex, extract it into feature or entity `api/` segments and call from the loader.

## Global Layout

Global layouts (persistent header, sidebar, navigation) belong in:
- The framework's layout system (Next.js `layout.tsx`, Nuxt `layouts/`, SvelteKit `+layout.svelte`)
- Composed from FSD widgets: `widgets/header`, `widgets/sidebar-nav`
- The `app` layer provides the shell; widgets provide the content

Do NOT place layouts in `shared` (shared cannot import widgets).
